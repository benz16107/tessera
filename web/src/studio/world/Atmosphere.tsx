// Takram's atmosphere (vendored @takram/three-atmosphere, plain three.js build; see vendor/three-atmosphere/index.d.ts)
// for the World view under Live sun. Bruneton's precomputed scattering lights the scene for the planned date and time:
//  - Google's tiles stay unlit MeshBasicMaterial on POST_LIT_LAYER. Their pixels count as albedo, and
//    AerialPerspectiveEffect lights them in post with the sun and the sky (normals rebuilt from depth), plus haze.
//  - Our lit materials (clay, people, props, lights' bulbs) are masked out of the post lighting by LightingMaskPass and lit
//    by SunDirectionalLight (which also casts our shadows) and SkyLightProbe, in the same physical units.
//  - Takram's sky and stars replace drei's Sky; a night fill adds moonlight so buildings stay readable as shapes.
// The scene's frame is east-north-up around `origin` (three's y up), so worldToECEFMatrix carries it to Earth-centred
// coordinates: ECEF = enuFrame(origin) x (ENU_TO_THREE rotation)^-1, with the street on the ellipsoid. The tiles' real
// ellipsoidal height (about -30 m at DUMBO) would put a street-level camera under the model's ground and black the sky;
// 30 m makes no visible difference to the light.
import { useEffect, useMemo, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { CopyPass, Effect, EffectComposer, EffectPass, RenderPass, ToneMappingEffect, ToneMappingMode } from 'postprocessing';
import { Euler, HalfFloatType, Matrix4, Mesh, PlaneGeometry, Points, Uniform, Vector3, type Texture, type WebGLRenderer } from 'three';
import {
  AerialPerspectiveEffect, LightingMaskPass, PrecomputedTexturesGenerator, SkyLightProbe, SkyMaterial, StarsGeometry, StarsMaterial,
  SunDirectionalLight, getECIToECEFRotationMatrix, getMoonDirectionECI, getSunDirectionECI, type PrecomputedTextures,
} from '../vendor/three-atmosphere/index.js';
import { ENU_TO_THREE, enuFrame, type Origin } from '../frame.ts';

/** Tiles on this layer are lit in post (their pixels are albedo). */
export const POST_LIT_LAYER = 10;
/** Meshes with lit materials go on this layer, found automatically, so the post lighting skips them. */
const LIT_LAYER = 11;
/** Set while the atmosphere draws the main view: the studio's renderer calls it instead of gl.render. `exposure` is the
 *  tone-mapping exposure, so the picture-in-picture can match it. */
export const atmosphereRender: { current: ((dt: number) => void) | null; exposure: number } = { current: null, exposure: 1 };

const generators = new WeakMap<WebGLRenderer, PrecomputedTexturesGenerator>();
function texturesFor(gl: WebGLRenderer): PrecomputedTextures {
  let g = generators.get(gl);
  if (!g) { g = new PrecomputedTexturesGenerator(gl); g.update().catch(console.error); generators.set(gl, g); }
  return g.textures;
}

/** Moonlight and exposure after the aerial perspective, before tone mapping: radiance + albedo x fill, times exposure. */
class NightFillEffect extends Effect {
  constructor(albedo: Texture) {
    super('NightFillEffect', /* glsl */ `
      uniform sampler2D albedo; uniform vec3 fill; uniform float exposure;
      void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
        outputColor = vec4((inputColor.rgb + texture2D(albedo, uv).rgb * fill) * exposure, inputColor.a);
      }`, { uniforms: new Map<string, Uniform>([['albedo', new Uniform(albedo)], ['fill', new Uniform(new Vector3())], ['exposure', new Uniform(10)]]) });
  }
}

export default function Atmosphere({ date, origin, groundOffset, exposure = 5, nightFill = [0, 0, 0], albedoScale = 0.8 }: {
  date: Date; origin: Origin; groundOffset: number | null;
  exposure?: number; // radiance to display (tuned by eye; Takram's stories use about 10)
  nightFill?: [number, number, number]; // moonlight on albedo after sunset (light/sun.ts daylight drives it)
  albedoScale?: number; // softens the baked daylight and shadows in Google's textures
}) {
  const { gl, scene, camera, size } = useThree();
  const textures = useMemo(() => texturesFor(gl), [gl]);

  void groundOffset;
  const worldToECEF = useMemo(() => new Matrix4()
    .multiplyMatrices(enuFrame({ ...origin, height: 0 }), new Matrix4().makeRotationFromEuler(new Euler(...ENU_TO_THREE)).invert()),
  [origin.lat, origin.lon]); // eslint-disable-line react-hooks/exhaustive-deps
  const { sun, moon, eciToEcef } = useMemo(() => {
    const m = getECIToECEFRotationMatrix(date, new Matrix4());
    return { eciToEcef: m, sun: getSunDirectionECI(date, new Vector3()).applyMatrix4(m), moon: getMoonDirectionECI(date, new Vector3()).applyMatrix4(m) };
  }, [+date]); // eslint-disable-line react-hooks/exhaustive-deps

  const sky = useMemo(() => {
    const mat = new SkyMaterial();
    Object.assign(mat, textures);
    const mesh = new Mesh(new PlaneGeometry(2, 2), mat);
    mesh.frustumCulled = false;
    mesh.userData.helper = true;
    mesh.layers.enable(LIT_LAYER); // the sky is radiance already, not albedo to light
    return mesh;
  }, [textures]);
  const [stars, setStars] = useState<Points | null>(null);
  useEffect(() => {
    let live = true;
    fetch('/studio/atmosphere/stars.bin').then(r => r.arrayBuffer()).then(buf => {
      if (!live) return;
      const mat = new StarsMaterial();
      Object.assign(mat, textures);
      const p = new Points(new StarsGeometry(buf), mat);
      p.frustumCulled = false; p.userData.helper = true; p.layers.enable(LIT_LAYER);
      setStars(p);
    }).catch(console.error);
    return () => { live = false; };
  }, [textures]);

  // Light sources for lit materials, in the same units as the post lighting. The sun also casts our shadows.
  const sunLight = useMemo(() => {
    const l = new SunDirectionalLight();
    l.transmittanceTexture = textures.transmittanceTexture;
    l.distance = 400; l.castShadow = true;
    l.shadow.mapSize.set(4096, 4096);
    Object.assign(l.shadow.camera, { left: -150, right: 150, top: 150, bottom: -150, near: 1, far: 900 });
    l.shadow.bias = -0.0006; l.shadow.normalBias = 0.05;
    l.name = 'sun';
    return l;
  }, [textures]);
  const skyLight = useMemo(() => { const p = new SkyLightProbe(); p.irradianceTexture = textures.irradianceTexture; return p; }, [textures]);

  const pipeline = useMemo(() => {
    const composer = new EffectComposer(gl, { frameBufferType: HalfFloatType, multisampling: 4 }); // offscreen targets get no canvas antialias
    const copy = new CopyPass();
    const mask = new LightingMaskPass(scene, camera);
    mask.selectionLayer = LIT_LAYER; // lit materials (clay, people, props) are masked out; everything else is post-lit
    const aerial = new AerialPerspectiveEffect(camera, { ...textures, sunLight: true, skyLight: true, reconstructNormal: true });
    aerial.lightingMask = { map: mask.texture, channel: 'r' };
    const fill = new NightFillEffect(copy.texture);
    composer.addPass(new RenderPass(scene, camera));
    composer.addPass(copy);
    composer.addPass(mask);
    composer.addPass(new EffectPass(camera, aerial, fill, new ToneMappingEffect({ mode: ToneMappingMode.AGX })));
    return { composer, aerial, fill, mask };
  }, [gl, scene, textures]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => pipeline.composer.dispose(), [pipeline]);
  useEffect(() => { pipeline.composer.setSize(size.width, size.height); }, [pipeline, size.width, size.height]);

  useEffect(() => {
    atmosphereRender.current = dt => pipeline.composer.render(dt);
    return () => { atmosphereRender.current = null; };
  }, [pipeline]);

  const target = useMemo(() => new Vector3(), []);
  const tagged = useMemo(() => ({ t: 0 }), []);
  useFrame(() => {
    // Twice a second, put every mesh with a lit material on the mask layer (new objects appear as people add them).
    const now = performance.now();
    if (now - tagged.t > 500) {
      tagged.t = now;
      scene.traverse(o => {
        const m = (o as Mesh).material as { isMeshStandardMaterial?: boolean; isMeshLambertMaterial?: boolean; isMeshPhysicalMaterial?: boolean; isMeshPhongMaterial?: boolean } | undefined;
        if ((o as Mesh).isMesh && m && (m.isMeshStandardMaterial || m.isMeshLambertMaterial || m.isMeshPhongMaterial)) o.layers.enable(LIT_LAYER);
      });
    }
    const { aerial, fill, mask, composer } = pipeline;
    if (aerial.mainCamera !== camera) { composer.setMainCamera(camera); aerial.mainCamera = camera; mask.mainCamera = camera; }
    aerial.worldToECEFMatrix.copy(worldToECEF); aerial.sunDirection.copy(sun); aerial.moonDirection.copy(moon); aerial.albedoScale = albedoScale;
    const sm = sky.material as SkyMaterial;
    sm.worldToECEFMatrix.copy(worldToECEF); sm.sunDirection.copy(sun); sm.moonDirection.copy(moon);
    if (stars) {
      stars.setRotationFromMatrix(eciToEcef);
      const st = stars.material as StarsMaterial;
      st.worldToECEFMatrix.copy(worldToECEF); st.sunDirection.copy(sun);
    }
    // The sun's shadow box and the sky probe follow the camera's ground point.
    target.set(camera.position.x, 0, camera.position.z);
    sunLight.target.position.copy(target); sunLight.target.updateMatrixWorld();
    sunLight.worldToECEFMatrix.copy(worldToECEF); sunLight.sunDirection.copy(sun); sunLight.update();
    skyLight.position.copy(target);
    skyLight.worldToECEFMatrix.copy(worldToECEF); skyLight.sunDirection.copy(sun); skyLight.update();
    (fill.uniforms.get('fill')!.value as Vector3).set(...nightFill);
    fill.uniforms.get('exposure')!.value = exposure;
    atmosphereRender.exposure = exposure;
  }, -1);

  return (
    <>
      <primitive object={sky} />
      {stars && <primitive object={stars} />}
      <primitive object={sunLight} />
      <primitive object={sunLight.target} />
      <primitive object={skyLight} />
    </>
  );
}

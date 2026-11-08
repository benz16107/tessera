// Render layers for the AI render pass: ONLY the user's objects and lights, from the shot camera, at the photo's pixel
// size. Google tiles are switched off for the whole call (policy: tile pixels and depth never enter a render or an AI
// step), as are editor helpers (gizmos, frustums, grid, selection box, light icons).
//   beauty.png  RGBA, transparent where nothing of ours is. Lit by the sun, our lights and the image light from the photo.
//   shadow.png  shadows only, as alpha (black, transparent elsewhere): sun shadows on the street-geometry catchers plus
//               contact shadows under feet and wheels, for compositing onto the user's photo under the beauty pass.
//   depth.png   8-bit grey, white = depthNearM, black = depthFarM or empty (the convention depth-conditioned models expect).
//   mask.png    one flat colour per object, black = none; `legend` maps colours to scene_object ids.
import {
  Color, DepthTexture, Mesh, MeshBasicMaterial, NoToneMapping, OrthographicCamera, PerspectiveCamera, PlaneGeometry, Scene,
  ShaderMaterial, SRGBColorSpace, UnsignedByteType, Vector3, WebGLRenderTarget, type Material, type Object3D, type WebGLRenderer,
} from 'three';

export interface Layers {
  beauty: Blob; depth: Blob; mask: Blob; shadow: Blob;
  width: number; height: number;
  depthNearM: number; depthFarM: number;
  legend: { id: string; name: string; kind: string; color: string }[];
}

export interface LayerInput {
  gl: WebGLRenderer;
  scene: Scene;
  camera: PerspectiveCamera; // world pose of the shot camera
  vfovDeg: number; // the frame's exact vertical field of view
  width: number; height: number;
  hide: Object3D[]; // tiles group, sky, grid and anything else that is not ours
  objects: { id: bigint; name: string; kind: string; root: Object3D }[];
}

const idColor = (i: number) => new Color().setHSL(((i * 0.618034) % 1), 0.85, 0.5);

function toPng(px: Uint8Array, w: number, h: number): Promise<Blob> {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(w, h);
  for (let y = 0; y < h; y++) img.data.set(px.subarray((h - 1 - y) * w * 4, (h - y) * w * 4), y * w * 4); // GL rows are bottom-up
  ctx.putImageData(img, 0, 0);
  return new Promise((ok, no) => c.toBlob(b => (b ? ok(b) : no(new Error('PNG encode failed'))), 'image/png'));
}

export async function renderLayers(inp: LayerInput): Promise<Layers> {
  const { gl, scene, width: w, height: h } = inp;
  const cam = new PerspectiveCamera(inp.vfovDeg, w / h, 0.1, 5000);
  inp.camera.updateMatrixWorld();
  cam.matrixWorld.copy(inp.camera.matrixWorld);
  cam.matrixWorld.decompose(cam.position, cam.quaternion, cam.scale);
  cam.updateMatrixWorld();

  const helpers: Object3D[] = [];
  scene.traverse(o => { if (o.userData.helper && o.visible) helpers.push(o); });
  const hidden = [...inp.hide.filter(o => o.visible), ...helpers];
  const bg = scene.background, tm = gl.toneMapping, rt0 = gl.getRenderTarget();
  const clear = gl.getClearColor(new Color()), clearA = gl.getClearAlpha();
  const xr = gl.xr.enabled;
  hidden.forEach(o => (o.visible = false));
  scene.background = null;
  gl.toneMapping = NoToneMapping; gl.xr.enabled = false;
  gl.setClearColor(0x000000, 0);

  const read = (rt: WebGLRenderTarget) => { const px = new Uint8Array(w * h * 4); gl.readRenderTargetPixels(rt, 0, 0, w, h, px); return px; };
  const dispose: { dispose(): void }[] = [];
  // Facade occluders (depth only) stay on in every pass, so objects behind a wall are cut where the wall is.
  const occluders: Object3D[] = [];
  scene.traverse(o => { if (o.userData.occluder && !o.visible) occluders.push(o); });
  occluders.forEach(o => (o.visible = true));
  const shadowOnly: Object3D[] = [];
  scene.traverse(o => { if ((o.userData.catcher || o.userData.contact) && o.visible) shadowOnly.push(o); });
  try {
    // Shadow pass: the objects still cast into the shadow maps but write no colour or depth.
    const objMats: { m: Material; c: boolean; d: boolean }[] = [];
    for (const ob of inp.objects) ob.root.traverse(o => {
      const m = o as Mesh;
      if (!m.isMesh || o.userData.contact) return;
      for (const mat of Array.isArray(m.material) ? m.material : [m.material]) { objMats.push({ m: mat, c: mat.colorWrite, d: mat.depthWrite }); mat.colorWrite = false; mat.depthWrite = false; }
    });
    const rtS = new WebGLRenderTarget(w, h, { samples: 4, type: UnsignedByteType });
    dispose.push(rtS);
    gl.setRenderTarget(rtS); gl.clear(); gl.render(scene, cam);
    const shadowPx = read(rtS);
    objMats.forEach(x => { x.m.colorWrite = x.c; x.m.depthWrite = x.d; });
    for (let i = 0; i < shadowPx.length; i += 4) { shadowPx[i] = shadowPx[i + 1] = shadowPx[i + 2] = 0; } // pure black, darkness in alpha

    // Beauty and everything after: objects only; catchers and contact shadows are off from here on.
    shadowOnly.forEach(o => (o.visible = false));
    hidden.push(...shadowOnly);
    const rtB = new WebGLRenderTarget(w, h, { samples: 4, type: UnsignedByteType });
    rtB.texture.colorSpace = SRGBColorSpace;
    dispose.push(rtB);
    gl.setRenderTarget(rtB); gl.clear(); gl.render(scene, cam);
    const beautyPx = read(rtB);

    // Depth from the depth buffer of the same view (handles skinned people), linearised to metres.
    const depthTex = new DepthTexture(w, h);
    const rtD = new WebGLRenderTarget(w, h, { depthTexture: depthTex });
    dispose.push(rtD, depthTex);
    gl.setRenderTarget(rtD); gl.clear(); gl.render(scene, cam);
    const ranges = inp.objects.filter(o => o.root.visible).map(o => cam.position.distanceTo(o.root.getWorldPosition(new Vector3())));
    const nearM = Math.max(0.1, Math.min(...ranges, 50) - 3), farM = Math.max(nearM + 1, Math.max(...ranges, 10) + 8);
    const quadMat = new ShaderMaterial({
      uniforms: { tDepth: { value: depthTex }, cn: { value: cam.near }, cf: { value: cam.far }, nM: { value: nearM }, fM: { value: farM } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: `#include <packing>
        varying vec2 vUv; uniform sampler2D tDepth; uniform float cn, cf, nM, fM;
        void main(){ float d = texture2D(tDepth, vUv).x; if (d >= 1.0) { gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }
          float z = -perspectiveDepthToViewZ(d, cn, cf); float v = clamp(1.0 - (z - nM) / (fM - nM), 0.0, 1.0);
          gl_FragColor = vec4(vec3(v), 1.0); }`,
    });
    const quad = new Mesh(new PlaneGeometry(2, 2), quadMat);
    const qs = new Scene(); qs.add(quad);
    const rtQ = new WebGLRenderTarget(w, h, { type: UnsignedByteType });
    dispose.push(rtQ, quadMat, quad.geometry);
    gl.setRenderTarget(rtQ); gl.clear(); gl.render(qs, new OrthographicCamera(-1, 1, 1, -1, 0, 1));
    const depthPx = read(rtQ);

    // Object-ID mask: flat colours, no lights, no shadows, no AA.
    const swapped: [Mesh, Material | Material[]][] = [];
    const legend: Layers['legend'] = [];
    inp.objects.forEach((ob, i) => {
      const c = idColor(i);
      const mat = new MeshBasicMaterial({ color: c });
      dispose.push(mat);
      legend.push({ id: String(ob.id), name: ob.name, kind: ob.kind, color: '#' + c.getHexString() });
      ob.root.traverse(o => { const m = o as Mesh; if (m.isMesh) { swapped.push([m, m.material]); m.material = mat; } });
    });
    const rtM = new WebGLRenderTarget(w, h, { type: UnsignedByteType });
    rtM.texture.colorSpace = SRGBColorSpace;
    dispose.push(rtM);
    gl.setRenderTarget(rtM); gl.clear(); gl.render(scene, cam);
    const maskPx = read(rtM);
    swapped.forEach(([m, mat]) => (m.material = mat));
    for (let i = 3; i < maskPx.length; i += 4) { if (maskPx[i] === 0) { maskPx[i - 3] = maskPx[i - 2] = maskPx[i - 1] = 0; } maskPx[i] = 255; }

    const [beauty, depth, mask, shadow] = await Promise.all([toPng(beautyPx, w, h), toPng(depthPx, w, h), toPng(maskPx, w, h), toPng(shadowPx, w, h)]);
    return { beauty, depth, mask, shadow, width: w, height: h, depthNearM: nearM, depthFarM: farM, legend };
  } finally {
    hidden.forEach(o => (o.visible = true));
    occluders.forEach(o => (o.visible = false));
    scene.background = bg;
    gl.toneMapping = tm; gl.xr.enabled = xr;
    gl.setClearColor(clear, clearA);
    gl.setRenderTarget(rt0);
    dispose.forEach(d => d.dispose());
  }
}

/** Fallback when the NVIDIA RenderPanel is not mounted: POST the layers to the crew (crew/ owns /api/render). */
export async function postRender(l: Layers, fields: Record<string, string>) {
  const fd = new FormData();
  fd.append('beauty', l.beauty, 'beauty.png');
  fd.append('depth', l.depth, 'depth.png');
  fd.append('mask', l.mask, 'mask.png');
  fd.append('shadow', l.shadow, 'shadow.png');
  fd.append('legend', JSON.stringify(l.legend));
  fd.append('depthNearM', String(l.depthNearM));
  fd.append('depthFarM', String(l.depthFarM));
  fd.append('width', String(l.width));
  fd.append('height', String(l.height));
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  const r = await fetch('/api/render', { method: 'POST', body: fd });
  const text = await r.text();
  if (!r.ok) throw new Error(`render ${r.status}: ${text.slice(0, 200)}`);
  return text;
}

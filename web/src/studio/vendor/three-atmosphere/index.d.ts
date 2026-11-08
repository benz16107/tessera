// Vendored @takram/three-atmosphere 0.19.1 (MIT, Shota Matsuda; Bruneton's precomputed scattering, BSD; see LICENSE),
// the plain three.js build only: the npm package's peers need React 19 and R3F 9, and this app is on React 18 and R3F 8.
// Upstream: https://github.com/takram-design-engineering/three-geospatial. Replace with the npm package after an upgrade.
// These declarations cover only what web/src/studio uses; the full types are in the upstream package.
import type { BufferGeometry, Camera, Data3DTexture, DirectionalLight, LightProbe, Matrix4, Scene, ShaderMaterial, Texture, Vector3, WebGLRenderer } from 'three';
import type { Effect, Pass } from 'postprocessing';

export interface PrecomputedTextures {
  irradianceTexture: Texture; scatteringTexture: Data3DTexture; transmittanceTexture: Texture;
  singleMieScatteringTexture?: Data3DTexture; higherOrderScatteringTexture?: Data3DTexture;
}
interface EcefParams { worldToECEFMatrix: Matrix4; sunDirection: Vector3; correctAltitude: boolean }

export declare class PrecomputedTexturesGenerator {
  constructor(renderer: WebGLRenderer, options?: { combinedScattering?: boolean; higherOrderScattering?: boolean });
  textures: PrecomputedTextures;
  update(): Promise<PrecomputedTextures>;
  dispose(options?: { textures?: boolean }): void;
}

export declare class AerialPerspectiveEffect extends Effect implements EcefParams {
  constructor(camera?: Camera, options?: Partial<PrecomputedTextures> & { normalBuffer?: Texture | null; reconstructNormal?: boolean; sunLight?: boolean; skyLight?: boolean; albedoScale?: number; sky?: boolean });
  mainCamera: Camera;
  normalBuffer: Texture | null; reconstructNormal: boolean;
  sunLight: boolean; skyLight: boolean; albedoScale: number; sky: boolean; transmittance: boolean; inscatter: boolean;
  worldToECEFMatrix: Matrix4; sunDirection: Vector3; moonDirection: Vector3; correctAltitude: boolean; correctGeometricError: boolean;
}

export declare class SkyMaterial extends ShaderMaterial implements EcefParams {
  worldToECEFMatrix: Matrix4; sunDirection: Vector3; moonDirection: Vector3; correctAltitude: boolean;
  sun: boolean; moon: boolean; ground: boolean;
}

export declare class StarsMaterial extends ShaderMaterial implements EcefParams {
  worldToECEFMatrix: Matrix4; sunDirection: Vector3; correctAltitude: boolean;
  pointSize: number; intensity: number; background: boolean;
}
export declare class StarsGeometry extends BufferGeometry { constructor(data: ArrayBuffer) }

export declare class SunDirectionalLight extends DirectionalLight implements EcefParams {
  transmittanceTexture: Texture | null; worldToECEFMatrix: Matrix4; sunDirection: Vector3; correctAltitude: boolean; distance: number;
  update(): void;
}
export declare class SkyLightProbe extends LightProbe implements EcefParams {
  irradianceTexture: Texture | null; worldToECEFMatrix: Matrix4; sunDirection: Vector3; correctAltitude: boolean;
  update(): void;
}

export declare class LightingMaskPass extends Pass {
  constructor(scene: Scene, camera: Camera);
  selectionLayer: number; inverted: boolean;
  set mainCamera(value: Camera);
}

export declare function getECIToECEFRotationMatrix(date: number | Date, result?: Matrix4): Matrix4;
export declare function getSunDirectionECI(date: number | Date, result?: Vector3): Vector3;
export declare function getMoonDirectionECI(date: number | Date, result?: Vector3): Vector3;
export declare function getSunDirectionECEF(date: number | Date, result?: Vector3): Vector3;
export declare function getMoonDirectionECEF(date: number | Date, result?: Vector3): Vector3;

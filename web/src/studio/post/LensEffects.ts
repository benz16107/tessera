// Look-through post effects (postprocessing Effects):
//  DofEffect: thin-lens depth of field. Each pixel's blur circle is optics.ts blurCircleMm, c = f^2 |z - s| / (N z (s - f)),
//    converted from millimetres on the sensor to render pixels, gathered over a 48-tap disc.
//  LensEffect: lensfun radial distortion (mainUv maps each output pixel to the undistorted, overscanned render with the
//    same Newton inversion as profiles.ts), then vignetting (lensfun "pa" model when measured, else natural cos^4 falloff),
//    exposure in stops from the meter, and white balance gains (von Kries, optics.ts whiteBalanceGains).
import { Effect, EffectAttribute } from 'postprocessing';
import { Uniform, Vector2, Vector3, Vector4 } from 'three';

const dofFrag = /* glsl */ `
uniform float focalM;
uniform float aperture;
uniform float focusM;
uniform float pxPerMm;
uniform float maxR;

float cocPx(float z) {
  float s = max(focusM, focalM * 1.001);
  float c = focalM * focalM * abs(z - s) / (aperture * max(z, 1e-3) * (s - focalM)); // metres on the sensor
  return min(0.5 * c * 1000.0 * pxPerMm, maxR);
}

void mainImage(const in vec4 inputColor, const in vec2 uv, const in float depth, out vec4 outputColor) {
  float z = -getViewZ(depth);
  float r = cocPx(z);
  if (r < 0.5) { outputColor = inputColor; return; }
  vec4 acc = inputColor;
  float wsum = 1.0;
  for (int i = 0; i < 48; i++) {
    float fi = float(i) + 0.5;
    float rr = sqrt(fi / 48.0) * r;
    float th = fi * 2.39996323;
    vec2 suv = uv + vec2(cos(th), sin(th)) * rr * texelSize;
    float sz = -getViewZ(readDepth(suv));
    // Nearer samples only count when their own blur reaches this pixel, so sharp foregrounds keep their edges.
    float w = sz < z ? smoothstep(rr - 1.0, rr + 1.0, cocPx(sz)) : 1.0;
    acc += texture2D(inputBuffer, suv) * w;
    wsum += w;
  }
  outputColor = acc / wsum;
}`;

export class DofEffect extends Effect {
  constructor() {
    super('DofEffect', dofFrag, {
      attributes: EffectAttribute.CONVOLUTION | EffectAttribute.DEPTH,
      uniforms: new Map<string, Uniform>([
        ['focalM', new Uniform(0.05)], ['aperture', new Uniform(4)], ['focusM', new Uniform(10)],
        ['pxPerMm', new Uniform(40)], ['maxR', new Uniform(28)],
      ]),
    });
  }
  set(focalMm: number, aperture: number, focusM: number, pxPerMm: number) {
    const u = this.uniforms;
    u.get('focalM')!.value = focalMm / 1000; u.get('aperture')!.value = aperture; u.get('focusM')!.value = focusM; u.get('pxPerMm')!.value = pxPerMm;
  }
}

const lensFrag = /* glsl */ `
uniform vec2 frameScale;   // the frame's size as a fraction of the viewport
uniform vec2 center;       // the frame's centre (the optical axis) in viewport uv
uniform vec2 sensorMm;     // the frame's size on the sensor
uniform float distOn;
uniform float c0;
uniform vec4 c14;          // Rd = Ru (c0 + c1 Ru + c2 Ru^2 + c3 Ru^3 + c4 Ru^4)
uniform float unitMm;      // lensfun distortion radius 1, in mm
uniform float overscan;
uniform float vigMode;     // 0 off, 1 cos^4, 2 lensfun pa
uniform vec3 vigK;
uniform float vigUnitMm;
uniform float focalMm;
uniform float gain;        // 2^stops
uniform vec3 wb;
uniform float clip;        // 1: transparent outside the frame (the user's photo is the backplate)

float distortR(float ru) { return ru * (c0 + ru * (c14.x + ru * (c14.y + ru * (c14.z + ru * c14.w)))); }
float distortD(float ru) { return c0 + ru * (2.0 * c14.x + ru * (3.0 * c14.y + ru * (4.0 * c14.z + ru * 5.0 * c14.w))); }

void mainUv(inout vec2 uv) {
  if (distOn < 0.5) return;
  vec2 p = (uv - center) / frameScale;
  vec2 mm = p * sensorMm;
  float rd = length(mm) / unitMm;
  float ru = rd;
  for (int i = 0; i < 6; i++) { ru -= (distortR(ru) - rd) / max(distortD(ru), 1e-4); }
  float s = rd > 1e-6 ? ru / rd : 1.0;
  uv = center + p * s / overscan * frameScale;
}

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  vec2 p = (vUv - center) / frameScale;
  if (clip > 0.5 && (abs(p.x) > 0.5 || abs(p.y) > 0.5)) { outputColor = vec4(0.0); return; }
  float rmm = length(p * sensorMm);
  float v = 1.0;
  if (vigMode > 1.5) { float r2 = pow(rmm / vigUnitMm, 2.0); v = 1.0 + vigK.x * r2 + vigK.y * r2 * r2 + vigK.z * r2 * r2 * r2; }
  else if (vigMode > 0.5) { float c = cos(atan(rmm / focalMm)); v = c * c * c * c; }
  outputColor = vec4(inputColor.rgb * v * gain * wb, inputColor.a);
}`;

export class LensEffect extends Effect {
  constructor() {
    super('LensEffect', lensFrag, {
      uniforms: new Map<string, Uniform>([
        ['frameScale', new Uniform(new Vector2(1, 1))], ['center', new Uniform(new Vector2(0.5, 0.5))], ['sensorMm', new Uniform(new Vector2(36, 24))],
        ['distOn', new Uniform(0)], ['c0', new Uniform(1)], ['c14', new Uniform(new Vector4())], ['unitMm', new Uniform(12)],
        ['overscan', new Uniform(1)], ['vigMode', new Uniform(1)], ['vigK', new Uniform(new Vector3())], ['vigUnitMm', new Uniform(21.6)],
        ['focalMm', new Uniform(50)], ['gain', new Uniform(1)], ['wb', new Uniform(new Vector3(1, 1, 1))], ['clip', new Uniform(0)],
      ]),
    });
  }
}

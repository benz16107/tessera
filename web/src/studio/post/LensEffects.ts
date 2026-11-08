// Look-through post effects (postprocessing Effects), in pass order:
//  DofEffect: thin-lens depth of field. Each pixel's blur circle is optics.ts blurCircleMm, c = f^2 |z - s| / (N z (s - f)),
//    converted from millimetres on the sensor to render pixels and gathered over 48 taps shaped like the aperture: a
//    polygon with the lens's blade count once stopped down, clipped toward the frame centre near the edges (cat-eye,
//    mechanical vignetting, strongest wide open), bright samples weighted up so highlights bloom into discs, and never
//    smaller than the diffraction Airy disk.
//  MotionEffect: shutter motion blur of walking people (each one's screen velocity x shutter, masked by its depth band)
//    and a handheld shake preview (the whole frame along one direction) below the safe shutter speed.
//  TcaEffect: lensfun lateral chromatic aberration: red and blue images scaled radially against green.
//  LensEffect: lensfun radial distortion (mainUv maps each output pixel to the undistorted, overscanned render with the
//    same Newton inversion as profiles.ts), vignetting (lensfun "pa" model when measured, else cos^4 plus optical
//    vignetting that fades as you stop down), exposure in stops from the meter, white balance and tint gains, starbursts
//    on point lights stopped down, and sensor noise for the ISO and sensor size.
import { Effect, EffectAttribute } from 'postprocessing';
import { Uniform, Vector2, Vector3, Vector4 } from 'three';

const LUMA = 'vec3(0.2126, 0.7152, 0.0722)';

const dofFrag = /* glsl */ `
uniform float focalM;
uniform float aperture;
uniform float focusM;
uniform float pxPerMm;
uniform float maxR;
uniform float minR;      // diffraction: the Airy disk radius in render pixels
uniform float blades;
uniform float bladeRot;
uniform float polyAmt;   // 0 round (wide open, rounded blades), 1 the full polygon
uniform float catEye;    // 0 none, about 0.5 wide open
uniform float hiBoost;   // highlight weight
uniform vec2 frameScale;
uniform vec2 center;

float cocPx(float z) {
  float s = max(focusM, focalM * 1.001);
  float c = focalM * focalM * abs(z - s) / (aperture * max(z, 1e-3) * (s - focalM)); // metres on the sensor
  return min(0.5 * c * 1000.0 * pxPerMm, maxR);
}
float polyR(float th) {
  if (blades < 3.0) return 1.0;
  float seg = 6.2831853 / blades;
  float a = mod(th - bladeRot, seg) - seg * 0.5;
  return mix(1.0, cos(seg * 0.5) / cos(a), polyAmt);
}
float hiW(vec3 c) { return 1.0 + hiBoost * smoothstep(0.82, 1.0, dot(c, ${LUMA})); }

void mainImage(const in vec4 inputColor, const in vec2 uv, const in float depth, out vec4 outputColor) {
  float z = -getViewZ(depth);
  float r = max(cocPx(z), minR);
  if (r < 0.5) { outputColor = inputColor; return; }
  vec2 p = (uv - center) / frameScale;          // frame coordinates, -0.5 to 0.5
  vec2 ce = -p * 2.0 * catEye;                   // the clipping circle slides toward the centre near the edges
  float w0 = hiW(inputColor.rgb);
  vec4 acc = inputColor * w0;
  float wsum = w0;
  for (int i = 0; i < 48; i++) {
    float fi = float(i) + 0.5;
    float th = fi * 2.39996323;
    vec2 d = vec2(cos(th), sin(th)) * sqrt(fi / 48.0) * polyR(th);
    float keep = step(length(d - ce), 1.0);
    vec2 suv = uv + d * r * texelSize;
    float sz = -getViewZ(readDepth(suv));
    float rr = length(d) * r;
    // Nearer samples only count when their own blur reaches this pixel, so sharp foregrounds keep their edges.
    float w = (sz < z ? smoothstep(rr - 1.0, rr + 1.0, max(cocPx(sz), minR)) : 1.0) * keep;
    vec4 c = texture2D(inputBuffer, suv);
    w *= hiW(c.rgb);
    acc += c * w;
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
        ['pxPerMm', new Uniform(40)], ['maxR', new Uniform(28)], ['minR', new Uniform(0)],
        ['blades', new Uniform(9)], ['bladeRot', new Uniform(0.3)], ['polyAmt', new Uniform(0)], ['catEye', new Uniform(0)],
        ['hiBoost', new Uniform(6)], ['frameScale', new Uniform(new Vector2(1, 1))], ['center', new Uniform(new Vector2(0.5, 0.5))],
      ]),
    });
  }
  set(focalMm: number, aperture: number, focusM: number, pxPerMm: number) {
    const u = this.uniforms;
    u.get('focalM')!.value = focalMm / 1000; u.get('aperture')!.value = aperture; u.get('focusM')!.value = focusM; u.get('pxPerMm')!.value = pxPerMm;
  }
}

const motionFrag = /* glsl */ `
uniform vec4 box[4];    // each walker's screen box (uv min, max)
uniform vec2 vel[4];    // its movement during the shutter, in uv
uniform vec2 band[4];   // its view-depth band (near, far), metres
uniform float count;
uniform vec2 shake;     // the handheld shake path during the shutter, in uv

void mainImage(const in vec4 inputColor, const in vec2 uv, const in float depth, out vec4 outputColor) {
  vec4 col = inputColor;
  if (length(shake) > 0.0004) {
    vec4 acc = vec4(0.0);
    for (int j = 0; j < 12; j++) acc += texture2D(inputBuffer, uv + shake * (float(j) / 11.0 - 0.5));
    col = acc / 12.0;
  }
  float zc = -getViewZ(depth);
  for (int i = 0; i < 4; i++) {
    if (float(i) >= count) break;
    vec2 v = vel[i];
    vec2 lo = box[i].xy - abs(v) * 0.5, hi = box[i].zw + abs(v) * 0.5;
    if (uv.x < lo.x || uv.y < lo.y || uv.x > hi.x || uv.y > hi.y) continue;
    vec3 pAcc = vec3(0.0), bAcc = vec3(0.0);
    float np = 0.0;
    for (int j = 0; j < 16; j++) {
      vec2 suv = uv + v * (float(j) / 15.0 - 0.5);
      float sz = -getViewZ(readDepth(suv));
      float isP = step(band[i].x, sz) * step(sz, band[i].y);
      vec3 c = texture2D(inputBuffer, suv).rgb;
      pAcc += c * isP; bAcc += c * (1.0 - isP); np += isP;
    }
    if (np < 0.5) continue;
    bool self = zc >= band[i].x && zc <= band[i].y;
    vec3 bg = self ? (np > 15.5 ? pAcc / np : bAcc / (16.0 - np)) : col.rgb;
    col.rgb = mix(bg, pAcc / np, np / 16.0);
  }
  outputColor = col;
}`;

export class MotionEffect extends Effect {
  constructor() {
    super('MotionEffect', motionFrag, {
      attributes: EffectAttribute.CONVOLUTION | EffectAttribute.DEPTH,
      uniforms: new Map<string, Uniform>([
        ['box', new Uniform([new Vector4(), new Vector4(), new Vector4(), new Vector4()])],
        ['vel', new Uniform([new Vector2(), new Vector2(), new Vector2(), new Vector2()])],
        ['band', new Uniform([new Vector2(), new Vector2(), new Vector2(), new Vector2()])],
        ['count', new Uniform(0)], ['shake', new Uniform(new Vector2())],
      ]),
    });
  }
}

const tcaFrag = /* glsl */ `
uniform vec2 frameScale;
uniform vec2 center;
uniform vec2 sensorMm;
uniform float unitMm;
uniform float overscan;
uniform vec3 tr;   // red radius vs green: v + c r + b r^2 (lensfun TCA)
uniform vec3 tb;

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  vec2 q = (uv - center) / frameScale * overscan;
  float ru = length(q * sensorMm) / unitMm;
  float sr = tr.x + tr.y * ru + tr.z * ru * ru, sb = tb.x + tb.y * ru + tb.z * ru * ru;
  // A channel magnified by s shows at radius R what the green image has at R / s.
  outputColor = vec4(texture2D(inputBuffer, center + (uv - center) / sr).r, inputColor.g, texture2D(inputBuffer, center + (uv - center) / sb).b, inputColor.a);
}`;

export class TcaEffect extends Effect {
  constructor() {
    super('TcaEffect', tcaFrag, {
      attributes: EffectAttribute.CONVOLUTION,
      uniforms: new Map<string, Uniform>([
        ['frameScale', new Uniform(new Vector2(1, 1))], ['center', new Uniform(new Vector2(0.5, 0.5))], ['sensorMm', new Uniform(new Vector2(36, 24))],
        ['unitMm', new Uniform(12)], ['overscan', new Uniform(1)], ['tr', new Uniform(new Vector3(1, 0, 0))], ['tb', new Uniform(new Vector3(1, 0, 0))],
      ]),
    });
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
uniform float vigMode;     // 0 off, 1 cos^4 plus optical vignetting, 2 lensfun pa
uniform vec3 vigK;
uniform float vigUnitMm;
uniform float optVig;      // optical vignetting at the corner (no profile), fades as you stop down
uniform float focalMm;
uniform float gain;        // 2^stops
uniform vec3 wb;           // white balance and tint gains
uniform float clip;        // 1: transparent outside the frame (the user's photo is the backplate)
uniform float noise;       // sensor noise sigma on screen
uniform vec4 stars[8];     // point lights: viewport uv, strength, spike length in pixels
uniform float starCount;
uniform float spikes;
uniform float starRot;

float distortR(float ru) { return ru * (c0 + ru * (c14.x + ru * (c14.y + ru * (c14.z + ru * c14.w)))); }
float distortD(float ru) { return c0 + ru * (2.0 * c14.x + ru * (3.0 * c14.y + ru * (4.0 * c14.z + ru * 5.0 * c14.w))); }
// Sine-free hash (Dave Hoskins): a sine hash loses precision at large pixel coordinates and draws a hatch pattern.
float hash(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }

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
  else if (vigMode > 0.5) {
    float c = cos(atan(rmm / focalMm)); v = c * c * c * c;
    v *= 1.0 - optVig * smoothstep(0.35, 1.0, rmm / (0.5 * length(sensorMm)));
  }
  vec3 col = inputColor.rgb * v * gain * wb;
  // Starbursts: each point light diffracts into thin spikes, one pair per blade edge (optics.ts starSpikes).
  vec2 px = vUv * resolution;
  for (int i = 0; i < 8; i++) {
    if (float(i) >= starCount) break;
    vec2 d = px - stars[i].xy * resolution;
    float glow = exp(-dot(d, d) / 18.0);
    float s = 0.0;
    for (int k = 0; k < 22; k++) {
      if (float(k) >= spikes) break;
      float a = starRot + float(k) * 6.2831853 / spikes;
      vec2 dir = vec2(cos(a), sin(a));
      float along = dot(d, dir), perp = abs(d.x * dir.y - d.y * dir.x);
      s += step(0.0, along) * exp(-perp * 1.1) * exp(-along / stars[i].w);
    }
    col += stars[i].z * (s * 0.9 + glow) * vec3(1.0, 0.97, 0.9);
  }
  // Sensor noise: luminance grain plus some chroma, stronger in the shadows, animated like live view.
  if (noise > 0.0) {
    float l = clamp(dot(col, ${LUMA}), 0.0, 1.0);
    float sig = noise * (0.6 + 0.6 * (1.0 - l));
    vec2 seed = floor(px) + mod(floor(time * 24.0), 61.0) * vec2(17.0, 31.0);
    float nl = hash(seed) + hash(seed + 1.7) + hash(seed + 3.1) - 1.5;
    vec3 nc = vec3(hash(seed + 5.3), hash(seed + 7.9), hash(seed + 11.3)) - 0.5;
    col += sig * (nl * 1.2 + nc * 0.6);
  }
  outputColor = vec4(col, inputColor.a);
}`;

export class LensEffect extends Effect {
  constructor() {
    super('LensEffect', lensFrag, {
      uniforms: new Map<string, Uniform>([
        ['frameScale', new Uniform(new Vector2(1, 1))], ['center', new Uniform(new Vector2(0.5, 0.5))], ['sensorMm', new Uniform(new Vector2(36, 24))],
        ['distOn', new Uniform(0)], ['c0', new Uniform(1)], ['c14', new Uniform(new Vector4())], ['unitMm', new Uniform(12)],
        ['overscan', new Uniform(1)], ['vigMode', new Uniform(1)], ['vigK', new Uniform(new Vector3())], ['vigUnitMm', new Uniform(21.6)],
        ['optVig', new Uniform(0)], ['focalMm', new Uniform(50)], ['gain', new Uniform(1)], ['wb', new Uniform(new Vector3(1, 1, 1))], ['clip', new Uniform(0)],
        ['noise', new Uniform(0)], ['stars', new Uniform(Array.from({ length: 8 }, () => new Vector4()))], ['starCount', new Uniform(0)],
        ['spikes', new Uniform(0)], ['starRot', new Uniform(0.35)],
      ]),
    });
  }
}

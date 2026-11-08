// Camera bodies and sensors. Sizes and pixel counts are the makers' published specs, typed by hand.
// The phone "bodies" are one camera module each; their sensor area comes from the EXIF focal length and Apple's
// stated 35 mm equivalent (diagonal = 43.27 * f / f35), so the equivalent and the field of view agree exactly.

export type Mount = 'sony-e' | 'canon-rf' | 'nikon-z' | 'fuji-x' | 'fuji-gf' | 'mft' | 'fixed';
export type Format = 'ff' | 'apsc' | 'apsc-canon' | 'mft' | 'gf' | '1in' | 'phone';

export interface BodySpec {
  id: string;
  name: string;
  maker: string;
  mount: Mount;
  format: Format;
  sensorMm: [number, number]; // width x height of the image area, landscape
  px: [number, number]; // default full-resolution output
  ibisStops: number; // CIPA in-body stabilisation rating, 0 when none or unrated
  fixedLens?: string; // lens id for fixed-lens cameras and phone modules
}

export interface Body extends BodySpec {
  diagMm: number;
  crop: number; // 35 mm crop factor on the diagonal
  pitchUm: number; // pixel pitch of the default output
  cocMm: number; // circle of confusion for depth of field
}

export const FULL_FRAME_DIAG = Math.hypot(36, 24); // 43.27 mm

const phone = (id: string, name: string, fMm: number, f35: number, px: [number, number], lens: string): BodySpec => {
  const d = (FULL_FRAME_DIAG * fMm) / f35; // EXIF focal x crop = stated equivalent
  return { id, name, maker: 'Apple', mount: 'fixed', format: 'phone', sensorMm: [d * 0.8, d * 0.6], px, ibisStops: 0, fixedLens: lens };
};

const SPECS: BodySpec[] = [
  { id: 'sony-a7iv', name: 'Sony a7 IV', maker: 'Sony', mount: 'sony-e', format: 'ff', sensorMm: [36, 24], px: [7008, 4672], ibisStops: 5.5 },
  { id: 'sony-a7rv', name: 'Sony a7R V', maker: 'Sony', mount: 'sony-e', format: 'ff', sensorMm: [36, 24], px: [9504, 6336], ibisStops: 8 },
  { id: 'canon-r5', name: 'Canon EOS R5', maker: 'Canon', mount: 'canon-rf', format: 'ff', sensorMm: [36, 24], px: [8192, 5464], ibisStops: 8 },
  { id: 'canon-r6ii', name: 'Canon EOS R6 Mark II', maker: 'Canon', mount: 'canon-rf', format: 'ff', sensorMm: [36, 24], px: [6000, 4000], ibisStops: 8 },
  { id: 'nikon-z8', name: 'Nikon Z8', maker: 'Nikon', mount: 'nikon-z', format: 'ff', sensorMm: [36, 24], px: [8256, 5504], ibisStops: 6 },
  { id: 'nikon-z6iii', name: 'Nikon Z6III', maker: 'Nikon', mount: 'nikon-z', format: 'ff', sensorMm: [36, 24], px: [6048, 4032], ibisStops: 8 },
  { id: 'sony-a6700', name: 'Sony a6700', maker: 'Sony', mount: 'sony-e', format: 'apsc', sensorMm: [23.5, 15.6], px: [6192, 4128], ibisStops: 5 },
  { id: 'nikon-z50ii', name: 'Nikon Z50II', maker: 'Nikon', mount: 'nikon-z', format: 'apsc', sensorMm: [23.5, 15.6], px: [5568, 3712], ibisStops: 0 },
  { id: 'fuji-xt5', name: 'Fujifilm X-T5', maker: 'Fujifilm', mount: 'fuji-x', format: 'apsc', sensorMm: [23.5, 15.6], px: [7728, 5152], ibisStops: 7 },
  { id: 'canon-r7', name: 'Canon EOS R7', maker: 'Canon', mount: 'canon-rf', format: 'apsc-canon', sensorMm: [22.3, 14.9], px: [6960, 4640], ibisStops: 7 },
  { id: 'om-1', name: 'OM System OM-1', maker: 'OM System', mount: 'mft', format: 'mft', sensorMm: [17.3, 13], px: [5184, 3888], ibisStops: 7 },
  { id: 'fuji-gfx100ii', name: 'Fujifilm GFX100 II', maker: 'Fujifilm', mount: 'fuji-gf', format: 'gf', sensorMm: [43.8, 32.9], px: [11648, 8736], ibisStops: 8 },
  { id: 'sony-rx100vii', name: 'Sony RX100 VII', maker: 'Sony', mount: 'fixed', format: '1in', sensorMm: [13.2, 8.8], px: [5472, 3648], ibisStops: 0, fixedLens: 'sony-rx100vii-lens' },
  phone('iphone15pro-main', 'iPhone 15 Pro, main 24 mm', 6.765, 24, [5712, 4284], 'iphone15pro-main-lens'),
  phone('iphone15pro-ultra', 'iPhone 15 Pro, ultrawide 13 mm', 2.22, 13, [4032, 3024], 'iphone15pro-ultra-lens'),
  phone('iphone15promax-tele', 'iPhone 15 Pro Max, 5x 120 mm', 15.66, 120, [4032, 3024], 'iphone15promax-tele-lens'),
  phone('iphone16pro-main', 'iPhone 16 Pro, main 24 mm', 6.765, 24, [5712, 4284], 'iphone16pro-main-lens'),
  phone('iphone16pro-ultra', 'iPhone 16 Pro, ultrawide 13 mm', 2.22, 13, [4032, 3024], 'iphone16pro-ultra-lens'),
  phone('iphone16pro-tele', 'iPhone 16 Pro, 5x 120 mm', 15.66, 120, [4032, 3024], 'iphone16pro-tele-lens'),
];

export function derive(b: BodySpec): Body {
  const diagMm = Math.hypot(b.sensorMm[0], b.sensorMm[1]);
  return {
    ...b,
    diagMm,
    crop: FULL_FRAME_DIAG / diagMm,
    pitchUm: (b.sensorMm[0] / b.px[0]) * 1000,
    cocMm: diagMm / 1500, // d/1500, the common print-at-viewing-distance rule (0.029 mm on full frame)
  };
}

export const BODIES: Body[] = SPECS.map(derive);
export const bodyById = (id: string) => BODIES.find(b => b.id === id);
export const DEFAULT_BODY = 'sony-a7iv';

export const FORMAT_NAME: Record<Format, string> = {
  ff: 'Full frame 36 x 24', apsc: 'APS-C 23.5 x 15.6', 'apsc-canon': 'Canon APS-C 22.3 x 14.9', mft: 'Micro Four Thirds 17.3 x 13',
  gf: 'Fujifilm GFX 43.8 x 32.9', '1in': '1-inch 13.2 x 8.8', phone: 'Phone module',
};

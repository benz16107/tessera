// Builds the Devpost gallery from real app screenshots: site/public/devpost/*.jpg (served at /devpost/).
import sharp from 'sharp';
const S = 'src/assets/shots/', O = 'public/devpost/';
const one = (src, out) => sharp(S + src).resize({ width: 1600, withoutEnlargement: true }).jpeg({ quality: 82, mozjpeg: true }).toFile(O + out);
await one('studio-polish-prod-camera.png', '1-studio-camera.jpg');
await one('simple-prod-found-desktop.png', '2-simple-found.jpg');
await one('studio-render-layers.png', '3-render.jpg');
await one('spacetime-studio-inspector.png', '5-live-data.jpg');
await one('layers-3d-high.png', '6-conditions.jpg');
// The four Simple steps side by side on the Darkroom ground.
const H = 820, G = 32, phones = ['simple-drop-phone.png', 'simple-found-phone.png', 'simple-yours-phone.png', 'simple-there-start-phone.png'];
const bufs = await Promise.all(phones.map((f) => sharp(S + f).resize({ height: H }).png().toBuffer({ resolveWithObject: true })));
let x = G; const comp = bufs.map(({ data, info }) => { const c = { input: data, left: x, top: G }; x += info.width + G; return c; });
await sharp({ create: { width: x, height: H + 2 * G, channels: 3, background: '#0b0b0a' } }).composite(comp).jpeg({ quality: 82, mozjpeg: true }).toFile(O + '4-phones.jpg');
// The social card for every page.
await sharp(S + 'studio-polish-prod-camera.png').resize(1200, 630, { fit: 'cover', position: 'centre' }).jpeg({ quality: 84, mozjpeg: true }).toFile('public/og.jpg');

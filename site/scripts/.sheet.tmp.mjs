import sharp from 'sharp';
const [out, h, ...files] = process.argv.slice(2);
const H = Number(h);
const imgs = await Promise.all(files.map(async f => { const b = await sharp(f).resize({ height: H }).png().toBuffer(); const m = await sharp(b).metadata(); return { b, w: m.width }; }));
let x = 0; const comp = imgs.map(i => { const c = { input: i.b, left: x, top: 0 }; x += i.w + 8; return c; });
await sharp({ create: { width: x, height: H, channels: 3, background: '#555' } }).composite(comp).jpeg({ quality: 70 }).toFile(out);

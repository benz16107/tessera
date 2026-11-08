// Pull measured distortion, vignetting and lateral chromatic aberration (TCA) for the studio's lens catalog from the lensfun database
// (https://github.com/lensfun/lensfun, data/db/*.xml, CC BY-SA 3.0) and write src/studio/catalog/lensfun.json.
//
//   node scripts/lensfun.ts [cacheDir]
//
// The download lands in its own directory under cacheDir (default ~/.cache/shotmatch-studio/lensfun), outside the
// repo. Only the matched lenses go into the JSON, with the lensfun file and model string they came from.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LENSES } from '../src/studio/catalog/lenses.ts';

const TARBALL = 'https://codeload.github.com/lensfun/lensfun/tar.gz/refs/heads/master';
const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, '../src/studio/catalog/lensfun.json');
const cache = process.argv[2] ?? join(homedir(), '.cache/shotmatch-studio/lensfun');
const dl = join(cache, 'download'), x = join(cache, 'extract');

const run = (cmd: string, args: string[]) => {
  const r = spawnSync(cmd, args, { stdio: 'inherit' });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ')} failed`);
};

if (!existsSync(join(dl, 'lensfun.tar.gz'))) {
  mkdirSync(dl, { recursive: true });
  run('curl', ['-sSfL', '--max-time', '300', '-o', join(dl, 'lensfun.tar.gz'), TARBALL]);
}
if (!existsSync(join(x, 'lensfun-master/data/db'))) {
  mkdirSync(x, { recursive: true });
  run('tar', ['-xzf', join(dl, 'lensfun.tar.gz'), '-C', x, '--wildcards', 'lensfun-master/data/db/*.xml', 'lensfun-master/data/db/timestamp.txt', 'lensfun-master/docs/cc-by-sa-3.0.txt']);
}
const db = join(x, 'lensfun-master/data/db');

const decode = (s: string) => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").trim();
const attrs = (tag: string) => Object.fromEntries([...tag.matchAll(/([\w-]+)="([^"]*)"/g)].map(m => [m[1], m[2]]));
const num = (v: string | undefined) => (v === undefined ? undefined : Number(v));

export interface Distortion { model: 'ptlens' | 'poly3' | 'poly5'; focal: number; a?: number; b?: number; c?: number; k1?: number; k2?: number }
export interface Vignetting { focal: number; aperture: number; distance: number; k1: number; k2: number; k3: number }
/** Red and blue radial scale relative to green: linear (kr, kb) or poly3 (vr, cr, br / vb, cb, bb); Rd = Ru (b Ru^2 + c Ru + v). */
export interface Tca { model: 'linear' | 'poly3'; focal: number; kr?: number; kb?: number; vr?: number; vb?: number; cr?: number; cb?: number; br?: number; bb?: number }
interface Parsed { file: string; maker: string; model: string; mounts: string[]; crop: number; aspect: number; distortion: Distortion[]; vignetting: Vignetting[]; tca: Tca[] }

const parsed: Parsed[] = [];
for (const file of readdirSync(db).filter(f => f.endsWith('.xml'))) {
  const xml = readFileSync(join(db, file), 'utf8').replace(/<!--[\s\S]*?-->/g, '');
  for (const [, body] of xml.matchAll(/<lens>([\s\S]*?)<\/lens>/g)) {
    const model = body.match(/<model>([^<]*)<\/model>/)?.[1];
    if (!model) continue;
    const [an, ad] = (body.match(/<aspect-ratio>([^<]*)<\/aspect-ratio>/)?.[1] ?? '3:2').split(':').map(Number);
    const distortion: Distortion[] = [];
    const vignetting: Vignetting[] = [];
    const tca: Tca[] = [];
    for (const [tag] of body.matchAll(/<tca\b[^>]*\/>/g)) {
      const a = attrs(tag);
      if (a.model === 'linear' || a.model === 'poly3') tca.push({ model: a.model, focal: Number(a.focal), kr: num(a.kr), kb: num(a.kb), vr: num(a.vr), vb: num(a.vb), cr: num(a.cr), cb: num(a.cb), br: num(a.br), bb: num(a.bb) });
    }
    for (const [tag] of body.matchAll(/<distortion\b[^>]*\/>/g)) {
      const a = attrs(tag);
      if (a.model !== 'ptlens' && a.model !== 'poly3' && a.model !== 'poly5') continue; // acm and others: skipped
      distortion.push({ model: a.model, focal: Number(a.focal), a: num(a.a), b: num(a.b), c: num(a.c), k1: num(a.k1), k2: num(a.k2) });
    }
    for (const [tag] of body.matchAll(/<vignetting\b[^>]*\/>/g)) {
      const a = attrs(tag);
      if (a.model !== 'pa') continue;
      vignetting.push({ focal: Number(a.focal), aperture: Number(a.aperture), distance: Number(a.distance ?? 1000), k1: Number(a.k1), k2: Number(a.k2), k3: Number(a.k3) });
    }
    parsed.push({
      file, maker: decode(body.match(/<maker>([^<]*)<\/maker>/)?.[1] ?? ''), model: decode(model),
      mounts: [...body.matchAll(/<mount>([^<]*)<\/mount>/g)].map(m => decode(m[1])),
      crop: Number(body.match(/<cropfactor>([^<]*)<\/cropfactor>/)?.[1] ?? 1), aspect: an / (ad || 1), distortion, vignetting, tca,
    });
  }
}

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();
const profiles: Record<string, Omit<Parsed, 'mounts'> & { mount: string }> = {};
const missing: string[] = [];
for (const lens of LENSES) {
  if (!lens.lensfun) continue;
  const hits = parsed.filter(p => norm(p.model) === norm(lens.lensfun!) && (p.distortion.length || p.vignetting.length || p.tca.length));
  if (!hits.length) { missing.push(`${lens.id}: "${lens.lensfun}"`); continue; }
  // Several files can carry the same model (adapted lenses); prefer the one with the most calibration rows.
  const best = hits.sort((a, b) => b.distortion.length + b.vignetting.length - (a.distortion.length + a.vignetting.length))[0];
  const dedupe = <T,>(xs: T[]) => [...new Map(xs.map(v => [JSON.stringify(v), v])).values()];
  profiles[lens.id] = {
    file: best.file, maker: best.maker, model: best.model, mount: best.mounts[0] ?? '', crop: best.crop, aspect: best.aspect,
    distortion: dedupe(best.distortion).sort((a, b) => a.focal - b.focal),
    vignetting: dedupe(best.vignetting).sort((a, b) => a.focal - b.focal || a.aperture - b.aperture || a.distance - b.distance),
    tca: dedupe(best.tca).sort((a, b) => a.focal - b.focal),
  };
}

const stamp = readFileSync(join(db, 'timestamp.txt'), 'utf8').trim();
writeFileSync(out, JSON.stringify({
  source: 'lensfun database, https://github.com/lensfun/lensfun (data/db)',
  license: 'CC BY-SA 3.0, https://creativecommons.org/licenses/by-sa/3.0/',
  dbTimestamp: Number(stamp) || stamp,
  fetched: new Date().toISOString().slice(0, 10),
  profiles,
}, null, 1) + '\n');

const withD = Object.values(profiles).filter(p => p.distortion.length).length;
const withV = Object.values(profiles).filter(p => p.vignetting.length).length;
const withT = Object.values(profiles).filter(p => p.tca.length).length;
console.log(`${LENSES.length} lenses, ${Object.keys(profiles).length} matched in lensfun (${withD} with distortion, ${withV} with vignetting, ${withT} with TCA).`);
if (missing.length) { console.error(`Not found in lensfun:\n  ${missing.join('\n  ')}`); process.exitCode = 1; }

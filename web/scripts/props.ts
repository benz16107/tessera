// Download the studio's prop models from Poly Pizza and record who made each one and under what license.
//
//   node scripts/props.ts
//
// For every entry in PROPS it fetches the model page, refuses anything that is not CC0 (or CC BY, which we accept with
// attribution), downloads the GLB to public/studio/props/<id>.glb and writes src/studio/catalog/props.credits.json.
// Poly Pizza rate-limits, so requests are spaced 4 s apart and pages that return its challenge are retried later.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PROPS } from '../src/studio/catalog/props.ts';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, '../public/studio/props');
const creditsPath = join(here, '../src/studio/catalog/props.credits.json');
mkdirSync(outDir, { recursive: true });

interface Credit { id: string; title: string; author: string; license: string; page: string; source: string }
const credits: Record<string, Credit> = existsSync(creditsPath) ? JSON.parse(readFileSync(creditsPath, 'utf8')) : {};
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const UA = { 'User-Agent': 'ShotMatch studio asset fetch (hackathon project)' };

const failed: string[] = [];
for (const p of PROPS) {
  const file = join(outDir, `${p.id}.glb`);
  if (existsSync(file) && credits[p.id]) continue;
  const page = `https://poly.pizza/m/${p.polyPizza}`;
  const html = await (await fetch(page, { headers: UA })).text();
  await sleep(4000);
  if (html.includes('Just a moment')) { failed.push(`${p.id}: rate-limited, run again`); continue; }
  const title = html.match(/og:title" content="([^"]*)/)?.[1]?.replace(/ - Free Model.*$/, '') ?? '';
  const author = html.match(/og:title" content="[^"]*By ([^"]*)"/)?.[1]?.trim() ?? '';
  const license = /Public Domain \(CC0\)/.test(html) ? 'CC0 1.0' : /CC-BY 4\.0|Attribution 4\.0/.test(html) ? 'CC BY 4.0' : /CC-BY 3\.0|Creative Commons Attribution/.test(html) ? 'CC BY 3.0' : '';
  const glb = html.match(/https:\/\/static\.poly\.pizza\/[0-9a-f-]+\.glb/)?.[0];
  if (!license) { failed.push(`${p.id}: no CC0 or CC BY license on ${page}`); continue; }
  if (!glb) { failed.push(`${p.id}: no GLB link on ${page}`); continue; }
  const res = await fetch(glb, { headers: UA });
  await sleep(1500);
  const buf = Buffer.from(await res.arrayBuffer());
  if (!res.ok || buf.readUInt32LE(0) !== 0x46546c67) { failed.push(`${p.id}: ${glb} is not a GLB (HTTP ${res.status})`); continue; } // 'glTF' magic
  writeFileSync(file, buf);
  credits[p.id] = { id: p.id, title, author, license, page, source: glb };
  writeFileSync(creditsPath, JSON.stringify(credits, null, 1) + '\n');
  console.log(`${p.id}: "${title}" by ${author}, ${license}, ${(buf.length / 1024).toFixed(0)} KB`);
}
if (failed.length) { console.error(failed.join('\n')); process.exitCode = 1; }

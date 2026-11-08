// Build the studio's posable person from Quaternius's Universal Animation Library (CC0 1.0).
//
//   node scripts/people.ts [cacheDir]
//
// Downloads the free glTF release (mirrored on GitHub by J-Ponzo, unchanged from itch.io 2025-06-10) into its own
// directory under cacheDir (default ~/.cache/shotmatch-studio/ual), keeps only the clips the studio uses as poses,
// recolours the mannequin to neutral greys, and packs it as public/studio/people/mannequin.glb.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = 'https://raw.githubusercontent.com/J-Ponzo/gltf-universal-animation-library/main';
const FILES = ['glTF/AnimationLibrary_Godot_Standard.gltf', 'glTF/AnimationLibrary_Godot_Standard.bin', 'LICENSE'];
// Studio pose -> UAL clip. "lean" has no clip in the free release; the studio tilts the stand pose instead.
export const CLIPS: Record<string, string> = {
  stand: 'Idle_Loop', walk: 'Walk_Loop', sit: 'Sitting_Idle_Loop', jump: 'Jump_Loop', point: 'Spell_Simple_Idle_Loop',
  talk: 'Idle_Talking_Loop', crouch: 'Crouch_Idle_Loop', push: 'Push_Loop',
};

const here = dirname(fileURLToPath(import.meta.url));
const cache = join(process.argv[2] ?? join(homedir(), '.cache/shotmatch-studio'), 'ual');
const out = join(here, '../public/studio/people/mannequin.glb');
mkdirSync(cache, { recursive: true });
for (const f of FILES) {
  const dest = join(cache, f.split('/').pop()!);
  if (!existsSync(dest)) {
    const r = spawnSync('curl', ['-sSfL', '--max-time', '300', '-o', dest, `${BASE}/${f}`], { stdio: 'inherit' });
    if (r.status !== 0) throw new Error(`download failed: ${f}`);
  }
}
if (!/CC0|Creative Commons Zero|CC0 1\.0/i.test(readFileSync(join(cache, 'LICENSE'), 'utf8'))) throw new Error('UAL LICENSE is not CC0; stop');

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const gltf: Json = JSON.parse(readFileSync(join(cache, 'AnimationLibrary_Godot_Standard.gltf'), 'utf8'));
const bin = readFileSync(join(cache, 'AnimationLibrary_Godot_Standard.bin'));

// Keep the named clips (renamed to the studio's pose names), then drop every accessor nothing references.
const byName = new Map(gltf.animations.map((a: Json) => [a.name, a]));
gltf.animations = Object.entries(CLIPS).map(([pose, clip]) => {
  const a = byName.get(clip) as Json | undefined;
  if (!a) throw new Error(`clip ${clip} missing`);
  return { ...a, name: pose };
});

const used = new Set<number>();
for (const m of gltf.meshes) for (const p of m.primitives) {
  Object.values(p.attributes as Record<string, number>).forEach(i => used.add(i));
  if (p.indices !== undefined) used.add(p.indices);
}
for (const s of gltf.skins ?? []) if (s.inverseBindMatrices !== undefined) used.add(s.inverseBindMatrices);
for (const a of gltf.animations) for (const s of a.samplers) { used.add(s.input); used.add(s.output); }

const keep = [...used].sort((a, b) => a - b);
const remap = new Map(keep.map((old, i) => [old, i]));
const chunks: Buffer[] = [];
let offset = 0;
const views: Json[] = [];
gltf.accessors = keep.map((old, i) => {
  const acc = gltf.accessors[old];
  const view = gltf.bufferViews[acc.bufferView];
  const bytes = bin.subarray(view.byteOffset ?? 0, (view.byteOffset ?? 0) + view.byteLength);
  const pad = (4 - (offset % 4)) % 4; // glTF wants 4-byte aligned views
  if (pad) { chunks.push(Buffer.alloc(pad)); offset += pad; }
  views.push({ buffer: 0, byteOffset: offset, byteLength: view.byteLength, ...(view.target ? { target: view.target } : {}) });
  chunks.push(bytes); offset += bytes.length;
  return { ...acc, bufferView: i };
});
gltf.bufferViews = views;
const fix = (i: number) => remap.get(i)!;
for (const m of gltf.meshes) for (const p of m.primitives) {
  for (const k of Object.keys(p.attributes)) p.attributes[k] = fix(p.attributes[k]);
  if (p.indices !== undefined) p.indices = fix(p.indices);
}
for (const s of gltf.skins ?? []) if (s.inverseBindMatrices !== undefined) s.inverseBindMatrices = fix(s.inverseBindMatrices);
for (const a of gltf.animations) for (const s of a.samplers) { s.input = fix(s.input); s.output = fix(s.output); }

// Neutral mannequin: the source is orange with purple joints.
for (const m of gltf.materials) {
  const g = m.name === 'M_Joints' ? 0.16 : 0.62;
  m.pbrMetallicRoughness = { ...m.pbrMetallicRoughness, baseColorFactor: [g, g, g * 0.97, 1], roughnessFactor: 0.7 };
}
gltf.asset = { ...gltf.asset, copyright: 'Universal Animation Library by Quaternius, CC0 1.0 (pruned and recoloured for Tessera)' };

let body = Buffer.concat(chunks);
body = Buffer.concat([body, Buffer.alloc((4 - (body.length % 4)) % 4)]);
gltf.buffers = [{ byteLength: body.length }];
let json = Buffer.from(JSON.stringify(gltf), 'utf8');
json = Buffer.concat([json, Buffer.alloc((4 - (json.length % 4)) % 4, 0x20)]);
const header = Buffer.alloc(12);
header.writeUInt32LE(0x46546c67, 0); header.writeUInt32LE(2, 4); header.writeUInt32LE(12 + 8 + json.length + 8 + body.length, 8);
const chunk = (len: number, type: number) => { const h = Buffer.alloc(8); h.writeUInt32LE(len, 0); h.writeUInt32LE(type, 4); return h; };
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, Buffer.concat([header, chunk(json.length, 0x4e4f534a), json, chunk(body.length, 0x004e4942), body]));
console.log(`mannequin.glb: ${gltf.animations.length} poses, ${keep.length} accessors, ${((12 + 16 + json.length + body.length) / 1024).toFixed(0)} KB`);

// Creates the bucket if needed and copies every stored photo, preview and spot photo on this box into it.
// Safe to re-run (a put overwrites with the same bytes). Usage: npx tsx scripts/bucket-sync.ts
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PHOTOS_DIR, PREVIEWS_DIR, SPOTS_DIR } from '../src/config.ts';
import { createBucket, putObject, s3Config } from '../src/s3.ts';

const c = s3Config();
if (!c) throw new Error('no ~/.config/shotmatch/vultr_s3');
const r = (await createBucket())!;
const body = await r.text();
if (!r.ok && !/BucketAlreadyOwnedByYou/.test(body)) throw new Error(`create bucket ${c.bucket}: HTTP ${r.status} ${body.slice(0, 300)}`);
console.log(`bucket ${c.bucket} on ${c.endpoint}: ${r.ok ? 'created' : 'already ours'}`);

const files: [string, string][] = [];
const add = (dir: string, prefix: string) => {
  if (existsSync(dir)) for (const f of readdirSync(dir)) if (/\.(jpe?g|png)$/i.test(f)) files.push([join(dir, f), `${prefix}/${f}`]);
};
add(PHOTOS_DIR, 'photo');
add(PREVIEWS_DIR, 'preview');
for (const s of readdirSync(SPOTS_DIR)) add(join(SPOTS_DIR, s, 'images'), `spot-photo/${s}`);
for (let i = 0; i < files.length; i += 16)
  await Promise.all(files.slice(i, i + 16).map(([f, k]) => putObject(k, readFileSync(f), /\.png$/i.test(f) ? 'image/png' : 'image/jpeg')));
console.log(`uploaded ${files.length} files`);

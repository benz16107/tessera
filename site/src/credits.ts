// Reads the repo's credit files at build time, so the site lists exactly what the app and the models use.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(process.cwd(), '..');

export type Credit = { title: string; author: string; license: string; page: string; role?: string };

function tsv(path: string): Credit[] {
  const [head, ...rows] = readFileSync(path, 'utf8').trim().split('\n');
  const cols = head.split('\t');
  return rows.map((line) => {
    const v = Object.fromEntries(line.split('\t').map((x, i) => [cols[i], x]));
    return { title: (v.title ?? '').replace(/^File:/, '').replace(/\.(jpe?g|png|tiff?)$/i, ''), author: v.author ?? '', license: v.license ?? '', page: v.page ?? '', role: v.role };
  });
}

export function spotCredits(): { spot: string; name: string; rows: Credit[] }[] {
  const dir = join(ROOT, 'spots');
  return readdirSync(dir)
    .filter((s) => existsSync(join(dir, s, 'CREDITS.tsv')))
    .map((s) => ({ spot: s, name: JSON.parse(readFileSync(join(dir, s, 'spot.json'), 'utf8')).name as string, rows: tsv(join(dir, s, 'CREDITS.tsv')) }));
}

export const lensCredits = () => tsv(join(ROOT, 'lens', 'CREDITS.tsv'));

export function licenseCounts(rows: Credit[]) {
  const m = new Map<string, number>();
  for (const r of rows) m.set(r.license, (m.get(r.license) ?? 0) + 1);
  return [...m].sort((a, b) => b[1] - a[1]);
}

export const authorCount = (rows: Credit[]) => new Set(rows.map((r) => r.author)).size;

// Checks every href and src in the built site. Internal links must resolve to a file in dist; with --external,
// every distinct external URL is fetched too (Commons and Reddit pages are skipped: thousands of them, rate limited).
// Usage: node scripts/link-check.mjs dist [--external]
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';

const root = process.argv[2] ?? 'dist';
const external = process.argv.includes('--external');
const files = [];
const walk = (d) => { for (const f of readdirSync(d)) { const p = join(d, f); statSync(p).isDirectory() ? walk(p) : p.endsWith('.html') && files.push(p); } };
walk(root);

const resolves = (url, from) => {
  const path = decodeURIComponent(url.split('#')[0].split('?')[0]);
  if (!path) return true;
  const abs = path.startsWith('/') ? join(root, path) : join(dirname(from), path);
  return existsSync(abs) && (statSync(abs).isFile() || existsSync(join(abs, 'index.html')));
};

const bad = [];
const ext = new Map();
for (const f of files) {
  const html = readFileSync(f, 'utf8');
  for (const [, url] of html.matchAll(/(?:href|src)="([^"]+)"/g)) {
    if (/^(mailto:|tel:|data:|javascript:|#)/.test(url)) continue;
    if (/^https?:\/\//.test(url)) { if (!ext.has(url)) ext.set(url, f); continue; }
    if (url.startsWith('//')) continue;
    if (/^\/(videos|reels)\//.test(url)) continue; // uploaded to the server outside the build (ops/deploy-site.sh keeps them)
    if (!resolves(url, f)) bad.push(`${f.slice(root.length)} -> ${url}`);
  }
}
console.log(`${files.length} pages, ${bad.length} broken internal links, ${ext.size} distinct external URLs`);
for (const b of bad) console.log('BROKEN', b);

if (external) {
  const skip = /commons\.wikimedia\.org|reddit\.com|poly\.pizza\/m\//;
  const todo = [...ext.keys()].filter((u) => !skip.test(u));
  let failed = 0;
  await Promise.all(todo.map(async (u) => {
    try {
      const r = await fetch(u, { method: 'GET', redirect: 'follow', signal: AbortSignal.timeout(15000), headers: { 'user-agent': 'Mozilla/5.0 shotmatch-link-check' } });
      if (r.status >= 400) { failed++; console.log('EXTERNAL', r.status, u, 'on', ext.get(u).slice(root.length)); }
    } catch (e) { failed++; console.log('EXTERNAL ERR', u, e.message); }
  }));
  console.log(`${todo.length} external URLs checked, ${failed} failed (${ext.size - todo.length} Commons/Reddit/Poly Pizza pages skipped)`);
}
if (bad.length) process.exit(1);

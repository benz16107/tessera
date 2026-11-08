import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { DB_NAME, MAX_UPLOAD, PORT, PUBLIC_URL, SPACETIME_HOST, WEB_DIST, secret } from './config.ts';
import { IMAGE_TYPES, ingest, localPath } from './images.ts';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.wasm': 'application/wasm', '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json',
  '.txt': 'text/plain; charset=utf-8', '.tsv': 'text/tab-separated-values; charset=utf-8', '.xml': 'application/xml',
};

const json = (res: ServerResponse, code: number, body: unknown) => {
  res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
};

function sendFile(res: ServerResponse, path: string, cache: string) {
  res.writeHead(200, { 'content-type': TYPES[extname(path).toLowerCase()] ?? 'application/octet-stream', 'content-length': statSync(path).size, 'cache-control': cache });
  createReadStream(path).pipe(res);
}

async function readBody(req: IncomingMessage, max: number): Promise<Buffer | null> {
  const chunks: Buffer[] = [];
  let n = 0;
  for await (const c of req) {
    n += c.length;
    if (n > max) return null;
    chunks.push(c);
  }
  return Buffer.concat(chunks);
}

const NOT_BUILT = '<!doctype html><meta charset="utf-8"><title>ShotMatch</title><p style="font:16px system-ui;margin:3rem">The web app is not built yet. Run <code>npm run build</code> in <code>web/</code>.</p>';

async function handle(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url ?? '/', 'http://x');
  const p = decodeURIComponent(url.pathname);

  if (p === '/api/config' && req.method === 'GET')
    return json(res, 200, { spacetimeHost: SPACETIME_HOST, dbName: DB_NAME, mapsKey: secret('maps_key') ?? '', publicUrl: PUBLIC_URL });

  if (p === '/api/upload') {
    if (req.method !== 'POST') return json(res, 405, { error: 'POST an image' });
    const type = (req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
    if (!IMAGE_TYPES.includes(type)) return json(res, 415, { error: `content type must be one of ${IMAGE_TYPES.join(', ')}` });
    if (Number(req.headers['content-length'] ?? 0) > MAX_UPLOAD) return json(res, 413, { error: 'photo is larger than 25 MB' });
    const body = await readBody(req, MAX_UPLOAD);
    if (!body) return json(res, 413, { error: 'photo is larger than 25 MB' });
    if (!body.length) return json(res, 400, { error: 'empty body' });
    try { return json(res, 200, await ingest(body)); }
    catch (e) { return json(res, 400, { error: `could not read that image: ${(e as Error).message}` }); }
  }

  if (p.startsWith('/api/')) return json(res, 404, { error: 'no such endpoint' });

  if (p.startsWith('/photo/') || p.startsWith('/preview/')) {
    const f = localPath(p);
    if (!f || !existsSync(f)) return json(res, 404, { error: 'not found' });
    return sendFile(res, f, 'public, max-age=31536000, immutable');
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') return json(res, 405, { error: 'method not allowed' });
  const index = join(WEB_DIST, 'index.html');
  if (!existsSync(index)) { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); return res.end(NOT_BUILT); }
  const f = normalize(join(WEB_DIST, p));
  if (f.startsWith(WEB_DIST + '/') && existsSync(f) && statSync(f).isFile())
    return sendFile(res, f, p.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache');
  if (extname(p) && !p.endsWith('.html')) return json(res, 404, { error: 'not found' }); // a missing asset is not a route
  return sendFile(res, index, 'no-cache');
}

export function startHttp() {
  createServer((req, res) => {
    handle(req, res).catch(e => {
      console.error('http error:', e);
      if (!res.headersSent) json(res, 500, { error: 'internal error' }); else res.end();
    });
  }).listen(PORT, '127.0.0.1', () => console.log(`crew http on 127.0.0.1:${PORT}`));
}

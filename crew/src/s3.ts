// Vultr Object Storage through its S3 API. Four calls, so SigV4 is signed here instead of pulling in the AWS SDK.
// Keys are the public URL path without the leading slash: /photo/x.jpg is photo/x.jpg in the bucket.
import { createHash, createHmac } from 'node:crypto';
import { secret } from './config.ts';

type S3 = { endpoint: string; region: string; bucket: string; accessKey: string; secretKey: string };

/** ~/.config/shotmatch/vultr_s3 as key=value lines; null when it is missing, so the crew keeps working from disk alone. */
export function s3Config(): S3 | null {
  const kv: Record<string, string> = {};
  for (const line of (secret('vultr_s3') ?? '').split('\n')) {
    const i = line.indexOf('=');
    if (i > 0) kv[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  if (!kv.endpoint || !kv.bucket || !kv.access_key || !kv.secret_key) return null;
  return { endpoint: kv.endpoint.replace(/\/$/, ''), region: kv.region || 'us-east-1', bucket: kv.bucket, accessKey: kv.access_key, secretKey: kv.secret_key };
}

const sha256 = (d: string | Buffer) => createHash('sha256').update(d).digest('hex');
const hmac = (k: string | Buffer, d: string) => createHmac('sha256', k).update(d).digest();

/** AWS SigV4 headers for one request (host, x-amz-date, x-amz-content-sha256, authorization). `query` must already be canonical. */
export function sign(o: { method: string; host: string; path: string; query?: string; payloadHash: string; amzDate: string; region: string; accessKey: string; secretKey: string; headers?: Record<string, string> }): Record<string, string> {
  const h: Record<string, string> = { host: o.host, 'x-amz-content-sha256': o.payloadHash, 'x-amz-date': o.amzDate };
  for (const [k, v] of Object.entries(o.headers ?? {})) h[k.toLowerCase()] = v;
  const names = Object.keys(h).sort();
  const canonical = [o.method, o.path, o.query ?? '', ...names.map(n => `${n}:${h[n].trim()}`), '', names.join(';'), o.payloadHash].join('\n');
  const day = o.amzDate.slice(0, 8), scope = `${day}/${o.region}/s3/aws4_request`;
  const key = hmac(hmac(hmac(hmac(`AWS4${o.secretKey}`, day), o.region), 's3'), 'aws4_request');
  const signature = createHmac('sha256', key).update(['AWS4-HMAC-SHA256', o.amzDate, scope, sha256(canonical)].join('\n')).digest('hex');
  return { ...h, authorization: `AWS4-HMAC-SHA256 Credential=${o.accessKey}/${scope}, SignedHeaders=${names.join(';')}, Signature=${signature}` };
}

async function call(method: string, key: string, body?: Buffer, type?: string): Promise<Response | null> {
  const c = s3Config();
  if (!c) return null;
  const url = new URL(`${c.endpoint}/${c.bucket}/${key.split('/').map(encodeURIComponent).join('/')}`);
  const { host, ...headers } = sign({
    method, host: url.host, path: url.pathname, payloadHash: sha256(body ?? ''), amzDate: new Date().toISOString().replace(/[-:]|\.\d{3}/g, ''),
    region: c.region, accessKey: c.accessKey, secretKey: c.secretKey, headers: type ? { 'content-type': type } : {},
  });
  return fetch(url, { method, headers, body, signal: AbortSignal.timeout(30_000) });
}

const fail = async (what: string, r: Response) => { throw new Error(`bucket ${what}: HTTP ${r.status} ${(await r.text()).slice(0, 200)}`); };

/** false when no bucket is configured. */
export async function putObject(key: string, body: Buffer, type: string): Promise<boolean> {
  const r = await call('PUT', key, body, type);
  if (r && !r.ok) await fail(`put ${key}`, r);
  return !!r;
}

/** The object's bytes, or null when it does not exist or no bucket is configured. */
export async function getObject(key: string): Promise<Buffer | null> {
  const r = await call('GET', key);
  if (!r || r.status === 404) return null;
  if (!r.ok) await fail(`get ${key}`, r);
  return Buffer.from(await r.arrayBuffer());
}

export async function deleteObject(key: string): Promise<void> {
  const r = await call('DELETE', key);
  if (r && !r.ok && r.status !== 404) await fail(`delete ${key}`, r);
}

/** Creates the bucket itself (key ''); used once by scripts/bucket-sync.ts. */
export const createBucket = () => call('PUT', '');

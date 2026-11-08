import { createHmac, timingSafeEqual } from 'node:crypto';

export const safeEq = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/** ElevenLabs-Signature: t=<unix>,v0=<hex HMAC-SHA256 of "t.body">. Rejects anything older than 30 minutes. */
export function verifySignature(header: string | undefined, body: string, key: string, now = Date.now()): boolean {
  const m = /t=(\d+),v0=([0-9a-f]+)/.exec(header ?? '');
  if (!m || Math.abs(now / 1000 - Number(m[1])) > 1800) return false;
  return safeEq(createHmac('sha256', key).update(`${m[1]}.${body}`).digest('hex'), m[2]);
}


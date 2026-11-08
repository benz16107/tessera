// Self-check: the module's SHA-256/HMAC against node:crypto, plus the ElevenLabs signature format.
import { createHash, createHmac } from 'node:crypto';
import assert from 'node:assert/strict';
import { sha256, hmacSha256Hex, verifyElevenLabs } from '../src/sha256.ts';

const hex = (b: Uint8Array) => Buffer.from(b).toString('hex');
for (const n of [0, 1, 55, 56, 63, 64, 65, 1000, 70_000]) {
  const m = new Uint8Array(n).map((_, i) => (i * 31 + 7) & 255);
  assert.equal(hex(sha256(m)), createHash('sha256').update(m).digest('hex'), `sha256 len ${n}`);
  for (const key of ['k', 'x'.repeat(64), 'y'.repeat(100)])
    assert.equal(hmacSha256Hex(key, m), createHmac('sha256', key).update(m).digest('hex'), `hmac len ${n} key ${key.length}`);
}
const body = new TextEncoder().encode('{"type":"post_call_transcription"}');
const t = 1794108000;
const sig = createHmac('sha256', 'whsec').update(`${t}.`).update(body).digest('hex');
assert.ok(verifyElevenLabs(`t=${t},v0=${sig}`, body, 'whsec', t + 5));
assert.ok(!verifyElevenLabs(`t=${t},v0=${sig}`, body, 'other', t + 5));
assert.ok(!verifyElevenLabs(`t=${t},v0=${sig}`, body, 'whsec', t + 4000));
assert.ok(!verifyElevenLabs(null, body, 'whsec', t));
console.log('sha256/hmac/elevenlabs signature: ok');

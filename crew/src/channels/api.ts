// Photon 2.0 beta HTTP client (https://photon.codes/docs/beta/, spec https://api.photon.codes/openapi.json).
// PHOTON_API_URL points it at the fake server in tests; credentials come from ~/.config/shotmatch at call time, so the
// crew switches to the real API the moment photon_api_key and photon_project_id exist.
import { randomUUID } from 'node:crypto';
import { secret } from '../config.ts';

export const PHOTON_API = () => (process.env.PHOTON_API_URL ?? 'https://api.photon.codes').replace(/\/$/, '');

// PHOTON_API_KEY and PHOTON_PROJECT_ID override the files only together with PHOTON_API_URL (the test server).
export const creds = () => {
  const test = !!process.env.PHOTON_API_URL;
  const key = (test && process.env.PHOTON_API_KEY) || secret('photon_api_key'), project = (test && process.env.PHOTON_PROJECT_ID) || secret('photon_project_id');
  return key && project ? { key, project } : null;
};
export const photonEnabled = () => creds() !== null;

/** Photon problem+json errors keep their code (SHARED_LINE_INBOUND_REQUIRED, SPACE_NOT_SENDABLE, ...). */
export class PhotonError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}

// A send that one of these refuses will not work on that channel right now; the caller tries the person's next channel.
export const REFUSALS = new Set([
  'SHARED_LINE_INBOUND_REQUIRED', 'SHARED_LINE_NOT_ASSIGNED', 'SHARED_LINE_GROUP_UNSUPPORTED', 'SPACE_NOT_SENDABLE',
  'SENDER_NOT_SENDABLE', 'SMS_CAMPAIGN_NOT_ELIGIBLE', 'SPACE_REQUIRES_OWNED_AGENT', 'SENDER_NOT_FOUND', 'OPERATION_UNAVAILABLE',
]);
export const isRefusal = (e: unknown) => e instanceof PhotonError && (REFUSALS.has(e.code) || e.status === 403);

type Body = object | { raw: Buffer; type: string };

/** One API call under /v1/projects/{project}. idem: a stable Idempotency-Key, true for a random one, false for none. */
export async function api(method: string, path: string, body?: Body, idem: string | boolean = true): Promise<any> {
  const c = creds();
  if (!c) throw new Error('Photon credentials not set');
  const raw = !!body && 'raw' in body;
  const key = idem === true ? randomUUID() : idem || '';
  const headers: Record<string, string> = { authorization: `Bearer ${c.key}`, ...(key && { 'idempotency-key': key.slice(0, 255) }) };
  if (body) headers['content-type'] = raw ? (body as any).type : 'application/json';
  for (let attempt = 0; ; attempt++) {
    const r = await fetch(`${PHOTON_API()}/v1/projects/${c.project}${path}`, {
      method, headers, body: body ? (raw ? (body as any).raw : JSON.stringify(body)) : undefined, signal: AbortSignal.timeout(60_000),
    });
    const text = r.ok ? '' : await r.clone().text();
    // 409 ATTACHMENT_NOT_READY and 429/5xx come with Retry-After; the same idempotency key makes the retry safe.
    if ((r.status === 429 || r.status >= 500 || (r.status === 409 && /NOT_READY/.test(text))) && attempt < 4) {
      const wait = Number(r.headers.get('retry-after')) || 2 ** attempt;
      await new Promise(res => setTimeout(res, Math.min(wait, 10) * 1000));
      continue;
    }
    if (!r.ok) {
      let code = '';
      try { code = String(JSON.parse(text).code ?? ''); } catch { /* not problem+json */ }
      throw new PhotonError(r.status, code, `Photon ${method} ${path}: HTTP ${r.status} ${code || text.slice(0, 200)}`);
    }
    const ct = r.headers.get('content-type') ?? '';
    return ct.includes('json') ? r.json() : Buffer.from(await r.arrayBuffer());
  }
}

/** multipart/related body for POST /attachments: a JSON part with the size, then the raw bytes. */
export function attachmentBody(bytes: Buffer, contentType: string, filename: string) {
  const boundary = `shotmatch${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
  const meta = JSON.stringify({ contentType, sizeBytes: bytes.length, filename });
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Type: application/json\r\n\r\n${meta}\r\n--${boundary}\r\nContent-Type: ${contentType}\r\n\r\n`),
    bytes, Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  return { body, contentType: `multipart/related; boundary=${boundary}` };
}

export async function uploadAttachment(bytes: Buffer, contentType: string, filename: string): Promise<string> {
  const { body, contentType: ct } = attachmentBody(bytes, contentType, filename);
  return String((await api('POST', '/attachments', { raw: body, type: ct })).id);
}

export type SendReq = {
  spaceId: string; senderId: string; content: object; parentMessageId?: string;
  email?: { subject?: string }; telegram?: { richMessage?: boolean; sendAs?: string };
};
/** POST /messages; returns the new message id. */
export async function sendMessage(req: SendReq, idem?: string): Promise<string> {
  const body: Record<string, unknown> = { spaceId: req.spaceId, senderId: req.senderId, content: req.content };
  if (req.parentMessageId) body.parentMessageId = req.parentMessageId;
  if (req.email) body.email = req.email;
  if (req.telegram) body.telegram = req.telegram;
  return String((await api('POST', '/messages', body, idem ?? true))?.id ?? '');
}

/** Create or get a User by handle (POST /users). Agent handles come back as kind agent. */
export async function userId(platform: string, handle: string): Promise<string> {
  return String((await api('POST', '/users', { platform, handle }, false)).id);
}

/** Create or get a direct Space for these users (POST /spaces). The key binds the participants, so a retry converges. */
export async function spaceId(platform: string, participantIds: string[]): Promise<string> {
  const key = `space:${platform}:${[...participantIds].sort().join(',')}`;
  return String((await api('POST', '/spaces', { platform, participantIds }, key)).id);
}

export const typing = (space: string, senderId: string, on = true) => api('POST', `/spaces/${space}/typing`, { senderId, typing: on }).catch(() => {});

/** Telegram edit-in-place: a message.update linked to the original by parentMessageId (Photon changelog, Telegram edits). */
export const editText = (space: string, senderId: string, messageId: string, text: string) =>
  sendMessage({ spaceId: space, senderId, parentMessageId: messageId, content: { type: 'message.update', content: { type: 'text', format: 'plain', text } } });

export const download = async (attachmentId: string) => ({
  type: String((await api('GET', `/attachments/${attachmentId}`, undefined, false)).contentType ?? ''),
  bytes: () => api('GET', `/attachments/${attachmentId}/content`, undefined, false) as Promise<Buffer>,
});

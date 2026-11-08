// Photon 2.0 beta bridge: iMessage and Telegram in over Socket.IO (with a saved replay cursor), replies out over HTTP.
// Docs: https://photon.codes/docs/beta/ (websocket, messages, attachments). One Photon space = one ShotMatch session.
import { io, type Socket } from 'socket.io-client';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { conn, until } from './stdb.ts';
import { PUBLIC_URL, secret } from './config.ts';
import { ingest } from './images.ts';
import { handleInbound } from './agent.ts';
import { sharedStore, type ThreadInfo } from './store.ts';
import { attachmentBody, parseInbound, type Inbound } from './photon-event.ts';
import { replyText } from './words.ts';

const API = 'https://api.photon.codes';
const creds = () => {
  const key = secret('photon_api_key'), project = secret('photon_project_id');
  return key && project ? { key, project } : null;
};
export const photonEnabled = () => creds() !== null;

async function api(method: string, path: string, body?: object | { raw: Buffer; type: string }, idem = true): Promise<any> {
  const c = creds();
  if (!c) throw new Error('Photon credentials not set');
  const raw = body && 'raw' in body;
  const headers: Record<string, string> = { authorization: `Bearer ${c.key}`, ...(idem && { 'idempotency-key': randomUUID() }) };
  if (body) headers['content-type'] = raw ? (body as any).type : 'application/json';
  for (let attempt = 0; ; attempt++) {
    const r = await fetch(`${API}/v1/projects/${c.project}${path}`, {
      method, headers, body: body ? (raw ? (body as any).raw : JSON.stringify(body)) : undefined, signal: AbortSignal.timeout(60_000),
    });
    // 409 ATTACHMENT_NOT_READY and 429 come with Retry-After; the same idempotency key makes the retry safe.
    if ((r.status === 429 || r.status === 409 || r.status >= 500) && attempt < 4) {
      const wait = Number(r.headers.get('retry-after')) || 2 ** attempt;
      if (r.status !== 409 || /NOT_READY/.test(await r.clone().text())) { await new Promise(res => setTimeout(res, wait * 1000)); continue; }
    }
    if (!r.ok) throw new Error(`Photon ${method} ${path}: HTTP ${r.status} ${(await r.text()).slice(0, 300)}`);
    const ct = r.headers.get('content-type') ?? '';
    return ct.includes('json') ? r.json() : Buffer.from(await r.arrayBuffer());
  }
}

const sendText = (t: ThreadInfo, text: string, parentMessageId?: string) =>
  api('POST', '/messages', { spaceId: t.chatId, senderId: t.senderId, content: { type: 'text', format: 'plain', text }, ...(parentMessageId && { parentMessageId }) });

async function sendImage(t: ThreadInfo, path: string, parentMessageId?: string) {
  const { body, contentType } = attachmentBody(readFileSync(path), 'image/jpeg', basename(path));
  const att = await api('POST', '/attachments', { raw: body, type: contentType });
  const caption = t.channel === 'telegram' ? { caption: { format: 'plain', text: 'AI interpretation' } } : {};
  return api('POST', '/messages', { spaceId: t.chatId, senderId: t.senderId, content: { type: 'attachment', attachmentId: att.id, metadata: caption }, ...(parentMessageId && { parentMessageId }) });
}

/** Mirrors an outbound text into the session's message table. */
const mirrorOut = (t: ThreadInfo, text: string, imageUrl = '', externalId = '', parent = '') =>
  conn.reducers.postMessage({ sessionId: BigInt(t.sessionId), channel: t.channel, threadId: t.chatId, externalId, parentExternalId: parent, direction: 'out', author: 'ShotMatch', text: text.slice(0, 4000), imageUrl })
    .catch(e => console.warn(`mirror out: ${e.message}`));

/** Text (and optionally an image) into a known thread, mirrored as an out message. Used by the voice post-call hook. */
export async function sendToThread(t: ThreadInfo, text: string, imagePath?: string) {
  if (!photonEnabled() || !t.senderId) throw new Error('Photon is off or the thread has no agent sender yet');
  const sent = await sendText(t, text);
  if (imagePath) await sendImage(t, imagePath);
  await mirrorOut(t, text, imagePath ? `/preview/${basename(imagePath)}` : '', sent?.id ?? '');
}

/** The session for a Photon space, created by the crew on the first message. */
async function sessionFor(m: Inbound): Promise<{ t: ThreadInfo; isNew: boolean }> {
  const store = sharedStore();
  const old = store.thread(m.platform, m.spaceId);
  if (old) {
    const t = { ...old, senderId: m.agentUserId || old.senderId, handle: m.spaceKind === 'direct' ? m.handle : old.handle };
    if (t.senderId !== old.senderId || t.handle !== old.handle) store.setThread(t);
    return { t, isNew: false };
  }
  const title = `photon:${m.platform}:${m.spaceId}`.slice(0, 120);
  const mine = conn.identity!.toHexString();
  const find = () => [...conn.db.session.iter()].find(s => s.title === title && s.owner.toHexString() === mine);
  if (!find()) await conn.reducers.createSession({ spotId: '', title, name: 'ShotMatch' });
  const s = await until(find, 15_000, 'the new session');
  const t: ThreadInfo = { sessionId: String(s.id), channel: m.platform, chatId: m.spaceId, handle: m.spaceKind === 'direct' ? m.handle : '', senderId: m.agentUserId };
  store.setThread(t);
  return { t, isNew: true };
}

async function handle(m: Inbound) {
  const { t, isNew } = await sessionFor(m);
  const sessionId = BigInt(t.sessionId);

  // HEIC is fine: ingest converts it. Only the first image of a message is used.
  let upload;
  for (const id of m.attachmentIds) {
    const meta = await api('GET', `/attachments/${id}`, undefined, false);
    if (!String(meta.contentType ?? '').startsWith('image/')) continue;
    upload = await ingest(await api('GET', `/attachments/${id}/content`, undefined, false));
    break;
  }
  await conn.reducers.postMessage({
    sessionId, channel: t.channel, threadId: t.chatId, externalId: m.messageId, parentExternalId: m.parentId, direction: 'in',
    author: m.handle.slice(0, 80), text: m.text.slice(0, 4000), imageUrl: upload?.url ?? '',
  }).catch(e => console.warn(`mirror in: ${e.message}`));

  // Telegram: one progress message, edited in place while the solve runs.
  let progressMsg: string | undefined, lastShown = '';
  const progress = upload && t.channel === 'telegram' ? setInterval(async () => {
    const photo = [...conn.db.photo.sessionId.filter(sessionId)].find(p => p.url === upload!.url);
    const job = photo && [...conn.db.solveJob.photoId.filter(photo.id)].sort((a, b) => Number(b.id - a.id))[0];
    const line = job ? `Locating your shot: ${job.progress}` : 'Locating your shot…';
    if (line === lastShown || !progressMsg) return;
    lastShown = line;
    await api('POST', '/messages', { spaceId: t.chatId, senderId: t.senderId, parentMessageId: progressMsg, content: { type: 'message.update', content: { type: 'text', format: 'plain', text: line } } })
      .catch(e => console.warn(`telegram edit: ${e.message}`));
  }, 3000) : undefined;
  if (progress) progressMsg = (await sendText(t, 'Locating your shot…', m.messageId).catch(() => null))?.id;

  try {
    const reply = await handleInbound({ sessionId, channel: t.channel, threadId: t.chatId, text: m.text, upload });
    const code = conn.db.session.id.find(sessionId)?.code;
    const text = replyText(reply.text, { hasPreview: !!reply.imagePath, links: isNew && code ? { plan: `${PUBLIC_URL}/p/${code}`, scout: `${PUBLIC_URL}/s/${code}` } : undefined });
    const sent = await sendText(t, text, m.messageId);
    if (reply.imagePath) await sendImage(t, reply.imagePath, m.messageId);
    await mirrorOut(t, text, reply.imagePath ? `/preview/${basename(reply.imagePath)}` : '', sent?.id ?? '', m.messageId);
  } finally { if (progress) clearInterval(progress); }
}

/** In groups, answer photos, replies to us and messages that name ShotMatch; in direct chats, everything. */
export const shouldAnswer = (m: Inbound) =>
  m.spaceKind === 'direct' || m.attachmentIds.length > 0 || !!m.parentId || /shot\s?match/i.test(m.text);

export function startPhoton() {
  const c = creds();
  if (!c) {
    console.log('Photon off: put photon_api_key (pho_sk_...) and photon_project_id (pho_prj_...) in ~/.config/shotmatch and restart. See crew/PHOTON.md.');
    return;
  }
  const store = sharedStore();
  const seen: string[] = [];
  let chain = Promise.resolve();
  const socket: Socket = io(API, {
    path: `/v1/projects/${c.project}/events/ws`, addTrailingSlash: false, transports: ['websocket'],
    extraHeaders: { Authorization: `Bearer ${c.key}` }, autoConnect: false,
  });
  socket.on('connect', async () => {
    const startSeq = Number(store.cursor ?? 0);
    try {
      const ack = await socket.timeout(10_000).emitWithAck('subscribe', { startSeq });
      console.log(ack?.ok ? `Photon subscribed from seq ${startSeq} (connection ${ack.connectionId})` : `Photon subscribe refused: ${JSON.stringify(ack?.error)}`);
    } catch (e) { console.warn(`Photon subscribe: ${(e as Error).message}; reconnecting in 5 s`); socket.disconnect(); setTimeout(() => socket.connect(), 5000); }
  });
  socket.on('connect_error', e => console.warn(`Photon connect error: ${e.message}`));
  socket.on('delivery_error', e => console.warn(`Photon delivery error: ${e.code} ${e.message}${e.fatal ? ' (fatal)' : ''}`));
  socket.on('delivery', (ev: any, meta: { seq: number; replyExpected: boolean }) => {
    if (meta.replyExpected) socket.emit('reply', { eventId: ev.id, status: 200 });
    // Serial, and the cursor only moves after the handler finishes, so a crash replays the message.
    chain = chain.then(async () => {
      if (seen.includes(ev.id)) { store.cursor = String(meta.seq); return; }
      const m = parseInbound(ev);
      if (m) {
        console.log(`Photon ${m.platform} message in ${m.spaceId}: ${m.text.slice(0, 60)}${m.attachmentIds.length ? ' [+image]' : ''}`);
        try { if (shouldAnswer(m)) await handle(m); }
        catch (e) {
          console.error('Photon handler failed:', e);
          const t = sharedStore().thread(m.platform, m.spaceId);
          if (t) await sendText(t, 'Something went wrong on my side. Try sending that again.', m.messageId).catch(() => {});
        }
      }
      seen.push(ev.id); if (seen.length > 500) seen.shift();
      store.cursor = String(meta.seq);
    });
  });
  socket.connect();
}

/** Delivers reminder rows the module's schedule wrote to the outbox into the session's text thread. */
export function startOutbox() {
  const busy = new Set<bigint>();
  const deliver = async () => {
    for (const o of [...conn.db.outbox.iter()].filter(o => o.state === 'pending' && !busy.has(o.id))) {
      busy.add(o.id);
      const t = sharedStore().bySession(String(o.sessionId));
      let state: 'sent' | 'failed' = 'failed';
      if (!photonEnabled()) console.log(`reminder ${o.id}: Photon is off, marking failed`);
      else if (!t?.senderId) console.log(`reminder ${o.id}: session ${o.sessionId} has no text thread, marking failed`);
      else {
        try { await sendToThread(t, o.text); state = 'sent'; console.log(`reminder ${o.id} sent to ${t.channel} ${t.chatId}`); }
        catch (e) { console.warn(`reminder ${o.id}: ${(e as Error).message}`); }
      }
      await conn.reducers.markOutbox({ id: o.id, state }).catch(e => console.warn(`markOutbox: ${e.message}`));
      busy.delete(o.id);
    }
  };
  conn.db.outbox.onInsert(() => void deliver());
  setInterval(() => void deliver(), 30_000);
  void deliver();
}

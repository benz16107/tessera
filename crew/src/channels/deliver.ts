// Turns a person's channel link into a Photon space and runs the per-channel sends from format.ts. Outbound-first spaces
// (POST /users, POST /spaces) cover SMS, WhatsApp Business and email; iMessage shared lines and Telegram bots can't speak
// first, so those need the person's own first message (a thread in the store) and are refused here otherwise.
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import sharp from 'sharp';
import { conn } from '../stdb.ts';
import { secret } from '../config.ts';
import { sharedStore, normHandle } from '../store.ts';
import { PhotonError, editText, sendMessage, spaceId, uploadAttachment, userId, type SendReq } from './api.ts';
import { platformOf, type Channel, type Op } from './format.ts';

export type Link = { id?: bigint; sessionId: bigint; channel: Channel; address: string; name: string; participantId?: bigint };
export type Target = Link & { platform: string; spaceId: string; senderId: string };

/** Photon's agent user on a platform: learned from inbound messages (receivedBy.id), else resolved from photon_agents. */
export async function agentFor(platform: string): Promise<string | null> {
  const store = sharedStore(), known = store.get<string>('agents', platform);
  if (known) return known;
  let handles: Record<string, string> = {};
  try { handles = JSON.parse(secret('photon_agents') ?? '{}'); } catch { console.warn('photon_agents is not JSON; ignoring it'); }
  const h = handles[platform] ?? handles[platform === 'whatsapp_business' ? 'whatsapp' : platform];
  if (!h) return null;
  const id = await userId(platform, h);
  store.put('agents', platform, id);
  return id;
}

/** The agent handle people text or call (from photon_agents), for invite instructions. */
export function agentHandle(channel: string): string | null {
  try { return JSON.parse(secret('photon_agents') ?? '{}')[channel] ?? null; } catch { return null; }
}

const sameAddress = (a: string, b: string) => normHandle(a) === normHandle(b) || a === b;

/** Where to send to this person: their own thread if they ever wrote to us, else a new outbound space where Photon allows it. */
export async function targetFor(l: Link): Promise<Target> {
  const platform = platformOf(l.channel), store = sharedStore();
  const t = store.threads().find(x => x.channel === l.channel && (x.chatId === l.address || (!!x.handle && sameAddress(x.handle, l.address))));
  if (t?.senderId) return { ...l, platform, spaceId: t.chatId, senderId: t.senderId };
  const cached = store.get<{ spaceId: string; senderId: string }>('spaces', `${platform}:${normHandle(l.address)}`);
  if (cached) return { ...l, platform, ...cached };
  if (l.channel === 'imessage') throw new PhotonError(403, 'SHARED_LINE_INBOUND_REQUIRED', `${l.name} has not texted the Tessera iMessage line yet`);
  if (l.channel === 'telegram') throw new PhotonError(403, 'TELEGRAM_START_REQUIRED', `${l.name} has not opened the Tessera bot yet`);
  if (l.channel === 'voice') throw new PhotonError(422, 'NOT_A_MESSAGING_CHANNEL', 'voice links take calls, not messages');
  const agent = await agentFor(platform);
  if (!agent) throw new PhotonError(409, 'SENDER_NOT_FOUND', `no Tessera ${l.channel} sender yet: add it to photon_agents (crew/PHOTON.md)`);
  const user = await userId(platform, l.address);
  const space = await spaceId(platform, [agent, user]);
  store.put('spaces', `${platform}:${normHandle(l.address)}`, { spaceId: space, senderId: agent });
  return { ...l, platform, spaceId: space, senderId: agent };
}

const attachments = new Map<string, string>(); // local file -> Photon attachment id, so a fan-out uploads each image once
async function attach(path: string, maxBytes = 9_500_000): Promise<string> {
  const hit = attachments.get(path);
  if (hit) return hit;
  let bytes = readFileSync(path);
  if (bytes.length > maxBytes) bytes = await sharp(bytes).resize({ width: 2048, height: 2048, fit: 'inside' }).jpeg({ quality: 85 }).toBuffer();
  const type = /\.png$/i.test(path) ? 'image/png' : 'image/jpeg';
  const id = await uploadAttachment(bytes, type, basename(path));
  attachments.set(path, id);
  return id;
}

const imageUrlOf = (path: string) => (/\/data\/(previews|photos)\//.test(path) ? `/${/\/data\/(previews|photos)\//.exec(path)![1] === 'previews' ? 'preview' : 'photo'}/${basename(path)}` : '');

export type Sent = { ids: string[]; texts: string[]; imageUrl: string };

/** Runs the ops for one person. idem makes every send safe to retry after a crash (same key, same message). */
export async function run(t: Target, ops: Op[], opts: { parentMessageId?: string; idem?: string; mirror?: boolean } = {}): Promise<Sent> {
  const out: Sent = { ids: [], texts: [], imageUrl: '' };
  const base: Omit<SendReq, 'content'> = { spaceId: t.spaceId, senderId: t.senderId, ...(opts.parentMessageId && { parentMessageId: opts.parentMessageId }) };
  const key = (i: number) => (opts.idem ? `${opts.idem}:${t.spaceId}:${i}` : undefined);
  const push = (id: string, text: string, img = '') => { if (id) out.ids.push(id); if (text) out.texts.push(text); if (img) out.imageUrl = img; };

  if (t.platform === 'email') {
    // One email: the Markdown body with every image attached. Markdown that Photon refuses goes again as plain text.
    const text = ops.find(o => o.op === 'text') as Extract<Op, { op: 'text' }> | undefined;
    const imgs = ops.flatMap(o => (o.op === 'image' ? [o.path] : o.op === 'album' ? o.paths : []));
    const parts = async (format: string) => [
      ...(text ? [{ type: 'text', format, text: format === 'plain' ? text.text.replace(/[#*|[\]]/g, '').replace(/\(https?:[^)]+\)/g, m => ` ${m.slice(1, -1)}`) : text.text }] : []),
      ...(await Promise.all(imgs.map(async p => ({ type: 'attachment', attachmentId: await attach(p) })))),
    ];
    const req = async (format: string) => {
      const ps = await parts(format);
      return sendMessage({ ...base, email: { subject: text?.subject ?? 'Tessera' }, content: ps.length === 1 ? ps[0] : { type: 'group', parts: ps } }, key(format === 'plain' ? 1 : 0));
    };
    let id: string;
    try { id = await req(text?.format ?? 'plain'); }
    catch (e) { if (e instanceof PhotonError && e.status === 422 && text?.format === 'markdown') id = await req('plain'); else throw e; }
    push(id, text?.text ?? '', imgs[0] ? imageUrlOf(imgs[0]) : '');
  } else {
    for (const [i, o] of ops.entries()) {
      if (o.op === 'text') push(await sendMessage({ ...base, content: { type: 'text', format: 'plain', text: o.text } }, key(i)), o.text);
      else if (o.op === 'image') {
        const caption = o.caption && t.platform === 'telegram' ? { metadata: { caption: { format: 'plain', text: o.caption.slice(0, 1000) } } } : {};
        push(await sendMessage({ ...base, content: { type: 'attachment', attachmentId: await attach(o.path), ...caption } }, key(i)), o.caption ?? '', imageUrlOf(o.path));
      } else if (o.op === 'album') {
        const ids = await Promise.all(o.paths.map(p => attach(p)));
        const parts = ids.map((attachmentId, j) => ({ type: 'attachment', attachmentId, ...(j === 0 && { metadata: { caption: { format: 'plain', text: o.caption.slice(0, 1000) } } }) }));
        push(await sendMessage({ ...base, content: { type: 'group', parts } }, key(i)), o.caption, imageUrlOf(o.paths[0]));
      } else if (o.op === 'progress') {
        const store = sharedStore(), pk = `progress:${t.spaceId}:${o.key}`, prev = store.get<string>('sent', pk);
        if (prev) { await editText(t.spaceId, t.senderId, prev, o.text).catch(e => console.warn(`telegram edit: ${e.message}`)); continue; }
        const id = await sendMessage({ ...base, content: { type: 'text', format: 'plain', text: o.text } }, key(i));
        store.put('sent', pk, id);
        push(id, o.text);
      }
    }
  }
  if (opts.mirror !== false && out.ids.length)
    await conn.reducers.postMessage({
      sessionId: t.sessionId, channel: t.channel, threadId: t.spaceId, externalId: out.ids[0], parentExternalId: opts.parentMessageId ?? '',
      direction: 'out', author: 'Tessera', text: out.texts.join('\n').slice(0, 4000) || '(image)', imageUrl: out.imageUrl,
    }).catch(e => console.warn(`mirror out: ${e.message}`));
  return out;
}

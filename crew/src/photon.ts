// Photon 2.0 beta bridge, inbound side: every channel's messages arrive over one Socket.IO event stream (saved replay cursor)
// and land in the session they belong to. One router decides what a message is: a text command (versions, invite, join,
// call sheet, remind), a reply to a version (fork), a photo (an object becomes a prop; a place at a marked set is a check-in;
// otherwise the locate agent), or words for the set (the text-to-set command, then a numbered render back into the thread).
import { io, type Socket } from 'socket.io-client';
import { conn, logStep, until } from './stdb.ts';
import { PUBLIC_URL } from './config.ts';
import { ingest, type Ingested } from './images.ts';
import { transcribe } from './speech.ts';
import { handleInbound } from './agent.ts';
import { setCommand } from './setagent.ts';
import { setContext } from './set.ts';
import { sharedStore, normHandle, type ThreadInfo } from './store.ts';
import { parseCallEnded, parseInbound, type Inbound } from './photon-event.ts';
import { replyText } from './words.ts';
import { PHOTON_API, creds, download, editText, photonEnabled, sendMessage, typing } from './channels/api.ts';
import { channelOf, plan, sheetText, LABEL, type Channel } from './channels/format.ts';
import { run, type Target } from './channels/deliver.ts';
import { ensureLink, linkRows, markVerified } from './channels/people.ts';
import { parseCommand } from './channels/commands.ts';
import { invite } from './channels/invite.ts';
import { broadcast, hold, owned, planUrl, startFanout } from './channels/fanout.ts';
import { finishVersion, forkFrom, noteVersionMessages, recordVersion, renderForThread, versionForMessage, versionsText } from './channels/versions.ts';
import { checkIn, classifyPhoto, photoToProp, retry3d } from './channels/photos.ts';
import { ensureAlert, startAlerts } from './channels/alerts.ts';
import { sendFraming } from './voice.ts';
import { sendCallSheet } from './channels/sheet.ts';

export { photonEnabled };

const SESSION_CODE = /^[A-Z2-9]{6}$/;

/** The session for a Photon space: a known thread; a JOIN code; an invite to this address; else a new session. */
async function sessionFor(m: Inbound, channel: Channel): Promise<{ t: ThreadInfo; isNew: boolean }> {
  const store = sharedStore();
  const direct = m.spaceKind === 'direct';
  const old = store.thread(m.platform, m.spaceId);
  const cmd = parseCommand(m.text);
  // "JOIN AB3DKQ" (or Telegram's /start AB3DKQ from a t.me link) moves this thread into that set.
  let sessionId = cmd?.kind === 'join' && SESSION_CODE.test(cmd.code) ? [...conn.db.session.iter()].find(s => s.code === cmd.code)?.id : undefined;
  if (old && sessionId === undefined) {
    const t = { ...old, senderId: m.agentUserId || old.senderId, handle: direct ? m.handle : old.handle };
    if (t.senderId !== old.senderId || t.handle !== old.handle) store.setThread(t);
    return { t, isNew: false };
  }
  // Invited people: a link with this address that someone's invite made.
  sessionId ??= direct && m.handle ? [...conn.db.channelLink.iter()].filter(l => channelOf(l.channel) === channel && normHandle(l.address) === normHandle(m.handle)).sort((a, b) => Number(b.id - a.id))[0]?.sessionId : undefined;
  if (sessionId === undefined) {
    const title = `photon:${m.platform}:${m.spaceId}`.slice(0, 120);
    const mine = conn.identity!.toHexString();
    const find = () => [...conn.db.session.iter()].find(s => s.title === title && s.owner.toHexString() === mine);
    if (!find()) await conn.reducers.createSession({ spotId: '', title, name: 'ShotMatch' });
    sessionId = (await until(find, 15_000, 'the new session')).id;
    const t: ThreadInfo = { sessionId: String(sessionId), channel: m.platform, chatId: m.spaceId, handle: direct ? m.handle : '', senderId: m.agentUserId, kind: m.spaceKind };
    store.setThread(t);
    return { t, isNew: true };
  }
  const t: ThreadInfo = { sessionId: String(sessionId), channel: m.platform, chatId: m.spaceId, handle: direct ? m.handle : '', senderId: m.agentUserId, kind: m.spaceKind };
  store.setThread(t);
  return { t, isNew: false };
}

type Ctx = { m: Inbound; t: ThreadInfo; sessionId: bigint; channel: Channel; target: Target; name: string; participantId: bigint; upload?: Ingested; isNew: boolean };

/** A reply into the thread, threaded on the person's message, mirrored into the session. */
const reply = (c: Ctx, text: string) => run(c.target, [{ op: 'text', text, subject: 'Re: ShotMatch' }], { parentMessageId: c.m.messageId, idem: `reply:${c.m.messageId}` });

/** Words for the set, then (when the set changed and there is a photo to render over) a numbered render back into the thread. */
async function setTurn(c: Ctx, words: string, fork?: { id: bigint; label: string; sessionId: bigint }) {
  const branch = fork ? await forkFrom(fork, c.channel, c.m.messageId) : undefined;
  const r = await setCommand(c.sessionId, words, { channel: c.channel });
  const changed = !!fork || (r.intent === 'edit' && r.steps.some(s => !/error/i.test(s.result)));
  if (!changed) return void (await reply(c, r.reply));
  let settle!: (v: { versionId: bigint; label: string; skip?: string } | null) => void;
  const mine = new Promise<{ versionId: bigint; label: string; skip?: string } | null>(res => (settle = res));
  void typing(c.target.spaceId, c.target.senderId); // Photon shows it where the platform supports typing (Telegram private chats)
  const out = await renderForThread(c.sessionId, words, jobId => owned.set(jobId, mine)).catch(e => ({ error: `The render didn't finish: ${(e as Error).message.slice(0, 120)}` }));
  if ('error' in out) {
    settle(null);
    const v = branch ?? await recordVersion(c.sessionId, { externalMessageId: c.m.messageId, channel: c.channel, imageUrl: '' });
    return void (await reply(c, `${v.label}${fork ? ` (from ${fork.label})` : ''}: ${r.reply}\n${out.error}`));
  }
  const v = branch ?? await recordVersion(c.sessionId, { externalMessageId: c.m.messageId, channel: c.channel, imageUrl: out.imageUrl });
  if (branch) await finishVersion(branch.id, c.sessionId, out.imageUrl);
  settle({ versionId: v.id, label: v.label, skip: c.target.spaceId });
  const label = `${v.label}${fork ? ` (from ${fork.label})` : ''}`;
  const ops = plan({ kind: 'render', label, caption: r.reply, image: out.path, imageUrl: `${PUBLIC_URL}${out.imageUrl}`, planUrl: planUrl(c.sessionId), title: 'your set' }, c.channel)
    .filter(o => o.op !== 'progress');
  const sent = await run(c.target, ops, { parentMessageId: c.m.messageId, idem: `version:${v.id}` });
  noteVersionMessages(v.id, sent.ids);
}

async function route(c: Ctx) {
  const cmd = c.upload ? null : parseCommand(c.m.text);
  if (cmd?.kind === 'versions') return void (await reply(c, versionsText(c.sessionId)));
  if (cmd?.kind === 'join') {
    const s = conn.db.session.id.find(c.sessionId);
    return void (await reply(c, `You're in ${s?.title.startsWith('photon:') ? 'the set' : `"${s?.title}"`}. Live set: ${planUrl(c.sessionId)} · Scout page: ${PUBLIC_URL}/s/${s?.code}`));
  }
  if (cmd?.kind === 'invite') {
    const r = await invite(c.sessionId, cmd, c.name);
    return void (await reply(c, [r.note, r.shareText && !r.delivered ? `Forward this: ${r.shareText}` : ''].filter(Boolean).join('\n')));
  }
  if (cmd?.kind === 'callsheet') {
    const res = await sendCallSheet(c.sessionId, { skip: c.target.spaceId });
    if ('error' in res) return void (await reply(c, res.error));
    return void (await reply(c, `${sheetText(res.sheet)}\nDesigned sheet: ${res.url}\nSent to ${res.sent.filter(x => x.ok).map(x => `${x.name} (${LABEL[x.channel]})`).join(', ') || 'nobody else yet'}.`));
  }
  if (cmd?.kind === 'remind') {
    const a = await ensureAlert(c.sessionId, true).catch(() => null);
    return void (await reply(c, a ? `I'll message everyone in the set ${Math.round((a.start.getTime() - a.at.getTime()) / 60_000)} min before ${a.kind}, with how far each of you is from the mark.` : 'There is no golden hour I can catch in the next 20 hours for this mark, or the set has no mark yet.'));
  }
  if (cmd?.kind === 'retry3d') {
    const r = sharedStore().get<{ sessionId: string; path: string; label: string; objectId: string }>('sent', `retry3d:${c.target.spaceId}`);
    if (!r || r.sessionId !== String(c.sessionId)) return void (await reply(c, 'There is no flat cut-out from this chat to turn into 3D. Send a photo of an object first.'));
    await reply(c, 'Trying the 3D model again. It takes a minute or two.');
    return void (await run(c.target, [{ op: 'text', text: await retry3d(c.sessionId, r.path, r.label, r.objectId), subject: 'Your prop' }], { parentMessageId: c.m.messageId, idem: `retry3d:${c.m.messageId}` }));
  }
  if (cmd?.kind === 'stop') {
    for (const l of linkRows(c.sessionId).filter(l => channelOf(l.channel) === c.channel && normHandle(l.address) === normHandle(c.m.handle || c.m.spaceId)))
      await conn.reducers.removeChannelLink({ id: l.id }).catch(() => {});
    return void (await reply(c, "You're off this set. Text JOIN and the set code to come back."));
  }

  // A reply to one of our version messages forks the set from that version.
  const v = c.m.parentId ? versionForMessage(c.sessionId, c.m.parentId) : undefined;
  if (v && c.m.text.trim() && !c.upload) return setTurn(c, c.m.text, v);

  const ctx = setContext(c.sessionId);
  if (c.upload) {
    const kind = await classifyPhoto(c.upload.path, c.m.text);
    await logStep(c.sessionId, 'photo_kind', c.upload.url, `${kind.kind}${kind.label ? `: ${kind.label}` : ''}`, 0);
    if (kind.kind === 'object' && ctx) {
      await reply(c, `Turning ${kind.label || 'that'} into a 3D prop for the set. It takes a minute or two.`);
      const out = await photoToProp(c.sessionId, c.upload.path, kind.label);
      // A flat cut-out can be upgraded later: remember the photo and the object for "try 3D again" in this thread.
      if (out.flat && out.objectId) sharedStore().put('sent', `retry3d:${c.target.spaceId}`, { sessionId: String(c.sessionId), path: c.upload.path, label: kind.label, objectId: out.objectId });
      return void (await run(c.target, [{ op: 'text', text: out.text, subject: 'Your prop is in the set' }], { parentMessageId: c.m.messageId, idem: `prop:${c.m.messageId}` }));
    }
    if (kind.kind === 'place' && ctx && !c.isNew) {
      const out = await checkIn(c.sessionId, c.upload, { participantId: c.participantId, name: c.name });
      return void (await reply(c, out.text));
    }
    return locate(c);
  }
  if (ctx && c.m.text.trim()) return setTurn(c, c.m.text);
  return locate(c);
}

/** The original flow: a photo of a place to locate, and follow-ups about it, through the chat agent. */
async function locate(c: Ctx) {
  // Telegram: one progress message, edited in place while the solve runs.
  let progressMsg: string | undefined, lastShown = '';
  const progress = c.upload && c.channel === 'telegram' ? setInterval(async () => {
    const photo = [...conn.db.photo.sessionId.filter(c.sessionId)].find(p => p.url === c.upload!.url);
    const job = photo && [...conn.db.solveJob.photoId.filter(photo.id)].sort((a, b) => Number(b.id - a.id))[0];
    const line = job ? `Locating your shot: ${job.progress}` : 'Locating your shot…';
    if (line === lastShown || !progressMsg) return;
    lastShown = line;
    await editText(c.target.spaceId, c.target.senderId, progressMsg, line).catch(e => console.warn(`telegram edit: ${e.message}`));
  }, 3000) : undefined;
  if (progress) progressMsg = await sendMessage({ spaceId: c.target.spaceId, senderId: c.target.senderId, parentMessageId: c.m.messageId, content: { type: 'text', format: 'plain', text: 'Locating your shot…' } }).catch(() => undefined);
  try {
    const r = await handleInbound({ sessionId: c.sessionId, channel: c.channel, threadId: c.t.chatId, text: c.m.text, upload: c.upload });
    // A set started from a text has no spot until the solve picks one; record it so the studio, the geo layers and alerts see it.
    const sp = setContext(c.sessionId)?.spotId;
    if (sp && !conn.db.session.id.find(c.sessionId)?.spotId) await conn.reducers.setSessionSpot({ sessionId: c.sessionId, spotId: sp }).catch(e => console.warn(`setSessionSpot: ${e.message}`));
    const code = conn.db.session.id.find(c.sessionId)?.code;
    const text = replyText(r.text, { hasPreview: !!r.imagePath, links: c.isNew && code ? { plan: `${PUBLIC_URL}/p/${code}`, scout: `${PUBLIC_URL}/s/${code}` } : undefined });
    const sent = await run(c.target, [...(r.imagePath ? [{ op: 'image' as const, path: r.imagePath }] : []), { op: 'text', text, subject: 'Your shot, located' }], { parentMessageId: c.m.messageId, idem: `reply:${c.m.messageId}` });
    // A preview the agent made is a version too: the fan-out recorded it; point this thread's messages at it.
    if (r.imagePath) {
      const file = r.imagePath.split('/').pop();
      const ver = await until(() => [...conn.db.shotVersion.sessionId.filter(c.sessionId)].find(x => x.imageUrl.endsWith(`/${file}`)), 8000, 'the version').catch(() => undefined);
      if (ver) noteVersionMessages(ver.id, sent.ids);
    }
  } finally { if (progress) clearInterval(progress); }
}

async function handle(m: Inbound) {
  const channel = channelOf(m.platform);
  if (!channel) return;
  if (m.agentUserId) sharedStore().put('agents', m.platform, m.agentUserId);
  const { t, isNew } = await sessionFor(m, channel);
  const sessionId = BigInt(t.sessionId), direct = m.spaceKind === 'direct';
  // Everyone who writes in is on the set's fan-out list; a group chat is one link.
  const link = await ensureLink(sessionId, channel, direct && m.handle ? m.handle : m.spaceId, m.displayName || (direct ? `${LABEL[channel]} …${m.handle.slice(-4)}` : `${LABEL[channel]} group`));
  await markVerified(link);
  const name = link.name || m.displayName || 'Someone';

  // HEIC is fine: ingest converts it. Only the first image of a message is used. A voice note becomes message text
  // (Parakeet on NVIDIA Riva, with Nemotron Nano Omni and Whisper as fallbacks), so a spoken "make it 85mm" works like a typed one.
  let upload: Ingested | undefined, heard = '';
  for (const id of m.attachmentIds) {
    const a = await download(id);
    if (a.type.startsWith('image/') && !upload) upload = await ingest(await a.bytes());
    else if (a.type.startsWith('audio/') && !heard)
      heard = (await transcribe(await a.bytes()).catch(e => { console.warn(`transcribe: ${e.message}`); return null; }))?.text ?? '';
  }
  if (heard) m.text = [m.text, heard].filter(Boolean).join('\n');
  await conn.reducers.postMessage({
    sessionId, channel, threadId: t.chatId, externalId: m.messageId, parentExternalId: m.parentId, direction: 'in',
    author: name.slice(0, 80), text: m.text.slice(0, 4000), imageUrl: upload?.url ?? '',
  }).catch(e => console.warn(`mirror in: ${e.message}`));

  const target: Target = { id: link.id, sessionId, channel, address: link.address, name, participantId: link.participantId, platform: m.platform, spaceId: m.spaceId, senderId: m.agentUserId || t.senderId || '' };
  const release = hold(sessionId, m.spaceId);
  try { await route({ m, t, sessionId, channel, target, name, participantId: link.participantId, upload, isNew }); }
  finally { release(); }
}

/** In groups, answer photos, replies to us and messages that name ShotMatch; in direct chats, everything. */
export const shouldAnswer = (m: Inbound) =>
  m.spaceKind === 'direct' || m.attachmentIds.length > 0 || !!m.parentId || /shot\s?match/i.test(m.text) || !!parseCommand(m.text);

export function startPhoton() {
  const c = creds();
  if (!c) {
    console.log('Photon off: put photon_api_key (pho_sk_...) and photon_project_id (pho_prj_...) in ~/.config/shotmatch and restart. See crew/PHOTON.md.');
    return;
  }
  const store = sharedStore();
  const seen: string[] = [];
  let chain = Promise.resolve();
  const socket: Socket = io(PHOTON_API(), {
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
  // Events are read in order, then each thread runs in its own queue: a slow render or a TRELLIS prop in one thread never
  // holds up anyone else's messages. The cursor moves once a message is queued (a crash mid-reply loses that one reply).
  const queues = new Map<string, Promise<void>>();
  const enqueue = (key: string, fn: () => Promise<void>) => {
    const next = (queues.get(key) ?? Promise.resolve()).then(fn).finally(() => { if (queues.get(key) === next) queues.delete(key); });
    queues.set(key, next);
  };
  socket.on('delivery', (ev: any, meta: { seq: number; replyExpected: boolean }) => {
    if (meta.replyExpected) socket.emit('reply', { eventId: ev.id, status: 200 });
    chain = chain.then(async () => {
      if (seen.includes(ev.id)) { store.cursor = String(meta.seq); return; }
      const m = parseInbound(ev), call = parseCallEnded(ev);
      if (m && shouldAnswer(m)) {
        console.log(`Photon ${m.platform} message in ${m.spaceId}: ${m.text.slice(0, 60)}${m.attachmentIds.length ? ' [+attachment]' : ''}`);
        enqueue(m.spaceId, async () => {
          try { await handle(m); }
          catch (e) {
            console.error('Photon handler failed:', e);
            const t = sharedStore().thread(m.platform, m.spaceId);
            if (t?.senderId) await sendMessage({ spaceId: t.chatId, senderId: t.senderId, parentMessageId: m.messageId, content: { type: 'text', format: 'plain', text: 'Something went wrong on my side. Try sending that again.' } }).catch(() => {});
          }
        });
      } else if (call) {
        enqueue(`call:${call.caller}`, async () => { console.log(`Photon call ended from …${call.caller.slice(-4)}: ${await sendFraming(call.caller, `call:${call.callId}`).catch(e => (e as Error).message)}`); });
      }
      seen.push(ev.id); if (seen.length > 500) seen.shift();
      store.cursor = String(meta.seq);
    });
  });
  socket.connect();
}

/** Outbound side: fan-out of set events, and golden-hour alerts from the module's reminder outbox. */
export function startOutbox() {
  startFanout();
  startAlerts();
}

export { broadcast };

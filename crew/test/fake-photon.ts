// A small stand-in for the Photon 2.0 beta API (https://api.photon.codes/openapi.json and asyncapi.yaml): the routes the crew
// uses, the Socket.IO event stream with replay cursors, recorded sends, and scripted inbound events. Not a full emulation:
// it checks the request fields the real API requires and answers with the same shapes.
import { createServer, type IncomingMessage, type Server as HttpServer } from 'node:http';
import { Server } from 'socket.io';

export type Sent = { id: string; spaceId: string; senderId: string; platform: string; parentMessageId?: string; content: any; email?: any; telegram?: any; idem: string };

let counter = 0;
const pid = (kind: string) => `pho_${kind}_0${String(++counter).padStart(25, '0')}`;

async function readAll(req: IncomingMessage) { const c: Buffer[] = []; for await (const x of req) c.push(x); return Buffer.concat(c); }

export async function fakePhoton(opts: { key?: string; project?: string; agents?: Record<string, string> } = {}) {
  const key = opts.key ?? 'pho_sk_test', project = opts.project ?? 'pho_prj_0000000000000000000000test';
  const sent: Sent[] = [], users = new Map<string, { id: string; platform: string; handle: string; kind: string }>();
  const spaces = new Map<string, { id: string; platform: string; participantIds: string[]; kind: string }>();
  const atts = new Map<string, { contentType: string; bytes: Buffer; filename: string }>(), idem = new Map<string, string>();
  const events: { seq: number; ev: any }[] = [];
  const agents = opts.agents ?? {};
  /** Spaces whose next sends are refused, with the problem code (a shared iMessage line refusing a late message). */
  const refuse = new Map<string, string>();
  const calls: { method: string; path: string }[] = [];

  const agentOn = (platform: string) => agents[platform] ?? agents[platform === 'whatsapp_business' ? 'whatsapp' : platform];
  const user = (platform: string, handle: string, kind = agentOn(platform) === handle ? 'agent' : 'human') => {
    const k = `${platform}:${handle}`;
    if (!users.has(k)) users.set(k, { id: pid('usr'), platform, handle, kind });
    return users.get(k)!;
  };
  const space = (platform: string, ids: string[], kind = 'direct') => {
    const k = `${platform}:${[...ids].sort().join(',')}`;
    if (!spaces.has(k)) spaces.set(k, { id: pid('spc'), platform, participantIds: ids, kind });
    return spaces.get(k)!;
  };
  const spaceById = (id: string) => [...spaces.values()].find(s => s.id === id);

  const http: HttpServer = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://x');
    const send = (code: number, body: unknown, ct = 'application/json') => { res.writeHead(code, { 'content-type': ct }); res.end(ct.includes('json') ? JSON.stringify(body) : body as Buffer); };
    const problem = (status: number, code: string, detail = code) => send(status, { type: `https://photon.codes/docs/problems/${code.toLowerCase()}`, title: code, status, code, detail }, 'application/problem+json');
    if (url.pathname.startsWith('/socket.io') || url.pathname.endsWith('/events/ws')) return; // Socket.IO owns these
    if (req.headers.authorization !== `Bearer ${key}`) return problem(401, 'NOT_AUTHENTICATED');
    const m = /^\/v1\/projects\/([^/]+)(\/.*)$/.exec(url.pathname);
    if (!m || m[1] !== project) return problem(404, 'NOT_FOUND');
    const path = m[2], body = await readAll(req);
    calls.push({ method: req.method!, path });
    const j = () => { try { return JSON.parse(body.toString('utf8')); } catch { return null; } };

    if (req.method === 'POST' && path === '/attachments') {
      const ct = String(req.headers['content-type'] ?? ''), b = /boundary=([^;]+)/.exec(ct)?.[1];
      if (!ct.startsWith('multipart/related') || !b) return problem(400, 'INVALID_REQUEST', 'multipart/related required');
      const s = body.toString('latin1'), parts = s.split(`--${b}`).slice(1, -1);
      const meta = JSON.parse(parts[0].split('\r\n\r\n')[1].trim()), raw = parts[1].slice(parts[1].indexOf('\r\n\r\n') + 4, -2);
      const bytes = Buffer.from(raw, 'latin1');
      if (bytes.length !== meta.sizeBytes) return problem(422, 'VALIDATION_FAILED', `size ${bytes.length} != ${meta.sizeBytes}`);
      const id = pid('att');
      atts.set(id, { contentType: meta.contentType, bytes, filename: meta.filename });
      return send(201, { id, contentType: meta.contentType, sizeBytes: bytes.length });
    }
    const att = /^\/attachments\/([^/]+)(\/content)?$/.exec(path);
    if (req.method === 'GET' && att) {
      const a = atts.get(att[1]);
      if (!a) return problem(404, 'ATTACHMENT_NOT_FOUND');
      return att[2] ? send(200, a.bytes, a.contentType) : send(200, { id: att[1], contentType: a.contentType, sizeBytes: a.bytes.length });
    }
    if (req.method === 'POST' && path === '/users') {
      const b = j();
      if (!b?.platform || !b?.handle) return problem(422, 'VALIDATION_FAILED');
      const u = user(b.platform, b.handle);
      return send(200, { ...u, projectId: project });
    }
    if (req.method === 'POST' && path === '/spaces') {
      const b = j();
      if (!req.headers['idempotency-key']) return problem(400, 'INVALID_REQUEST', 'idempotency-key required');
      if (!b?.platform || !Array.isArray(b.participantIds)) return problem(422, 'VALIDATION_FAILED');
      const ps = b.participantIds.map((id: string) => [...users.values()].find(u => u.id === id));
      if (!ps.some((u: any) => u?.kind === 'agent')) return problem(422, 'SPACE_REQUIRES_OWNED_AGENT');
      if (b.platform === 'imessage') return problem(403, 'SHARED_LINE_INBOUND_REQUIRED', 'a shared line cannot start a conversation');
      return send(201, { ...space(b.platform, b.participantIds), projectId: project });
    }
    const typing = /^\/spaces\/([^/]+)\/typing$/.exec(path);
    if (req.method === 'POST' && typing) return send(202, { id: pid('msg') });
    if (req.method === 'POST' && path === '/messages') {
      const b = j(), k = String(req.headers['idempotency-key'] ?? '');
      if (!k) return problem(400, 'INVALID_REQUEST', 'idempotency-key required');
      if (!/^[\x21-\x7e]{1,255}$/.test(k)) return problem(400, 'INVALID_REQUEST', 'idempotency-key must be printable ASCII without spaces');
      if (!b?.spaceId || !b?.senderId || !b?.content?.type) return problem(422, 'VALIDATION_FAILED', 'spaceId, senderId and content are required');
      if (idem.has(k)) { res.setHeader('idempotent-replayed', 'true'); return send(202, { id: idem.get(k), status: 'accepted' }); }
      const sp = spaceById(b.spaceId);
      if (!sp) return problem(404, 'SPACE_NOT_FOUND');
      if (refuse.has(b.spaceId)) return problem(403, refuse.get(b.spaceId)!, 'refused by the test');
      const c = b.content;
      const parts = c.type === 'group' ? c.parts : [c];
      if (parts.some((x: any) => x.type === 'text' && (!x.format || !x.text))) return problem(422, 'VALIDATION_FAILED', 'text needs format and text');
      if (parts.some((x: any) => x.type === 'text' && x.format === 'markdown' && /<[a-z][^>]*>/i.test(x.text))) return problem(422, 'INVALID_CONTENT', 'markdown_html_forbidden');
      if (parts.some((x: any) => x.type === 'attachment' && !atts.has(x.attachmentId))) return problem(404, 'ATTACHMENT_NOT_FOUND');
      if (c.type === 'group' && sp.platform === 'telegram' && parts.filter((x: any) => x.type === 'attachment').length > 10) return problem(422, 'UNSUPPORTED_CONTENT');
      const id = pid('msg');
      idem.set(k, id);
      sent.push({ id, spaceId: b.spaceId, senderId: b.senderId, platform: sp.platform, parentMessageId: b.parentMessageId, content: c, email: b.email, telegram: b.telegram, idem: k });
      return send(202, { id, status: 'accepted', platform: sp.platform, space: { id: sp.id, kind: sp.kind } });
    }
    return problem(404, 'NOT_FOUND', `${req.method} ${path}`);
  });

  const io = new Server(http, { path: `/v1/projects/${project}/events/ws`, addTrailingSlash: false, transports: ['websocket'] });
  io.use((s, next) => (s.handshake.headers.authorization === `Bearer ${key}` ? next() : next(new Error('NOT_AUTHENTICATED'))));
  io.on('connection', s => {
    s.on('subscribe', (p: { startSeq?: number }, ack: (a: unknown) => void) => {
      ack({ ok: true, connectionId: `conn_${s.id}` });
      for (const e of events.filter(e => e.seq > Number(p?.startSeq ?? 0))) s.emit('delivery', e.ev, { seq: e.seq, replyExpected: false });
      s.data.live = true;
    });
  });
  const emit = (ev: any) => {
    const seq = events.length + 1;
    events.push({ seq, ev });
    for (const s of io.sockets.sockets.values()) if (s.data.live) s.emit('delivery', ev, { seq, replyExpected: false });
    return seq;
  };

  /** A person writes to Tessera on a platform (optionally into a group, with an image, as a reply). */
  function inbound(a: { platform: string; handle: string; text?: string; image?: Buffer; imageType?: string; audio?: Buffer; parentMessageId?: string; group?: string; displayName?: string }) {
    const agentHandle = agentOn(a.platform) ?? `agent-${a.platform}`;
    const agent = user(a.platform, agentHandle, 'agent'), human = user(a.platform, a.handle, 'human');
    const sp = a.group ? (() => { const k = `group:${a.group}`; if (!spaces.has(k)) spaces.set(k, { id: pid('spc'), platform: a.platform, participantIds: [agent.id, human.id], kind: 'group' }); return spaces.get(k)!; })()
      : space(a.platform, [agent.id, human.id]);
    const parts: any[] = [];
    for (const [buf, type] of [[a.image, a.imageType ?? 'image/jpeg'], [a.audio, 'audio/ogg']] as const) {
      if (!buf) continue;
      const id = pid('att');
      atts.set(id, { contentType: type, bytes: buf, filename: 'in' });
      parts.push({ type: type.startsWith('audio') ? 'voice' : 'attachment', attachmentId: id });
    }
    if (a.text) parts.push({ type: 'text', format: 'plain', text: a.text });
    const msgId = pid('msg');
    emit({ id: pid('evt'), type: 'message.received', apiVersion: '2026-07-01', data: { object: {
      id: msgId, platform: a.platform, status: 'received', parentMessageId: a.parentMessageId ?? null, projectId: project,
      sentBy: { id: human.id, handle: a.handle, kind: 'human', metadata: a.displayName ? { displayName: a.displayName } : {} }, receivedBy: { id: agent.id, handle: agentHandle, kind: 'agent' },
      space: { id: sp.id, kind: sp.kind, platform: a.platform }, content: parts.length === 1 ? parts[0] : { type: 'group', parts },
    } } });
    return { messageId: msgId, spaceId: sp.id, agentId: agent.id, userId: human.id };
  }

  /** An inbound call to the voice line ends. */
  function callEnded(caller: string) {
    emit({ id: pid('evt'), type: 'call.ended', apiVersion: '2026-07-01', data: { object: { id: pid('cal'), platform: 'voice', direction: 'inbound', status: 'completed', caller: { handle: caller, platform: 'voice' }, callee: { handle: agents.voice ?? '+10000000000', platform: 'voice' } } } });
  }

  await new Promise<void>(r => http.listen(0, '127.0.0.1', r));
  const port = (http.address() as any).port;
  return {
    url: `http://127.0.0.1:${port}`, key, project, sent, calls, refuse, users, spaces, inbound, callEnded, emit,
    spaceOf: (platform: string, handle: string) => [...spaces.values()].find(s => s.platform === platform && s.participantIds.includes(user(platform, handle).id) && s.kind === 'direct'),
    sentTo: (spaceId: string) => sent.filter(x => x.spaceId === spaceId),
    close: () => new Promise<void>(r => { io.close(); http.close(() => r()); }),
  };
}

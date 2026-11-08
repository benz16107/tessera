// Photon routes on the crew's HTTP server (one line in http.ts mounts them). Every write names the session by its share code,
// the same capability the web app joins with, so a session id alone can't make the crew message anyone.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { conn } from '../stdb.ts';
import { PUBLIC_URL } from '../config.ts';
import { creds } from './api.ts';
import { agentHandle } from './deliver.ts';
import { CHANNELS, LABEL, type Channel } from './format.ts';
import { invite, claim } from './invite.ts';
import { linksFor } from './people.ts';
import { versionsOf } from './versions.ts';
import { savedSheet, sendCallSheet, sheetHtml } from './sheet.ts';

const json = (res: ServerResponse, code: number, body: unknown) => {
  res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body, (_k, v) => (typeof v === 'bigint' ? String(v) : v)));
};
async function body(req: IncomingMessage): Promise<any> {
  let s = '';
  for await (const c of req) { s += c; if (s.length > 20_000) return null; }
  try { return JSON.parse(s || '{}'); } catch { return null; }
}
const byCode = (code: unknown) => {
  const c = String(code ?? '').trim().toUpperCase();
  return /^[A-Z2-9]{6}$/.test(c) ? [...conn.db.session.iter()].find(s => s.code === c) : undefined;
};

export async function photonRoute(p: string, req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
  if (p === '/api/photon/status' && req.method === 'GET') {
    const c = creds();
    json(res, 200, {
      enabled: !!c, api: process.env.PHOTON_API_URL ? 'test server' : 'api.photon.codes',
      channels: CHANNELS.map(ch => ({ channel: ch, label: LABEL[ch], handle: agentHandle(ch) })),
      note: c ? 'Photon is on.' : 'Photon is waiting on credentials: links and invites are saved and go out once the keys are in.',
    });
    return true;
  }
  if (p === '/api/photon/invite' && req.method === 'POST') {
    const b = await body(req), s = byCode(b?.code);
    if (!s || !CHANNELS.includes(b.channel) || typeof b.address !== 'string') { json(res, 400, { error: 'give {code, name, channel, address}' }); return true; }
    try { json(res, 200, await invite(s.id, { name: String(b.name ?? ''), channel: b.channel as Channel, address: b.address }, String(b.by ?? 'Someone').slice(0, 40))); }
    catch (e) { json(res, 502, { error: (e as Error).message }); }
    return true;
  }
  if (p === '/api/photon/claim' && req.method === 'POST') {
    const b = await body(req);
    if (typeof b?.token !== 'string' || !/^\d{1,19}$/.test(String(b.participantId ?? ''))) { json(res, 400, { error: 'give {token, participantId}' }); return true; }
    try { json(res, 200, await claim(b.token, BigInt(b.participantId))); } catch (e) { json(res, 502, { error: (e as Error).message }); }
    return true;
  }
  if (p === '/api/photon/callsheet' && req.method === 'POST') {
    const b = await body(req), s = byCode(b?.code);
    if (!s) { json(res, 400, { error: 'give {code}' }); return true; }
    const r = await sendCallSheet(s.id);
    json(res, 'error' in r ? 502 : 200, 'error' in r ? r : { url: r.url, shots: r.sheet.shots.length, sent: r.sent });
    return true;
  }
  if (p === '/api/photon/people' && req.method === 'GET') {
    const s = byCode(url.searchParams.get('code'));
    if (!s) { json(res, 400, { error: 'give ?code=' }); return true; }
    json(res, 200, { people: linksFor(s.id).map(l => ({ name: l.name, channel: l.channel, participantId: String(l.participantId ?? 0) })), versions: versionsOf(s.id).length });
    return true;
  }
  const sheet = /^\/sheet\/([A-Za-z2-9]{6})$/.exec(p);
  if (sheet && req.method === 'GET') {
    const s = byCode(sheet[1]), saved = s && savedSheet(s.id);
    if (!saved) { res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }); res.end('No call sheet for this set yet. Text "call sheet" to ShotMatch or press Send call sheet in the studio.'); return true; }
    const last = [...conn.db.previewJob.sessionId.filter(s!.id)].filter(j => j.state === 'done' && j.imageUrl).sort((a, b) => Number(b.id - a.id))[0];
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache' });
    res.end(sheetHtml(saved, s!.code, last ? `${PUBLIC_URL}${last.imageUrl}` : undefined));
    return true;
  }
  return false;
}

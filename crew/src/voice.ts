// Mechanism 2: call the set. The ElevenLabs agent (Photon number over SIP) calls these tools mid-call: it guides the caller
// turn by turn from their live phone position (the scout page's device_pose), and edits the scene by voice through the same
// text-to-set command the studio uses, so planners see the change land live. After hang-up (the ElevenLabs post-call webhook,
// or Photon's own call.ended event) the final framing and the latest render go to the caller's thread.
import { safeEq, verifySignature } from './sig.ts';
import { conn } from './stdb.ts';
import { PUBLIC_URL, secret } from './config.ts';
import { sharedStore, normHandle, type ThreadInfo } from './store.ts';
import { compassWord, zoomWords } from './geo.ts';
import { setContext } from './set.ts';
import { enuOf } from './setgeo.ts';
import { setCommand } from './setagent.ts';
import { ensureLocal } from './images.ts';
import { linksByAddress, linksFor, personLinks } from './channels/people.ts';
import { guide } from './channels/marks.ts';
import { run, targetFor, type Link } from './channels/deliver.ts';
import { isRefusal, photonEnabled } from './channels/api.ts';
import { tryOrder } from './channels/order.ts';
import { plan } from './channels/format.ts';
import { channelOf } from './channels/format.ts';

/** True when the request carries ~/.config/shotmatch/voice_tool_secret in x-shotmatch-tool-secret. */
export function toolAuthorized(header: string | string[] | undefined): boolean {
  const s = secret('voice_tool_secret');
  return !!s && typeof header === 'string' && safeEq(header, s);
}

type Caller = { sessionId: bigint; thread?: ThreadInfo; link?: Link };

/** The caller's session: a channel link with their number (newest), else their latest Photon thread, else an explicit id. */
export function callerSession(a: { caller?: string; session_id?: string; session_code?: string }): Caller | null {
  if (a.caller) {
    const row = linksByAddress(a.caller)[0];
    if (row) {
      const link = linksFor(row.sessionId).find(l => l.id === row.id) ?? { id: row.id, sessionId: row.sessionId, channel: channelOf(row.channel) ?? 'sms', address: row.address, name: row.name, participantId: row.participantId };
      return { sessionId: row.sessionId, link, thread: sharedStore().byHandle(a.caller) };
    }
    const t = sharedStore().byHandle(a.caller);
    if (t) return { sessionId: BigInt(t.sessionId), thread: t };
    console.log(`voice: no link or thread for caller …${normHandle(a.caller).slice(-4)} (${conn.db.channelLink.count()} links known)`);
  }
  const code = String(a.session_code ?? '').trim().toUpperCase();
  const byCode = code ? [...conn.db.session.iter()].find(s => s.code === code) : undefined;
  if (byCode) return { sessionId: byCode.id };
  if (a.session_id && /^\d+$/.test(a.session_id) && conn.db.session.id.find(BigInt(a.session_id))) return { sessionId: BigInt(a.session_id) };
  return null;
}

const NO_SESSION = { say: "I don't have a set for this number yet. Text a photo to Tessera from this phone first, or tell me the six-letter set code." };

/** The caller's live position: their own scout page if their number is linked to a participant, else the newest scout in the set. */
function livePose(c: Caller) {
  const fresh = (d: { at: { microsSinceUnixEpoch: bigint } }) => Date.now() - Number(d.at.microsSinceUnixEpoch / 1000n) < 10 * 60_000;
  const own = c.link?.participantId ? conn.db.devicePose.participantId.find(c.link.participantId) : undefined;
  if (own && fresh(own)) return { d: own, whose: 'yours' };
  const d = [...conn.db.devicePose.sessionId.filter(c.sessionId)].filter(fresh).sort((a, b) => Number(b.at.microsSinceUnixEpoch - a.at.microsSinceUnixEpoch))[0];
  return d ? { d, whose: conn.db.participant.id.find(d.participantId)?.name ?? 'the scout' } : null;
}

function framing(sessionId: bigint): string | null {
  const ctx = setContext(sessionId);
  if (!ctx) return null;
  const c = ctx.cam, d = Math.round(Math.hypot(c.x, c.y));
  const where = d >= 5 ? `${d} metres ${compassWord((Math.atan2(c.x, c.y) * 180) / Math.PI)} of the centre of ${conn.db.spot.id.find(ctx.spotId)?.name ?? 'the spot'}` : `at the centre of ${conn.db.spot.id.find(ctx.spotId)?.name ?? 'the spot'}`;
  return `The mark is ${where}. Face ${compassWord(c.heading)}, ${Math.round(c.f35)} millimetre lens, about ${zoomWords(c.f35)} on an iPhone.`;
}

export const VOICE_TOOLS: Record<string, (a: any) => object | Promise<object>> = {
  get_plan(a) {
    const s = callerSession(a);
    if (!s) return NO_SESSION;
    const f = framing(s.sessionId);
    if (!f) return { say: 'This set has no shot camera yet. Give it a minute, or place one in the studio.' };
    const sc = conn.db.session.id.find(s.sessionId);
    return { say: f, set_code: sc?.code, people_on_channels: linksFor(s.sessionId).length };
  },
  // Turn by turn: one instruction from where the caller's phone is and which way it points.
  guide_me(a) {
    const s = callerSession(a);
    if (!s) return NO_SESSION;
    const ctx = setContext(s.sessionId);
    if (!ctx) return { say: 'The mark is not set yet.' };
    const p = livePose(s);
    if (!p) return { say: `I can't see your phone yet. Open the scout link I texted you, ${PUBLIC_URL}/s/${conn.db.session.id.find(s.sessionId)?.code ?? ''}, and allow location and motion.` };
    const at = enuOf(ctx.origin, p.d.lat, p.d.lon);
    const say = guide({ x: at.x, y: at.y, heading: p.d.heading ?? undefined }, { x: ctx.cam.x, y: ctx.cam.y, heading: ctx.cam.heading });
    return { say: p.whose === 'yours' ? say : `Going by ${p.whose}'s phone: ${say}`, gps_accuracy_m: Math.round(p.d.accuracyM) };
  },
  scout_status(a) { return VOICE_TOOLS.guide_me(a); },
  distance_to_mark(a) { return VOICE_TOOLS.guide_me(a); },
  // Scene edits by voice: "move the bike to the left", "make it sunset". Planners see the rows change live.
  async edit_set(a) {
    const s = callerSession(a);
    if (!s) return NO_SESSION;
    const words = String(a.instruction ?? '').slice(0, 500);
    if (!words.trim()) return { say: 'What should I change?' };
    const r = await Promise.race([setCommand(s.sessionId, words, { channel: 'voice' }), new Promise<null>(res => setTimeout(() => res(null), 22_000))]);
    if (!r) return { say: "That's still going. It will show up in the set in a moment." };
    return { say: r.reply.slice(0, 300), changed: r.steps.length, intent: r.intent };
  },
};

const latestRender = (sessionId: bigint) =>
  [...conn.db.previewJob.sessionId.filter(sessionId)].filter(j => j.state === 'done' && j.imageUrl).sort((a, b) => Number(b.id - a.id))[0];

/** After hang-up: the final framing and the latest render to the caller, on the first of their channels that takes it. */
export async function sendFraming(caller: string, idem: string): Promise<string> {
  const s = callerSession({ caller });
  if (!s) return 'no set for this caller';
  if (!photonEnabled()) return 'Photon is off';
  // Both ElevenLabs' webhook and Photon's call.ended report the same hang-up; the first one sends.
  const dk = `framing:${normHandle(caller)}`, last = Number(sharedStore().get('sent', dk) ?? 0);
  if (Date.now() - last < 10 * 60_000) return 'already sent for this call';
  sharedStore().put('sent', dk, Date.now());
  const f = framing(s.sessionId) ?? 'Thanks for calling Tessera.';
  const job = latestRender(s.sessionId), path = job ? await ensureLocal(job.imageUrl) : null;
  const version = job ? [...conn.db.shotVersion.sessionId.filter(s.sessionId)].find(v => v.imageUrl === job.imageUrl) : undefined;
  const text = `After your call, here is the framing. ${f}${version ? ` The latest render is ${version.label}; reply to it to change it.` : ''} Live set: ${PUBLIC_URL}/p/${conn.db.session.id.find(s.sessionId)?.code ?? ''}`;
  const mine = s.link ? personLinks(s.sessionId, s.link) : [];
  const fromThread = s.thread ? [{ sessionId: s.sessionId, channel: channelOf(s.thread.channel) ?? 'sms', address: s.thread.handle || s.thread.chatId, name: 'caller' } as Link] : [];
  const order = tryOrder([...mine, ...fromThread], l => sharedStore().threads().some(t => t.channel === l.channel && normHandle(t.handle) === normHandle(l.address)));
  for (const l of order) {
    try {
      const ops = path ? [...plan({ kind: 'render', label: version?.label ?? 'Latest', caption: f, image: path, imageUrl: `${PUBLIC_URL}${job!.imageUrl}`, planUrl: `${PUBLIC_URL}/p/${conn.db.session.id.find(s.sessionId)?.code ?? ''}`, title: 'your call' }, l.channel).filter(o => o.op === 'image'), { op: 'text' as const, text, subject: 'Your framing from the call' }] : [{ op: 'text' as const, text, subject: 'Your framing from the call' }];
      const sent = await run(await targetFor(l), ops, { idem });
      if (version) for (const id of sent.ids) sharedStore().put('msgVersion', id, String(version.id));
      return `sent on ${l.channel}`;
    } catch (e) { if (!isRefusal(e)) console.warn(`framing to ${l.channel}: ${(e as Error).message}`); }
  }
  return 'no channel took the framing';
}

/** ElevenLabs post-call webhook: HMAC-checked, then the framing goes to the caller. Returns an HTTP status. */
export async function voiceEnded(raw: string, sig: string | undefined): Promise<number> {
  const key = secret('elevenlabs_webhook_secret');
  if (!key) { console.warn('voice ended: no elevenlabs_webhook_secret, ignoring'); return 503; }
  if (!verifySignature(sig, raw, key)) return 401;
  const ev = JSON.parse(raw);
  if (ev.type !== 'post_call_transcription') return 200;
  const d = ev.data ?? {};
  const caller = d.conversation_initiation_client_data?.dynamic_variables?.system__caller_id ?? d.metadata?.phone_call?.external_number;
  if (!caller) { console.log('voice ended: no caller number'); return 200; }
  console.log(`voice ended: ${await sendFraming(caller, `call:${String(d.conversation_id ?? caller).slice(0, 80)}`)}`);
  return 200;
}

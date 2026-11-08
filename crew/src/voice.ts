// Tools the ElevenLabs phone agent calls during a call, and the post-call webhook that texts the framing afterwards.
import { safeEq, verifySignature } from './sig.ts';
import { conn } from './stdb.ts';
import { secret } from './config.ts';
import { sharedStore, type ThreadInfo } from './store.ts';
import { answerText, spokenPlan, walkWords } from './words.ts';
import { sendToThread } from './photon.ts';


/** True when the request carries ~/.config/shotmatch/voice_tool_secret in x-shotmatch-tool-secret. */
export function toolAuthorized(header: string | string[] | undefined): boolean {
  const s = secret('voice_tool_secret');
  return !!s && typeof header === 'string' && safeEq(header, s);
}

/** The caller's session: their latest Photon thread, else an explicit session id the agent was given. */
function sessionFor(a: { caller?: string; session_id?: string }): { sessionId: bigint; thread?: ThreadInfo } | null {
  const t = a.caller ? sharedStore().byHandle(a.caller) : undefined;
  if (t) return { sessionId: BigInt(t.sessionId), thread: t };
  if (a.session_id && /^\d+$/.test(a.session_id)) return { sessionId: BigInt(a.session_id) };
  return null;
}

function latestSolve(sessionId: bigint) {
  const photos = [...conn.db.photo.sessionId.filter(sessionId)].sort((x, y) => Number(y.id - x.id));
  for (const p of photos) {
    const r = conn.db.solveResult.photoId.find(p.id);
    if (r) return { r, spot: conn.db.spot.id.find(conn.db.solveJob.id.find(r.jobId)?.spotId ?? conn.db.session.id.find(sessionId)?.spotId ?? '') };
  }
  return null;
}

const NO_SESSION = { say: "I don't have a plan for this number yet. Text the photo to ShotMatch first, then call back." };

/** Latest scout position in the session, newest first. */
const latestScout = (sessionId: bigint) =>
  [...conn.db.devicePose.sessionId.filter(sessionId)].sort((a, b) => Number(b.at.microsSinceUnixEpoch - a.at.microsSinceUnixEpoch))[0];

export const VOICE_TOOLS: Record<string, (a: any) => object> = {
  get_plan(a) {
    const s = sessionFor(a);
    if (!s) return NO_SESSION;
    const ls = latestSolve(s.sessionId);
    if (!ls) return { say: 'Your photo is not solved yet. Give it a minute.' };
    const p = ls.r.pose;
    return { say: spokenPlan(ls.spot ?? undefined, ls.r), spot: ls.spot?.name, confidence: ls.r.confidence, heading_deg: Math.round(p.heading), f35_mm: Math.round(p.f35) };
  },
  scout_status(a) {
    const s = sessionFor(a);
    if (!s) return NO_SESSION;
    const cam = conn.db.camera.sessionId.find(s.sessionId);
    const scouts = [...conn.db.devicePose.sessionId.filter(s.sessionId)];
    if (!scouts.length) return { say: 'Nobody has opened the scout page yet. Open the link from the text on your phone.' };
    const d = latestScout(s.sessionId)!;
    const age = Math.round((Date.now() - Number(d.at.microsSinceUnixEpoch / 1000n)) / 1000);
    return { scouts: scouts.length, seen_seconds_ago: age, gps_accuracy_m: Math.round(d.accuracyM), say: cam ? walkWords(d.lat, d.lon, d.heading, cam.pose.lat, cam.pose.lon, cam.pose.heading) : 'The mark is not set yet.' };
  },
  distance_to_mark(a) {
    const s = sessionFor(a);
    if (!s) return NO_SESSION;
    const cam = conn.db.camera.sessionId.find(s.sessionId);
    if (!cam) return { say: 'The mark is not set yet.' };
    const lat = Number(a.lat), lon = Number(a.lon);
    const d = Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon, heading: undefined } : latestScout(s.sessionId);
    if (!d) return { say: 'I cannot see your position. Open the scout page from the text and allow location.' };
    return { say: walkWords(d.lat, d.lon, d.heading ?? undefined, cam.pose.lat, cam.pose.lon, cam.pose.heading) };
  },
};

/** Post-call webhook: text the final framing into the caller's thread. Returns an HTTP status. */
export async function voiceEnded(raw: string, sig: string | undefined): Promise<number> {
  const key = secret('elevenlabs_webhook_secret');
  if (!key) { console.warn('voice ended: no elevenlabs_webhook_secret, ignoring'); return 503; }
  if (!verifySignature(sig, raw, key)) return 401;
  const ev = JSON.parse(raw);
  if (ev.type !== 'post_call_transcription') return 200;
  const d = ev.data ?? {};
  const caller = d.conversation_initiation_client_data?.dynamic_variables?.system__caller_id ?? d.metadata?.phone_call?.external_number;
  const s = caller ? sessionFor({ caller }) : null;
  if (!s?.thread) { console.log(`voice ended: no thread for caller ${caller ? 'on file' : 'unknown'}`); return 200; }
  const ls = latestSolve(s.sessionId);
  const text = ls ? `After your call, here is the framing:\n${answerText(ls.spot ?? undefined, ls.r)}` : 'Thanks for calling ShotMatch. Send a photo of the shot you want and I will find the spot.';
  await sendToThread(s.thread, text).catch(e => console.warn(`voice ended: send failed: ${e.message}`));
  return 200;
}

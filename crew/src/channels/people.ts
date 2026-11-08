// Who is in a session on which channel: the module's channel_link rows (module/src/index.ts, "Photon: channel links").
// Everyone who texts in gets a link, so a session's links are its full fan-out list.
import { conn, until } from '../stdb.ts';
import { normHandle } from '../store.ts';
import { channelOf, type Channel } from './format.ts';
import type { Link } from './deliver.ts';

export const linkRows = (sessionId: bigint) => [...conn.db.channelLink.sessionId.filter(sessionId)].sort((a, b) => Number(a.id - b.id));

const nameOf = (r: { name: string; participantId: bigint }) =>
  r.name || (r.participantId ? conn.db.participant.id.find(r.participantId)?.name : '') || 'Someone';

/** Every messaging link in the session (voice links take calls only), once per channel and address. */
export function linksFor(sessionId: bigint): Link[] {
  const seen = new Set<string>(), out: Link[] = [];
  for (const r of linkRows(sessionId)) {
    const ch = channelOf(r.channel);
    if (!ch || ch === 'voice') continue;
    const k = `${ch}:${normHandle(r.address)}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ id: r.id, sessionId, channel: ch, address: r.address, name: nameOf(r), participantId: r.participantId });
  }
  return out;
}

/** All links that belong to one person (same participant, or same name when they are not in the web app yet). */
export function personLinks(sessionId: bigint, l: Link): Link[] {
  return linksFor(sessionId).filter(x => (l.participantId && x.participantId === l.participantId) || (!l.participantId && !x.participantId && x.name === l.name) || x.id === l.id);
}

/** Links anywhere for an address (a caller's number), newest first. */
export function linksByAddress(address: string) {
  const n = normHandle(address);
  return [...conn.db.channelLink.iter()].filter(r => normHandle(r.address) === n).sort((a, b) => Number(b.id - a.id));
}

/** Makes sure this person has a link in the session, marks it verified (they wrote to us), and returns it. */
export async function ensureLink(sessionId: bigint, channel: Channel, address: string, name: string, participantId = 0n) {
  const find = () => linkRows(sessionId).find(r => r.channel === channel && (r.address === address || normHandle(r.address) === normHandle(address)));
  let row = find();
  if (!row || (participantId && row.participantId !== participantId)) {
    await conn.reducers.addChannelLink({ sessionId, channel, address: row?.address ?? address, participantId, name: row?.name ? undefined : name.slice(0, 40) || undefined });
    row = await until(() => { const r = find(); return r && (!participantId || r.participantId === participantId) ? r : undefined; }, 10_000, 'the channel link');
  }
  return row;
}

export async function markVerified(row: { id: bigint; verified: boolean }) {
  if (!row.verified) await conn.reducers.markChannelVerified({ id: row.id, verified: true }).catch(e => console.warn(`markChannelVerified: ${e.message}`));
}

/** The crew's own participant in a session (joinSessionAsCrew), for writes that must name a participant. */
export async function crewParticipant(sessionId: bigint) {
  const me = conn.identity!.toHexString();
  const find = () => [...conn.db.participant.sessionId.filter(sessionId)].find(p => p.identity.toHexString() === me);
  if (!find()) await conn.reducers.joinSessionAsCrew({ sessionId, name: 'ShotMatch' });
  return until(find, 10_000, 'the crew participant');
}

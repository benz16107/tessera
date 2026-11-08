// "Add Maya +1 555 0100 on WhatsApp", from the studio or from a text. The invitee gets a channel_link (participantId 0 until
// they open their link) and, where Photon allows a first message, an invite on that channel. Where it doesn't (iMessage shared
// line, Telegram bots), the inviter gets the exact text to forward: a JOIN code or a t.me deep link.
import { randomBytes } from 'node:crypto';
import { conn, until } from '../stdb.ts';
import { PUBLIC_URL } from '../config.ts';
import { sharedStore } from '../store.ts';
import { isRefusal, photonEnabled } from './api.ts';
import { agentHandle, run, targetFor } from './deliver.ts';
import { LABEL, type Channel } from './format.ts';
import { ensureLink } from './people.ts';
import { cleanAddress } from './commands.ts';

export type InviteResult = { ok: boolean; linkId?: string; delivered: boolean; channel: Channel; note: string; shareText?: string; url?: string };

const perHour = new Map<string, number[]>();
const MAX_PER_HOUR = 12; // the invite endpoint sends real messages to numbers people type in; cap it per session

export async function invite(sessionId: bigint, who: { name: string; channel: Channel; address: string }, by = 'Someone'): Promise<InviteResult> {
  const channel = who.channel, address = cleanAddress(channel, who.address);
  if (!address) return { ok: false, delivered: false, channel, note: `That doesn't look like a ${LABEL[channel]} address.` };
  const s = conn.db.session.id.find(sessionId);
  if (!s) return { ok: false, delivered: false, channel, note: 'No such session.' };
  const now = Date.now(), recent = (perHour.get(String(sessionId)) ?? []).filter(t => now - t < 3600_000);
  if (recent.length >= MAX_PER_HOUR) return { ok: false, delivered: false, channel, note: 'Too many invites from this session in the last hour.' };
  perHour.set(String(sessionId), [...recent, now]);

  const name = who.name.trim().slice(0, 40) || 'A friend';
  const row = await ensureLink(sessionId, channel, address, name);
  const token = randomBytes(9).toString('base64url');
  sharedStore().put('invites', token, { sessionId: String(sessionId), channel, address, name, at: now });
  const url = `${PUBLIC_URL}/s/${s.code}?inv=${token}`;
  const spot = s.spotId ? conn.db.spot.id.find(s.spotId)?.name : undefined;
  const text = `${by} added you to a ShotMatch shoot${spot ? ` at ${spot}` : ''}. Open the live set on your phone (nothing to install): ${url}\nReply here any time: your messages land in the set, and you'll get the renders and the light alerts on this channel.`;
  const base = { ok: true, linkId: String(row.id), channel, url };

  if (channel === 'voice') return { ...base, delivered: false, note: `${name} can call ShotMatch${agentHandle('voice') ? ` at ${agentHandle('voice')}` : ''} from ${address}; the call joins this set.` };
  if (channel === 'imessage') {
    const line = agentHandle('imessage');
    const share = `Text "JOIN ${s.code}" to ${line ?? 'the ShotMatch iMessage number'} to join my ShotMatch shoot.`;
    return { ...base, delivered: false, shareText: share, note: `Photon's shared iMessage line can't text ${name} first. Send them this once: ${share} (Their number must be on the line's tester list, crew/PHOTON.md.)` };
  }
  if (channel === 'telegram' && !sharedStore().threads().some(t => t.channel === 'telegram' && t.handle.toLowerCase() === address.replace(/^@/, '').toLowerCase())) {
    const bot = agentHandle('telegram')?.replace(/^@/, '');
    const share = bot ? `https://t.me/${bot}?start=${s.code}` : `Message the ShotMatch Telegram bot: /start ${s.code}`;
    return { ...base, delivered: false, shareText: share, note: `Telegram bots can't message first. Send ${name} this link: ${share}` };
  }
  if (!photonEnabled()) return { ...base, delivered: false, note: `${name} is in the set as ${LABEL[channel]} ${address}. The invite goes out once Photon credentials are in (crew/PHOTON.md).`, shareText: text };
  try {
    await run(await targetFor({ id: row.id, sessionId, channel, address, name, participantId: 0n }), [{ op: 'text', text, subject: `${by} invited you to a ShotMatch shoot` }], { idem: `invite:${row.id}` });
    return { ...base, delivered: true, note: `Invited ${name} on ${LABEL[channel]}.` };
  } catch (e) {
    const why = (e as Error).message;
    return { ...base, delivered: false, shareText: text, note: isRefusal(e) ? `Photon won't let ShotMatch message ${name} first on ${LABEL[channel]} (${why.replace(/^Photon \S+ \S+: /, '')}). Send them the link yourself.` : `The invite failed: ${why.slice(0, 160)}` };
  }
}

/** The invitee opened their link and joined: their channel link moves from participantId 0 to their real participant. */
export async function claim(token: string, participantId: bigint): Promise<{ ok: boolean; note: string }> {
  const inv = sharedStore().get<{ sessionId: string; channel: Channel; address: string; name: string }>('invites', token);
  if (!inv) return { ok: false, note: 'unknown invite' };
  // The scout page calls this right after joining, so the crew's copy of the participant row may be a moment behind.
  const p = await until(() => conn.db.participant.id.find(participantId), 8000, 'the participant').catch(() => undefined);
  if (!p || String(p.sessionId) !== inv.sessionId) return { ok: false, note: 'that participant is not in the invited session' };
  await ensureLink(BigInt(inv.sessionId), inv.channel, inv.address, inv.name, participantId);
  return { ok: true, note: `${inv.name}'s ${LABEL[inv.channel]} is linked to the scout page` };
}

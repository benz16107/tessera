// Which of a person's channels to try, in order, for a message Tessera starts (an alert, the framing after a call). Pure.
import type { Channel } from './format.ts';

export type Person = { channel: Channel; address: string; name: string; participantId?: bigint };

/** Late-message order: channels Photon lets us use without a fresh inbound text come first. */
export const FALLBACK: Channel[] = ['telegram', 'sms', 'email', 'whatsapp', 'imessage'];

/** A person's channels in the order to try: their first link, then the fallbacks. iMessage only if they ever texted us. */
export function tryOrder<L extends Person>(links: L[], hasThread: (l: L) => boolean): L[] {
  const [first, ...rest] = links;
  const ordered = [first, ...[...rest].sort((a, b) => FALLBACK.indexOf(a.channel) - FALLBACK.indexOf(b.channel))].filter(Boolean);
  return ordered.filter(l => l.channel !== 'imessage' || hasThread(l));
}

/** Groups a session's links by person: the same participant, or the same name for people not in the web app yet. */
export function people<L extends Person>(links: L[]): L[][] {
  const by = new Map<string, L[]>();
  for (const l of links) { const k = l.participantId ? `p${l.participantId}` : `n${l.name.toLowerCase()}`; by.set(k, [...(by.get(k) ?? []), l]); }
  return [...by.values()];
}

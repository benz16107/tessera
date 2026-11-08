// Text commands a thread understands before anything reaches a model. Pure, so the tests pin every phrasing.
import type { Channel } from './format.ts';
import { normHandle } from '../store.ts';

export type Command =
  | { kind: 'invite'; name: string; channel: Channel; address: string }
  | { kind: 'versions' }
  | { kind: 'join'; code: string }
  | { kind: 'callsheet' }
  | { kind: 'remind' }
  | { kind: 'stop' };

const CH: [RegExp, Channel][] = [
  [/\b(i\s?message|imsg|blue bubble)\b/i, 'imessage'], [/\btele(gram)?\b|\btg\b/i, 'telegram'], [/\bwhats\s?app\b|\bwa\b/i, 'whatsapp'],
  [/\b(sms|text message|texts?)\b/i, 'sms'], [/\b(e-?mail|mail)\b/i, 'email'],
];
const PHONE = /(\+?\d[\d\s().-]{8,}\d)/, EMAIL = /([a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,})/i, AT = /(?:^|\s)@([a-z][a-z0-9_]{3,31})\b/i;

/** Validated address for a channel, or null. Phones become E.164; emails lowercase; Telegram takes @username or a numeric chat id. */
export function cleanAddress(channel: Channel, raw: string): string | null {
  const s = raw.trim();
  if (channel === 'email') return EMAIL.test(s) && EMAIL.exec(s)![1].length === s.length ? s.toLowerCase() : null;
  if (channel === 'telegram') {
    if (/^@?[a-z][a-z0-9_]{3,31}$/i.test(s)) return `@${s.replace(/^@/, '').toLowerCase()}`;
    return /^-?\d{5,15}$/.test(s) ? s : null;
  }
  if (channel === 'imessage' && EMAIL.test(s) && EMAIL.exec(s)![1].length === s.length) return s.toLowerCase(); // an Apple ID email
  const n = normHandle(s);
  return /^\+\d{8,15}$/.test(n) ? n : null;
}

export function parseCommand(text: string): Command | null {
  const t = text.trim();
  if (/^(versions?|history|tree)\??$/i.test(t) || /^(show|list)( me)? (the )?versions\??$/i.test(t)) return { kind: 'versions' };
  if (/^(stop|unsubscribe|leave)$/i.test(t)) return { kind: 'stop' };
  const join = /^(?:join|start)\s+([A-Z2-9]{6})$/i.exec(t) ?? /^\/start\s+([A-Z2-9]{6})$/i.exec(t);
  if (join) return { kind: 'join', code: join[1].toUpperCase() };
  if (/\bcall ?sheet\b/i.test(t) && t.length < 80) return { kind: 'callsheet' };
  if (/\bremind\b|\balert me\b|\btell me when\b/i.test(t) && /\b(golden|blue|light|sunset|sunrise|shot)\b/i.test(t)) return { kind: 'remind' };

  const inv = /^(?:please\s+)?(?:add|invite|bring in|loop in)\s+(.+)$/i.exec(t);
  if (!inv) return null;
  const rest = inv[1];
  const named = CH.find(([re]) => re.test(rest.replace(EMAIL, ' ')));
  const email = EMAIL.exec(rest)?.[1], phone = PHONE.exec(rest.replace(EMAIL, ' '))?.[1], at = AT.exec(rest)?.[1];
  const channel: Channel | undefined = named?.[1] ?? (email ? 'email' : at ? 'telegram' : phone ? 'sms' : undefined);
  const raw = channel === 'email' ? email : channel === 'telegram' ? (at ? `@${at}` : phone) : channel === 'imessage' ? (phone ?? email) : phone;
  if (!channel || !raw) return null;
  const address = cleanAddress(channel, raw);
  if (!address) return null;
  const name = rest.replace(EMAIL, ' ').replace(PHONE, ' ').replace(AT, ' ')
    .replace(/\b(on|via|by|over|at|with|to the shoot|to the set|to this|number|phone|email|e-mail)\b/gi, ' ')
    .replace(CH.reduce((re, [r]) => new RegExp(`${re.source}|${r.source}`, 'gi'), /$^/), ' ')
    .replace(/[^\p{L}\p{M}' -]/gu, ' ').replace(/\s+/g, ' ').trim().split(' ').slice(0, 3).join(' ');
  return { kind: 'invite', name: (name || 'A friend').slice(0, 40), channel, address };
}

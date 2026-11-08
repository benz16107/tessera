// Photon state the module doesn't hold, kept in data/photon.json so restarts resume where they stopped: the replay cursor,
// thread -> session, Photon's agent user per platform, outbound-first spaces, which sent message carries which shot version,
// invite tokens, and send dedupe keys.
import { readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { REPO } from './config.ts';

export type ThreadInfo = { sessionId: string; channel: string; chatId: string; handle: string; senderId?: string; lastExternalId?: string; kind?: string };
export type Invite = { sessionId: string; channel: string; address: string; name: string; at: number };
type NS = 'agents' | 'spaces' | 'msgVersion' | 'invites' | 'sent' | 'alerts' | 'images';
type State = { cursor?: string; threads: Record<string, ThreadInfo>; handles: Record<string, string> } & Partial<Record<NS, Record<string, any>>>;

/** Phone numbers compare by digits, with a leading 1 added to 10-digit North American numbers; emails and @handles compare lowercased. */
export function normHandle(h: string): string {
  const s = h.trim().toLowerCase().replace(/^(tel:|sms:|imessage:|mailto:)/, '');
  if (/^@[a-z][a-z0-9_]{3,}$/.test(s)) return s.slice(1); // a Telegram @username
  if (s.includes('@') || /^[a-z_][a-z0-9_]{3,}$/.test(s)) return s;
  const d = s.replace(/\D/g, '');
  return d.length === 10 ? `+1${d}` : d ? `+${d}` : s;
}

export const threadKey = (channel: string, chatId: string) => `${channel}:${chatId}`;

export class Store {
  private s: State;
  constructor(private path = join(REPO, 'data/photon.json')) {
    try { this.s = JSON.parse(readFileSync(path, 'utf8')); } catch { this.s = { threads: {}, handles: {} }; }
    this.s.threads ??= {}; this.s.handles ??= {};
  }
  private save() {
    mkdirSync(dirname(this.path), { recursive: true });
    writeFileSync(`${this.path}.tmp`, JSON.stringify(this.s, null, 1), { mode: 0o600 });
    renameSync(`${this.path}.tmp`, this.path); // atomic, so a crash never leaves half a file
  }
  get cursor() { return this.s.cursor; }
  set cursor(c: string | undefined) { if (c && c !== this.s.cursor) { this.s.cursor = c; this.save(); } }
  thread(channel: string, chatId: string): ThreadInfo | undefined { return this.s.threads[threadKey(channel, chatId)]; }
  setThread(t: ThreadInfo) {
    const key = threadKey(t.channel, t.chatId);
    this.s.threads[key] = t;
    if (t.handle) this.s.handles[normHandle(t.handle)] = key; // the caller's latest thread wins
    this.save();
  }
  threads(): ThreadInfo[] { return Object.values(this.s.threads); }
  /** The text thread for a session, if the session came from Photon. */
  bySession(sessionId: string): ThreadInfo | undefined { return Object.values(this.s.threads).find(t => t.sessionId === sessionId); }
  /** The latest thread for a phone number or email, so a voice call finds the caller's session. */
  byHandle(handle: string): ThreadInfo | undefined {
    const key = this.s.handles[normHandle(handle)];
    return key ? this.s.threads[key] : undefined;
  }
  get<T = any>(ns: NS, key: string): T | undefined { return this.s[ns]?.[key]; }
  put(ns: NS, key: string, value: unknown) { (this.s[ns] ??= {})[key] = value; this.save(); }
  all<T = any>(ns: NS): Record<string, T> { return (this.s[ns] ?? {}) as Record<string, T>; }
}

let shared: Store | undefined;
/** The process-wide store (tests build their own with a temp path). */
export const sharedStore = () => (shared ??= new Store(process.env.PHOTON_STORE ?? undefined));

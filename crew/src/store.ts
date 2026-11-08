// Thread -> session map and the Photon replay cursor, kept in data/photon.json so restarts resume where they stopped.
import { readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { REPO } from './config.ts';

export type ThreadInfo = { sessionId: string; channel: string; chatId: string; handle: string; senderId?: string; lastExternalId?: string };
type State = { cursor?: string; threads: Record<string, ThreadInfo>; handles: Record<string, string> };

/** Phone numbers compare by digits, with a leading 1 added to 10-digit North American numbers; emails compare lowercased. */
export function normHandle(h: string): string {
  const s = h.trim().toLowerCase().replace(/^(tel:|sms:|imessage:)/, '');
  if (s.includes('@')) return s;
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
  /** The latest thread for a phone number or email, so a voice call finds the caller's session. */
  byHandle(handle: string): ThreadInfo | undefined {
    const key = this.s.handles[normHandle(handle)];
    return key ? this.s.threads[key] : undefined;
  }
}

let shared: Store | undefined;
/** The process-wide store (tests build their own with a temp path). */
export const sharedStore = () => (shared ??= new Store());

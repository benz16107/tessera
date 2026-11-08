// Photon pieces read SpacetimeDB rows directly (channel_link, shot_version, checkin) and call the crew only for sends.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTable } from 'spacetimedb/react';
import { tables } from '../module_bindings/index.ts';
import type { ChannelLink, Checkin, ShotVersion } from '../module_bindings/types.ts';

export const CHANNELS = ['imessage', 'telegram', 'sms', 'whatsapp', 'email', 'voice'] as const;
export type Channel = (typeof CHANNELS)[number];
export const LABEL: Record<string, string> = { imessage: 'iMessage', telegram: 'Telegram', sms: 'SMS', whatsapp: 'WhatsApp', email: 'Email', voice: 'Phone' };
export const SHORT: Record<string, string> = { imessage: 'iMsg', telegram: 'TG', sms: 'SMS', whatsapp: 'WA', email: 'Mail', voice: 'Call' };

export type PersonOnChannels = { key: string; name: string; participantId: bigint; links: ChannelLink[] };

/** The session's channel links grouped by person (a participant, or a name for invitees not in the web app yet). */
export function usePeopleOnChannels(sessionId: bigint): PersonOnChannels[] {
  const [rows] = useTable(tables.channelLink.where(r => r.sessionId.eq(sessionId)));
  return useMemo(() => {
    const by = new Map<string, PersonOnChannels>();
    for (const l of [...rows].sort((a, b) => Number(a.id - b.id))) {
      const key = l.participantId ? `p${l.participantId}` : `n${l.name.toLowerCase()}`;
      const p = by.get(key) ?? { key, name: l.name || 'Someone', participantId: l.participantId, links: [] };
      p.links.push(l);
      by.set(key, p);
    }
    return [...by.values()];
  }, [rows]);
}

export function useVersions(sessionId: bigint): ShotVersion[] {
  const [rows] = useTable(tables.shotVersion.where(r => r.sessionId.eq(sessionId)));
  return useMemo(() => [...rows].sort((a, b) => Number(a.id - b.id)), [rows]);
}

/** The newest check-in per person from the last 30 minutes: the markers the set draws. */
export function useCheckins(sessionId: bigint): Checkin[] {
  const [rows] = useTable(tables.checkin.where(r => r.sessionId.eq(sessionId)));
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(t); }, []);
  return useMemo(() => {
    const latest = new Map<string, Checkin>();
    for (const c of rows) {
      if (now - c.createdAt.toDate().getTime() > 30 * 60_000) continue;
      const k = c.participantId ? `p${c.participantId}` : `n${c.name}`;
      const old = latest.get(k);
      if (!old || c.id > old.id) latest.set(k, c);
    }
    return [...latest.values()];
  }, [rows, now]);
}

/** Crew status: whether Photon credentials are in, and the handles people text or call. */
export function usePhotonStatus() {
  const [s, setS] = useState<{ enabled: boolean; note: string; channels: { channel: string; label: string; handle: string | null }[] } | null>(null);
  useEffect(() => { fetch('/api/photon/status').then(r => r.json()).then(setS).catch(() => setS(null)); }, []);
  return s;
}

/**
 * The scout page opened from an invite (?inv=<token>): once this person has joined, the crew moves their channel link
 * to their participant, so their texts, calls and light alerts know where their phone is. Runs once per token.
 */
export function useClaimInvite(participantId: bigint | undefined) {
  const done = useRef(false);
  useEffect(() => {
    const token = new URLSearchParams(location.search).get('inv');
    if (!token || !participantId || done.current) return;
    done.current = true;
    fetch('/api/photon/claim', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token, participantId: String(participantId) }) })
      .catch(() => { done.current = false; });
  }, [participantId]);
}

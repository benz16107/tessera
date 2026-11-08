// What each channel gets for each event in the live set. Pure: no connection, no network, so tests cover every channel.
// iMessage: the render plus one line. Telegram: an album of lens options and one progress message edited in place.
// Email: the full call sheet as Markdown (Photon builds the HTML part) with a link to the designed sheet. SMS: text and a link.

export type Channel = 'imessage' | 'telegram' | 'sms' | 'whatsapp' | 'email' | 'voice';
export const CHANNELS: Channel[] = ['imessage', 'telegram', 'sms', 'whatsapp', 'email', 'voice'];
export const LABEL: Record<Channel, string> = { imessage: 'iMessage', telegram: 'Telegram', sms: 'SMS', whatsapp: 'WhatsApp', email: 'Email', voice: 'Phone' };

/** Our channel names to Photon platforms and back (WhatsApp here means WhatsApp Business; personal WhatsApp is not out yet). */
export const platformOf = (c: string) => (c === 'whatsapp' ? 'whatsapp_business' : c);
export const channelOf = (platform: string): Channel | null =>
  platform === 'whatsapp_business' || platform === 'whatsapp' ? 'whatsapp' : (CHANNELS as string[]).includes(platform) ? (platform as Channel) : null;

export type Shot = { n: number; name: string; time: string; lens_mm: number; aperture?: number; shutter?: string; framing?: string; people?: string; light?: string; notes?: string };
export type Sheet = { title?: string; date?: string; call_time?: string; wrap_time?: string; location?: string; shots: Shot[]; crew_notes?: string[]; windows?: Record<string, string> };

export type SetEvent =
  | { kind: 'render'; label: string; caption: string; image: string; imageUrl: string; lenses?: { f35: number; path: string }[]; planUrl: string; title: string }
  | { kind: 'note'; text: string; planUrl?: string }
  | { kind: 'callsheet'; sheet: Sheet; sheetUrl: string; planUrl: string }
  | { kind: 'progress'; key: string; text: string };

export type Op =
  | { op: 'text'; text: string; format?: 'plain' | 'markdown'; subject?: string }
  | { op: 'image'; path: string; caption?: string }
  | { op: 'album'; paths: string[]; caption: string }
  | { op: 'progress'; key: string; text: string }; // Telegram edits one message in place; other channels skip it

const oneLine = (s: string, n = 160) => { const t = s.replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };

export function sheetMarkdown(s: Sheet, sheetUrl: string, planUrl: string): string {
  const head = [`# ${s.title ?? 'Call sheet'}`, '', [s.date, s.location].filter(Boolean).join(' · '),
    s.call_time ? `**Call** ${s.call_time}${s.wrap_time ? ` · **Wrap** ${s.wrap_time}` : ''}` : ''].filter(x => x !== undefined);
  const rows = s.shots.map(x => `| ${x.n} | ${x.time} | ${x.name} | ${x.lens_mm} mm${x.aperture ? ` f/${x.aperture}` : ''}${x.shutter ? ` ${x.shutter}` : ''} | ${[x.framing, x.people, x.light].filter(Boolean).join('; ')} |`);
  const windows = s.windows ? Object.entries(s.windows).map(([k, v]) => `- ${k.replace(/_/g, ' ')}: ${v}`) : [];
  return [...head, '', '| # | Time | Shot | Lens | Framing, people, light |', '|---|---|---|---|---|', ...rows, '',
    ...(windows.length ? ['## Light', ...windows, ''] : []),
    ...(s.crew_notes?.length ? ['## Notes', ...s.crew_notes.map(n => `- ${n}`), ''] : []),
    `[Open the designed call sheet](${sheetUrl}) · [Open the live set](${planUrl})`].join('\n');
}

export function sheetText(s: Sheet): string {
  return [`${s.title ?? 'Call sheet'}${s.call_time ? `, call ${s.call_time}` : ''}`, ...s.shots.slice(0, 6).map(x => `${x.n}. ${x.time} ${x.name}, ${x.lens_mm} mm`)].join('\n');
}

/** The sends for one event on one channel. */
export function plan(ev: SetEvent, channel: Channel): Op[] {
  if (channel === 'voice') return [];
  switch (ev.kind) {
    case 'progress':
      return channel === 'telegram' ? [{ op: 'progress', key: ev.key, text: ev.text }] : [];
    case 'note':
      if (channel === 'email') return [{ op: 'text', format: 'markdown', subject: `ShotMatch: ${oneLine(ev.text, 70)}`, text: `${ev.text}${ev.planUrl ? `\n\n[Open the live set](${ev.planUrl})` : ''}` }];
      return [{ op: 'text', text: ev.planUrl && channel === 'sms' ? `${ev.text} ${ev.planUrl}` : ev.text }];
    case 'render': {
      const line = `${ev.label}: ${oneLine(ev.caption)}`;
      if (channel === 'imessage') return [{ op: 'image', path: ev.image }, { op: 'text', text: `${line} Reply to this to change it.` }];
      if (channel === 'whatsapp') return [{ op: 'image', path: ev.image }, { op: 'text', text: `${line} Reply to this to change it. ${ev.planUrl}` }];
      if (channel === 'sms') return [{ op: 'text', text: `ShotMatch ${line} See it: ${ev.imageUrl}` }];
      if (channel === 'telegram') {
        const lenses = (ev.lenses ?? []).slice(0, 10);
        const caption = `${line}${lenses.length > 1 ? ` Lens options: ${lenses.map(l => `${Math.round(l.f35)} mm`).join(', ')}, exact crops of the render.` : ''} Reply to change it.`;
        return [
          lenses.length > 1 ? { op: 'album', paths: lenses.map(l => l.path), caption } : { op: 'image', path: ev.image, caption },
          { op: 'progress', key: `render:${ev.label}`, text: `${ev.label} is ready.` },
        ];
      }
      return [{ op: 'text', format: 'markdown', subject: `ShotMatch ${ev.label}: ${oneLine(ev.title, 60)}`,
        text: `## ${ev.label}\n\n${ev.caption}\n\nThe image is attached. It is an AI interpretation of the shot.\n\n[Open the live set](${ev.planUrl}) · [Full-size image](${ev.imageUrl})\n\nReply to this email to change it.` },
      { op: 'image', path: ev.image }];
    }
    case 'callsheet':
      if (channel === 'email') return [{ op: 'text', format: 'markdown', subject: `Call sheet: ${oneLine(ev.sheet.title ?? 'your shoot', 60)}`, text: sheetMarkdown(ev.sheet, ev.sheetUrl, ev.planUrl) }];
      return [{ op: 'text', text: `${sheetText(ev.sheet)}\nFull call sheet: ${ev.sheetUrl}` }];
  }
}

/** Lens options for the Telegram album: the render's own lens, then 50 and 85 mm where they are a real crop (never wider). */
export function lensOptions(baseF35: number): number[] {
  const out = [Math.round(baseF35)];
  for (const f of [50, 85]) if (f > baseF35 * 1.15) out.push(f);
  return out;
}

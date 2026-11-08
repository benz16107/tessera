// "On their phones": who is in this set on which channel, an invite form (any channel, nothing to install), the call
// sheet button, the version tree the text threads built (fork from any version here too) and the latest check-ins.
import { useState, type FormEvent } from 'react';
import { useReducer } from 'spacetimedb/react';
import { reducers } from '../module_bindings/index.ts';
import { CHANNELS, LABEL, SHORT, useCheckins, usePeopleOnChannels, usePhotonStatus, useVersions, type Channel } from './hooks.ts';
import './photon.css';

const PLACEHOLDER: Record<Channel, string> = { imessage: '+1 469 555 0101', telegram: '@username', sms: '+1 469 555 0101', whatsapp: '+1 469 555 0101', email: 'name@example.com', voice: '+1 469 555 0101' };
const time = (d: Date) => d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

/** Small channel tags for one participant (for the participant list or the presence bar). */
export function ChannelBadges({ sessionId, participantId, name }: { sessionId: bigint; participantId?: bigint; name?: string }) {
  const people = usePeopleOnChannels(sessionId);
  const p = people.find(x => (participantId && x.participantId === participantId) || (!participantId && name && x.name === name));
  if (!p) return null;
  return <span className="ph-badges">{p.links.map(l => <span key={String(l.id)} className="ph-badge" data-ok={l.verified} title={`${LABEL[l.channel] ?? l.channel} ${l.verified ? '(heard from them)' : '(invited)'}`}>{SHORT[l.channel] ?? l.channel}</span>)}</span>;
}

export function PhotonPanel({ sessionId, code, myName }: { sessionId: bigint; code: string; myName?: string }) {
  const people = usePeopleOnChannels(sessionId), versions = useVersions(sessionId), checkins = useCheckins(sessionId), status = usePhotonStatus();
  const fork = useReducer(reducers.restoreToVersion);
  const [name, setName] = useState(''), [channel, setChannel] = useState<Channel>('sms'), [address, setAddress] = useState('');
  const [busy, setBusy] = useState(''), [note, setNote] = useState<{ text: string; share?: string } | null>(null);

  const invite = async (e: FormEvent) => {
    e.preventDefault();
    if (!address.trim()) return;
    setBusy('invite'); setNote(null);
    try {
      const r = await fetch('/api/photon/invite', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code, name: name.trim() || 'A friend', channel, address, by: myName || 'Someone' }) }).then(x => x.json());
      setNote({ text: r.note ?? r.error ?? 'Done.', share: r.delivered ? undefined : r.shareText });
      if (r.ok) { setName(''); setAddress(''); }
    } catch (x) { setNote({ text: `Invite failed: ${(x as Error).message}` }); }
    setBusy('');
  };
  const sheet = async () => {
    setBusy('sheet'); setNote(null);
    try {
      const r = await fetch('/api/photon/callsheet', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code }) }).then(x => x.json());
      setNote({ text: r.error ?? `Call sheet with ${r.shots} shots sent to ${(r.sent ?? []).filter((s: any) => s.ok).map((s: any) => `${s.name} (${LABEL[s.channel]})`).join(', ') || 'nobody on a channel yet'}. ${r.url}` });
    } catch (x) { setNote({ text: `Call sheet failed: ${(x as Error).message}` }); }
    setBusy('');
  };

  const byId = new Map(versions.map(v => [String(v.id), v]));
  const isFork = (v: (typeof versions)[number]) => v.label.includes('.') && v.parentVersionId !== undefined && byId.has(String(v.parentVersionId));
  const depth = (v: (typeof versions)[number]): number => (isFork(v) ? 1 + depth(byId.get(String(v.parentVersionId))!) : 0);
  const ordered: typeof versions = [];
  const walk = (v: (typeof versions)[number]) => { ordered.push(v); versions.filter(c => isFork(c) && c.parentVersionId === v.id).forEach(walk); };
  versions.filter(v => !isFork(v)).forEach(walk);

  return (
    <section className="ph-panel" aria-label="People on their phones">
      <header className="ph-head">
        <span className="ph-title">On their phones</span>
        <span className="ph-state" data-on={!!status?.enabled} title={status?.note}>{status?.enabled ? 'Photon live' : 'Photon waiting on keys'}</span>
      </header>

      {people.length ? (
        <ul className="ph-people">
          {people.map(p => (
            <li key={p.key}>
              <span className="ph-name">{p.name}</span>
              <span className="ph-badges">{p.links.map(l => <span key={String(l.id)} className="ph-badge" data-ok={l.verified} title={`${LABEL[l.channel] ?? l.channel}: ${l.address} ${l.verified ? '(heard from them)' : '(invited)'}`}>{SHORT[l.channel] ?? l.channel}</span>)}</span>
              {!p.participantId && <span className="ph-dim">not on the scout page</span>}
            </li>
          ))}
        </ul>
      ) : <p className="ph-dim">Nobody is on a channel yet. Invite someone, or text a photo to Tessera.</p>}

      <form className="ph-invite" onSubmit={invite}>
        <input aria-label="Name" placeholder="Name" value={name} onChange={e => setName(e.target.value)} maxLength={40} />
        <select aria-label="Channel" value={channel} onChange={e => setChannel(e.target.value as Channel)}>
          {CHANNELS.map(c => <option key={c} value={c}>{LABEL[c]}</option>)}
        </select>
        <input aria-label="Phone, handle or email" placeholder={PLACEHOLDER[channel]} value={address} onChange={e => setAddress(e.target.value)} inputMode={channel === 'email' ? 'email' : channel === 'telegram' ? 'text' : 'tel'} />
        <button className="ph-btn primary" disabled={busy === 'invite' || !address.trim()}>{busy === 'invite' ? 'Inviting' : 'Invite'}</button>
      </form>
      {note && (
        <div className="ph-note" role="status">
          <p>{note.text}</p>
          {note.share && <button type="button" className="ph-btn" onClick={() => navigator.clipboard?.writeText(note.share!)}>Copy the text to forward</button>}
        </div>
      )}
      <button type="button" className="ph-btn wide" onClick={sheet} disabled={busy === 'sheet'}>{busy === 'sheet' ? 'Writing the call sheet' : 'Send call sheet to everyone'}</button>

      <h3 className="ph-sub">Versions from the threads</h3>
      {ordered.length ? (
        <ol className="ph-versions">
          {ordered.map(v => (
            <li key={String(v.id)} style={{ paddingLeft: depth(v) * 14 }}>
              {v.imageUrl ? <img src={v.imageUrl} alt={`Render ${v.label}`} loading="lazy" /> : <span className="ph-thumb" aria-hidden />}
              <span className="ph-label">{v.label}</span>
              <span className="ph-dim">{LABEL[v.channel] ?? v.channel} · {time(v.createdAt.toDate())}</span>
              <button type="button" className="ph-btn small" onClick={() => fork({ versionId: v.id, channel: 'web', externalMessageId: `web:${Date.now()}` })} title={`Put the set back to ${v.label} as a new branch`}>Fork</button>
            </li>
          ))}
        </ol>
      ) : <p className="ph-dim">Each render sent to the threads becomes v1, v2, v3. Replying to one in any chat forks the set from it.</p>}

      {checkins.length > 0 && (<>
        <h3 className="ph-sub">Check-ins</h3>
        <ul className="ph-checkins">
          {checkins.map(c => <li key={String(c.id)} data-verdict={c.verdict}><span className="ph-name">{c.name || 'Scout'}</span> {c.verdict}, {c.distanceM.toFixed(1)} m and {Math.abs(c.headingErrDeg).toFixed(0)}° off <span className="ph-dim">{time(c.createdAt.toDate())}</span></li>)}
        </ul>
      </>)}
    </section>
  );
}

// Who is in the set: one chip per person from the presence table (color, active or idle, what they have selected),
// with follow buttons that send set events, and the live sun switch.
import { useSpacetimeDB } from 'spacetimedb/react';
import { usePresence, useSetEvents, useSunClock } from './hooks.ts';
import './spacetime.css';

const RATES: [number, string][] = [[0, 'Off'], [1, 'Live'], [60, '60x'], [600, '600x']];

export function SunClock({ sessionId }: { sessionId: bigint }) {
  const { rate, startedBy, setRate } = useSunClock(sessionId);
  return (
    <label className="stdb-sun" title={rate ? `Started by ${startedBy}. A schedule in the database moves the set's clock every second.` : 'Off: the timeline sets the time'}>
      <span className="stdb-label">Live sun</span>
      <select className="stdb-select" value={RATES.some(([r]) => r === rate) ? rate : 0} onChange={e => setRate(Number(e.target.value)).catch(() => {})}>
        {RATES.map(([r, label]) => <option key={r} value={r}>{label}</option>)}
      </select>
    </label>
  );
}

export function Presence({ sessionId, focusObjectId }: { sessionId: bigint; focusObjectId?: bigint | null }) {
  const { identity } = useSpacetimeDB();
  const { people } = usePresence(sessionId, focusObjectId);
  const ev = useSetEvents(sessionId, identity ?? undefined);
  const sorted = [...people].sort((a, b) => Number(a.participantId - b.participantId));
  return (
    <div className="stdb-presence" aria-label="People in the set">
      <ul className="stdb-people">
        {sorted.map(p => {
          const me = identity && p.identity.isEqual(identity);
          const hex = p.identity.toHexString();
          const following = ev.following === hex;
          return (
            <li key={String(p.participantId)} className="stdb-person" data-status={p.status} style={{ ['--who' as string]: p.color }}
              title={`${p.name}${me ? ' (you)' : ''}: ${p.status}${p.focusObjectId ? `, editing object ${p.focusObjectId}` : ''}${ev.followers.has(hex) ? ', following you' : ''}`}>
              <span className="stdb-dot" aria-hidden="true">{p.name.slice(0, 1).toUpperCase()}</span>
              <span className="stdb-name">{me ? 'You' : p.name}</span>
              {!me && (
                <button className="stdb-link" onClick={() => (following ? ev.unfollow(p.identity) : ev.follow(p.identity)).catch(() => {})}>
                  {following ? 'Unfollow' : 'Follow'}
                </button>
              )}
            </li>
          );
        })}
      </ul>
      <button className="stdb-link" onClick={() => ev.follow(null).catch(() => {})} title="Ask everyone to follow your view">Follow me</button>
      <SunClock sessionId={sessionId} />
      {ev.invite && (
        <p className="stdb-invite" role="status">
          {ev.invite.name} asks everyone to follow their view.
          <button className="stdb-link" onClick={ev.acceptInvite}>Follow</button>
          <button className="stdb-link" onClick={ev.dismissInvite}>Not now</button>
        </p>
      )}
    </div>
  );
}

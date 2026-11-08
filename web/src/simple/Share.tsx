// Share: invite friends by phone or email (the crew sends a Photon channel link, docs/PHOTON.md), copy the link, or show
// the QR code. Friends land in Simple on a phone; either view edits the same shoot.
import { useEffect, useRef, useState } from 'react';
import { useReducer, useSpacetimeDB } from 'spacetimedb/react';
import QRCode from 'qrcode';
import { reducers } from '../module_bindings/index.ts';
import type { Session } from '../module_bindings/types.ts';
import { useConfig, shareBase, NAME_KEY } from '../config.ts';
import { navigate } from '../App.tsx';
import { Close } from './icons.tsx';

const PHONE_CHANNELS = [['imessage', 'iMessage'], ['sms', 'SMS'], ['whatsapp', 'WhatsApp']] as const;

export default function ShareSheet({ session, myName, onClose }: { session: Session; myName: string; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const url = `${shareBase(useConfig())}/p/${session.code}`;
  const join = useReducer(reducers.joinSession);
  const del = useReducer(reducers.deleteSession);
  const { identity } = useSpacetimeDB();
  const isOwner = !!identity && session.owner.isEqual(identity);
  const [confirming, setConfirming] = useState(false);
  const [qr, setQr] = useState('');
  const [copied, setCopied] = useState(false);
  const [who, setWho] = useState('');
  const [address, setAddress] = useState('');
  const [phoneCh, setPhoneCh] = useState<string>('imessage');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ text: string; share?: string; bad?: boolean } | null>(null);
  const [me, setMe] = useState(myName === 'Guest' ? '' : myName);
  useEffect(() => { ref.current?.showModal(); }, []);
  useEffect(() => { QRCode.toDataURL(url, { margin: 1, width: 400, color: { dark: '#1d1d1f', light: '#ffffff' } }).then(setQr).catch(() => setQr('')); }, [url]);

  const email = address.includes('@');
  const channel = email ? 'email' : phoneCh;
  const invite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!address.trim()) return;
    setBusy(true); setNote(null);
    try {
      const r = await fetch('/api/photon/invite', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ code: session.code, name: who.trim() || 'A friend', channel, address: address.trim(), by: me.trim() || myName }),
      }).then(x => x.json());
      setNote({ text: r.note ?? r.error ?? 'Invite sent.', share: r.delivered ? undefined : r.shareText, bad: !!r.error });
      if (r.ok) { setWho(''); setAddress(''); }
    } catch (x) { setNote({ text: `The invite did not go out: ${(x as Error).message}`, bad: true }); }
    setBusy(false);
  };
  const copy = (text: string) => navigator.clipboard?.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1600); }).catch(() => {});
  const rename = () => {
    const n = me.trim();
    if (!n || n === myName) return;
    localStorage.setItem(NAME_KEY, n);
    join({ code: session.code, name: n, role: 'planner' }).catch(() => {});
  };

  return (
    <dialog ref={ref} className="simple s-sheet s-share" onClose={onClose} aria-labelledby="s-share-title">
      <div className="s-sheet-head">
        <h2 id="s-share-title">Plan this shot together</h2>
        <button type="button" className="s-icon-btn" aria-label="Close" onClick={() => ref.current?.close()}><Close /></button>
      </div>

      <form className="s-invite" onSubmit={invite}>
        <p className="s-label">Invite a friend</p>
        <div className="s-invite-row">
          <label className="sr-only" htmlFor="s-inv-name">Their name</label>
          <input id="s-inv-name" className="s-field" value={who} onChange={e => setWho(e.target.value)} placeholder="Name" maxLength={40} autoComplete="off" />
          <label className="sr-only" htmlFor="s-inv-addr">Phone number or email</label>
          <input id="s-inv-addr" className="s-field" value={address} onChange={e => setAddress(e.target.value)} placeholder="Phone or email"
            inputMode={email ? 'email' : 'text'} autoComplete="off" />
        </div>
        {!email && (
          <div className="s-seg small" role="group" aria-label="Send by">
            {PHONE_CHANNELS.map(([k, l]) => <button type="button" key={k} aria-pressed={phoneCh === k} onClick={() => setPhoneCh(k)}>{l}</button>)}
          </div>
        )}
        <button className="s-btn primary wide" disabled={busy || !address.trim()}>{busy ? 'Inviting' : `Invite by ${email ? 'email' : PHONE_CHANNELS.find(c => c[0] === phoneCh)![1]}`}</button>
        {note && (
          <div className="s-note" role="status" data-bad={note.bad || undefined}>
            <p>{note.text}</p>
            {note.share && <button type="button" className="s-textbtn" onClick={() => copy(note.share!)}>Copy the text to send them</button>}
          </div>
        )}
      </form>

      <div className="s-sharelink">
        {qr ? <img src={qr} alt={`QR code for ${url}`} width={132} height={132} /> : <span className="s-sk s-sk-qr" />}
        <div>
          <p className="s-label">Or send the link</p>
          <p className="s-sharecode" aria-label={`Shoot code ${session.code}`}>{session.code}</p>
          {/* The link may break only before /p/, never inside the code. */}
          <p className="s-url">{url.slice(0, -`/p/${session.code}`.length)}<wbr /><span>/p/{session.code}</span></p>
          <button type="button" className="s-btn" onClick={() => copy(url)}>{copied ? 'Copied' : 'Copy link'}</button>
          <p className="s-muted small">Anyone with it joins this shoot live. On a phone it opens here; on a laptop they can switch to Studio.</p>
        </div>
      </div>

      <form className="s-me" onSubmit={e => { e.preventDefault(); rename(); }}>
        <label htmlFor="s-me-name" className="s-label">Friends see you as</label>
        <div className="s-invite-row">
          <input id="s-me-name" className="s-field" value={me} onChange={e => setMe(e.target.value)} placeholder="Your name" maxLength={40} autoComplete="nickname" />
          <button className="s-btn" disabled={!me.trim() || me.trim() === myName}>Save</button>
        </div>
      </form>

      {isOwner && (
        <div className="s-danger">
          {!confirming ? <button type="button" className="s-textbtn bad" onClick={() => setConfirming(true)}>Delete this shoot</button> : (
            <div role="alertdialog" aria-labelledby="s-del-title">
              <p id="s-del-title"><b>Delete this shoot for everyone?</b> Its photos, renders, people and messages go with it. This can't be undone.</p>
              <div className="s-invite-row">
                <button type="button" className="s-btn danger" onClick={() => del({ sessionId: session.id }).then(() => { ref.current?.close(); navigate('/'); }).catch(e => setNote({ text: String(e?.message ?? e), bad: true }))}>Delete shoot</button>
                <button type="button" className="s-btn" onClick={() => setConfirming(false)} autoFocus>Keep it</button>
              </div>
            </div>
          )}
        </div>
      )}
    </dialog>
  );
}

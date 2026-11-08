// Text and hold-to-talk commands to the set. Words go to POST /api/set/command; speech goes to Parakeet first
// (POST /api/voice/transcribe) and then to the same agent. Nemotron's steps stream in from agent_step rows while it works.
import { useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { brief, call, label, sid, stepTime, useAgentSteps, useElapsed, type CommandResult } from './api.ts';

type Props = { sessionId: bigint; photoId?: bigint };

export function CommandBar({ sessionId }: Props) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState<'' | 'thinking' | 'listening' | 'hearing'>('');
  const [since, setSince] = useState(0);
  const [result, setResult] = useState<CommandResult | null>(null);
  const [error, setError] = useState('');
  const [speak, setSpeak] = useState(false);
  const [offline, setOffline] = useState(false);
  const rec = useRef<{ r: MediaRecorder; chunks: Blob[]; stream: MediaStream } | null>(null);
  const steps = useAgentSteps(sessionId).filter(s => since && stepTime(s) >= since - 1500);
  const secs = useElapsed(!!busy && busy !== 'listening');

  const play = (src?: string) => { if (src) new Audio(src).play().catch(() => {}); };
  const speakReply = async (reply: string) => {
    if (!speak || !reply) return;
    const r = await fetch('/api/voice/speak', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: reply }) });
    if (r.ok) play(URL.createObjectURL(await r.blob()));
  };

  const send = async (e?: FormEvent) => {
    e?.preventDefault();
    const t = text.trim();
    if (!t || busy) return;
    setBusy('thinking'); setError(''); setResult(null); setSince(Date.now());
    try {
      const r = await call<CommandResult>('/api/set/command', { sessionId: sid(sessionId), text: t, offline });
      setResult(r); setText('');
      void speakReply(r.reply);
    } catch (err) { setError((err as Error).message); }
    setBusy('');
  };

  const startTalk = async () => {
    if (busy || rec.current) return;
    setError('');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const r = new MediaRecorder(stream);
      const chunks: Blob[] = [];
      r.ondataavailable = ev => ev.data.size && chunks.push(ev.data);
      rec.current = { r, chunks, stream };
      r.start();
      setBusy('listening');
    } catch { setError('Microphone access was refused.'); }
  };

  const stopTalk = async () => {
    const cur = rec.current;
    if (!cur) return;
    rec.current = null;
    const done = new Promise<void>(ok => (cur.r.onstop = () => ok()));
    cur.r.stop();
    await done;
    cur.stream.getTracks().forEach(t => t.stop());
    const blob = new Blob(cur.chunks, { type: cur.r.mimeType || 'audio/webm' });
    if (blob.size < 2000) { setBusy(''); setError('Hold the mic while you talk.'); return; }
    setBusy('hearing'); setResult(null); setSince(Date.now());
    try {
      const r = await call<CommandResult>(`/api/voice/transcribe?session=${sid(sessionId)}&run=1&speak=${speak ? 1 : 0}`, undefined,
        { method: 'POST', headers: { 'content-type': blob.type }, body: blob });
      setResult(r);
      play(r.audio);
    } catch (err) { setError((err as Error).message); }
    setBusy('');
  };

  const micKeys = (e: KeyboardEvent, down: boolean) => {
    if (e.key !== ' ' && e.key !== 'Enter') return;
    e.preventDefault(); e.stopPropagation();
    if (down && !e.repeat) void startTalk(); else if (!down) void stopTalk();
  };

  return (
    <section className="nv nv-command" aria-label="Tell Nemotron what to put in the set">
      <form onSubmit={send} className="nv-row">
        <input className="nv-input" value={text} onChange={e => setText(e.target.value)} onKeyDown={e => e.stopPropagation()} disabled={!!busy}
          placeholder="Two friends walking toward camera, a red bike on the left wall, warm string lights" aria-label="Set command" />
        <button type="button" className={`nv-btn nv-mic${busy === 'listening' ? ' on' : ''}`} aria-pressed={busy === 'listening'}
          onPointerDown={e => { e.preventDefault(); void startTalk(); }} onPointerUp={() => void stopTalk()} onPointerLeave={() => busy === 'listening' && void stopTalk()}
          onKeyDown={e => micKeys(e, true)} onKeyUp={e => micKeys(e, false)} title="Hold to talk (Parakeet speech to text)">
          {busy === 'listening' ? 'Listening' : 'Hold to talk'}
        </button>
        <button className="nv-btn primary" disabled={!!busy || !text.trim()}>Send</button>
      </form>
      <div className="nv-row nv-small">
        <label><input type="checkbox" checked={speak} onChange={e => setSpeak(e.target.checked)} /> Speak replies (Magpie)</label>
        <label title="Plan the edits with Nemotron 3.5 Bolt on the server's CPU through Ollama, as when the hosted API is down"><input type="checkbox" checked={offline} onChange={e => setOffline(e.target.checked)} /> Offline (Bolt)</label>
        {busy && busy !== 'listening' && <span className="nv-muted nv-num">{busy === 'hearing' ? 'Parakeet is listening back' : 'Nemotron is working'} {secs} s</span>}
      </div>
      {(steps.length > 0 || busy === 'thinking' || busy === 'hearing') && (
        <ol className="nv-steps" aria-live="polite">
          {steps.map(s => (
            <li key={String(s.id)}>
              <span className="nv-step-tool">{label(s.tool)}</span>
              <span className="nv-step-res">{s.tool === 'command' ? s.result : brief(s.result)}</span>
              <span className="nv-num nv-muted">{s.ms ? `${s.ms} ms` : ''}</span>
            </li>
          ))}
          {busy && <li className="nv-skel" aria-hidden="true" />}
        </ol>
      )}
      {result && (
        <div className="nv-reply">
          {result.heard && <p className="nv-muted">Heard: "{result.heard}"</p>}
          <p>{result.reply}</p>
          <p className="nv-muted nv-num">{result.model}{result.offline ? ' (offline)' : ''} · {(result.ms / 1000).toFixed(1)} s{result.routeMs ? ` · routed in ${result.routeMs} ms` : ''}</p>
        </div>
      )}
      {error && <p className="nv-error" role="alert">{error}</p>}
    </section>
  );
}

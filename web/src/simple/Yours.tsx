// A-3 Make it yours: one-tap presets that call the real pipeline (plan time, Nemotron set commands, the shared lens),
// a "Describe a change" field with hold-to-talk, and "Make it": the studio's render layers from Simple's own 3D view go to
// POST /api/render (NVIDIA). Results sit beside the original, labelled "AI interpretation", with versions as a strip.
import { useMemo, useRef, useState, type MutableRefObject } from 'react';
import { useTable, useReducer } from 'spacetimedb/react';
import { tables, reducers } from '../module_bindings/index.ts';
import type { Photo, SolveResult } from '../module_bindings/types.ts';
import { fmtTime, hfovDeg, lightWindows } from '../geo.ts';
import { call, type CommandResult } from '../nvidia/api.ts';
import { postLayers } from '../nvidia/RenderPanel.tsx';
import { useVersions } from '../photon/hooks.ts';
import { bodyById, defaultBody, pickLens } from '../studio/catalog/index.ts';
import type { Shot } from '../studio/state/useShotSettings.ts';
import type { Optics } from '../studio/camera/shot.ts';
import type { Layers } from '../studio/render/layers.ts';
import { iphoneZoom, photoCredit, useNow } from './lib.ts';
import { Aperture, Mic, Moon, People, Person, Send, Sun, Wide } from './icons.tsx';

interface Props {
  sessionId: bigint; photo: Photo; spotId: string; solved: SolveResult;
  shot: Shot; setShot: (p: Partial<Shot>) => void; o: Optics;
  planTime: Date; zone: string; changeTime: (d: Date) => void;
  people: number; capture: MutableRefObject<(() => Promise<Layers>) | null>;
  sun: { azimuth: number; altitude: number }; credit?: string;
}

type Busy = '' | 'friend' | 'friends' | 'command' | 'listening' | 'hearing' | 'render';
const BUSY_TEXT: Record<Busy, string> = {
  '': '', friend: 'Nemotron is placing a friend', friends: 'Nemotron is placing two friends', command: 'Nemotron is changing the set',
  listening: 'Listening. Let go when you are done.', hearing: 'Parakeet is writing down what you said', render: 'Rendering your version on NVIDIA',
};

export default function Yours(p: Props) {
  const { sessionId: sid, photo } = p;
  const [previews] = useTable(tables.previewJob.where(r => r.sessionId.eq(sid)));
  const versions = useVersions(sid);
  const requestPreview = useReducer(reducers.requestPreview);
  const restore = useReducer(reducers.restoreToVersion);
  const [busy, setBusy] = useState<Busy>('');
  const [since, setSince] = useState(0);
  const [status, setStatus] = useState<{ text: string; bad?: boolean } | null>(null);
  const [text, setText] = useState('');
  const [mine, setMine] = useState<{ url: string; words: string } | null>(null);
  const [picked, setPicked] = useState<bigint | null>(null);
  const rec = useRef<{ r: MediaRecorder; chunks: Blob[]; stream: MediaStream } | null>(null);
  const now = useNow(1000, !!busy);

  const pose = p.solved.pose;
  const hfov = hfovDeg(pose.f35, photo.width, photo.height);
  const windows = useMemo(() => lightWindows(new Date(), pose.lat, pose.lon, pose.heading, hfov, 2), [pose.lat, pose.lon, pose.heading, hfov]);
  const golden = windows.find(w => w.kind === 'Golden hour'), blue = windows.find(w => w.kind === 'Blue hour');
  const inWin = (w?: { start: Date; end: Date }) => !!w && p.planTime >= w.start && p.planTime <= w.end;
  const lightWord = inWin(golden) ? 'golden hour' : inWin(blue) ? 'blue hour' : fmtTime(p.planTime, p.zone);
  const f35 = Math.round(p.o.f35);

  const jobs = [...previews].filter(j => j.photoId === photo.id).sort((a, b) => Number(b.id - a.id));
  const running = jobs.find(j => j.state === 'queued' || j.state === 'running');
  const latest = jobs.find(j => j.state === 'done' && j.imageUrl);
  const pickedV = versions.find(v => v.id === picked && v.imageUrl);
  const yourUrl = pickedV?.imageUrl || mine?.url || latest?.imageUrl || '';
  // The caption describes the image on screen, not the current settings.
  const yourWords = pickedV ? pickedV.label : mine ? mine.words
    : latest ? `${latest.f35 ? `${Math.round(latest.f35)} mm, ` : ''}${latest.people} ${latest.people === 1 ? 'person' : 'people'}, ${latest.createdAt.toDate().toLocaleDateString([], { month: 'short', day: 'numeric' })}` : '';
  const working = busy === 'render' || !!running;
  const shown = versions.filter(v => v.imageUrl);

  const lens = (target: number, aperture?: number) => {
    const body = bodyById(p.shot.bodyId) ?? defaultBody();
    const { lens: l, focal } = pickLens(body, target);
    p.setShot({ lensId: l.id, focalMm: focal, ...(aperture ? { aperture } : {}) });
  };
  const command = async (words: string, kind: Busy) => {
    if (busy) return;
    setBusy(kind); setSince(Date.now()); setStatus(null);
    try {
      const r = await call<CommandResult>('/api/set/command', { sessionId: String(sid), text: words });
      setStatus({ text: r.reply || 'Done.', bad: r.intent === 'refused' || r.intent === 'error' });
      if (kind === 'command') setText('');
    } catch (e) { setStatus({ text: `That did not work: ${(e as Error).message}`, bad: true }); }
    setBusy('');
  };

  const startTalk = async () => {
    if (busy || rec.current) return;
    setStatus(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const r = new MediaRecorder(stream);
      const chunks: Blob[] = [];
      r.ondataavailable = ev => { if (ev.data.size) chunks.push(ev.data); };
      rec.current = { r, chunks, stream };
      r.start();
      setBusy('listening');
    } catch { setStatus({ text: 'The microphone is off for this page. Type the change instead.', bad: true }); }
  };
  const stopTalk = async () => {
    const cur = rec.current;
    if (!cur) return;
    rec.current = null;
    const stopped = new Promise<void>(ok => { cur.r.onstop = () => ok(); });
    cur.r.stop();
    await stopped;
    cur.stream.getTracks().forEach(t => t.stop());
    const blob = new Blob(cur.chunks, { type: cur.r.mimeType || 'audio/webm' });
    if (blob.size < 2000) { setBusy(''); setStatus({ text: 'Hold the button while you talk.', bad: true }); return; }
    setBusy('hearing'); setSince(Date.now());
    try {
      const r = await call<CommandResult>(`/api/voice/transcribe?session=${sid}&run=1`, undefined, { method: 'POST', headers: { 'content-type': blob.type }, body: blob });
      setStatus({ text: `${r.heard ? `"${r.heard}" ` : ''}${r.reply || 'Done.'}`, bad: r.intent === 'refused' || r.intent === 'error' });
    } catch (e) { setStatus({ text: `That did not work: ${(e as Error).message}`, bad: true }); }
    setBusy('');
  };

  const make = async () => {
    if (busy) return;
    setBusy('render'); setSince(Date.now()); setStatus(null); setPicked(null);
    const words = `${f35} mm, ${lightWord}, ${p.people} ${p.people === 1 ? 'person' : 'people'}`;
    const settings = { ...p.shot, f35: p.o.f35, time: p.planTime.toISOString(), sunAzimuth: p.sun.azimuth, sunAltitude: p.sun.altitude };
    try {
      if (!p.capture.current) throw new Error('the 3D view is still loading');
      const layers = await p.capture.current();
      const r = await postLayers(layers, { sessionId: sid, photoId: photo.id, text: words, settings });
      setMine({ url: r.url, words });
      setStatus({ text: `Made with ${r.model}${r.fallback ? ` (${r.fallback})` : ''} in ${Math.round(r.ms / 1000)} s.` });
    } catch (e) {
      // The NVIDIA render needs the 3D layers and the crew; when either fails, the preview job edits the photo from words.
      try {
        await requestPreview({ sessionId: sid, photoId: photo.id, instruction: words, f35: p.o.f35, people: p.people, sunAzimuth: p.sun.azimuth, sunAltitude: p.sun.altitude });
        setStatus({ text: `The full render was not available (${(e as Error).message}), so this is a quicker preview made from your photo.` });
      } catch (x) { setStatus({ text: `Could not make it: ${(x as Error).message}`, bad: true }); }
    }
    setBusy('');
  };

  const secs = Math.max(0, Math.round((now - since) / 1000));
  return (
    <article className="s-yours">
      <div className="s-compare">
        <figure>
          <img src={photo.url || photo.thumb} alt="Your original photo" />
          <figcaption><b>Original</b> {Math.round(pose.f35)} mm<br /><span className="s-credit">{photoCredit(photo, p.spotId, p.credit)}</span></figcaption>
        </figure>
        <figure>
          <div className="s-yourimg" style={{ aspectRatio: `${photo.width} / ${photo.height}` }}>
            {working ? <span className="s-sk s-sk-fill" aria-label="Your version is being made" />
              : yourUrl ? <img src={yourUrl} alt={`AI interpretation of your plan${pickedV ? `, ${pickedV.label}` : ''}`} />
              : <span className="s-empty">Tap a change below, then Make it.</span>}
            {(yourUrl || working) && <span className="s-ai">AI interpretation</span>}
          </div>
          <figcaption><b>Your version</b> {working ? 'in the works' : yourWords}</figcaption>
        </figure>
      </div>

      {shown.length > 0 && (
        <div className="s-versions" role="group" aria-label="Versions">
          {shown.map(v => (
            <button key={String(v.id)} aria-pressed={picked === v.id} title={`Go back to ${v.label}`}
              onClick={() => { setPicked(v.id); restore({ versionId: v.id, channel: 'web', externalMessageId: `simple:${Date.now()}` }).catch(() => {}); }}>
              <img src={v.imageUrl} alt="" /><span>{v.label}</span>
            </button>
          ))}
        </div>
      )}

      <div className="s-presets" role="group" aria-label="Quick changes">
        <button className="s-chip" aria-pressed={inWin(golden)} disabled={!golden} onClick={() => golden && p.changeTime(golden.mid)}><Sun /> Golden hour</button>
        <button className="s-chip" aria-pressed={inWin(blue)} disabled={!blue} onClick={() => blue && p.changeTime(new Date((blue.start.getTime() + blue.end.getTime()) / 2))}><Moon /> Blue hour</button>
        <button className="s-chip" disabled={!!busy} onClick={() => command('Add one friend standing on the street about 6 m in front of the camera, in the middle of the frame, facing the camera.', 'friend')}><Person /> Add a friend</button>
        <button className="s-chip" disabled={!!busy} onClick={() => command('Add two friends walking toward the camera side by side, about 7 m away, in the middle of the frame.', 'friends')}><People /> Add two friends</button>
        <button className="s-chip" aria-pressed={f35 >= 80 && f35 <= 90} onClick={() => lens(85, 2)}><Aperture /> Portrait look</button>
        <button className="s-chip" aria-pressed={f35 <= 26} onClick={() => lens(24)}><Wide /> Wider</button>
      </div>
      <p className="s-muted small s-lensline">{f35} mm, {iphoneZoom(p.o.f35)} on your iPhone, f/{p.shot.aperture.toFixed(1).replace(/\.0$/, '')} · {lightWord}{inWin(golden) || inWin(blue) ? `, ${fmtTime(p.planTime, p.zone)}` : ''}</p>

      <form className="s-describe" onSubmit={e => { e.preventDefault(); if (text.trim()) void command(text.trim(), 'command'); }}>
        <label htmlFor="s-desc" className="sr-only">Describe a change</label>
        <input id="s-desc" value={text} onChange={e => setText(e.target.value)} maxLength={300} placeholder="Describe a change, like a red bike on the left" autoComplete="off" disabled={!!busy && busy !== 'command'} />
        <button type="button" className="s-icon-btn mic" aria-label="Hold to talk" aria-pressed={busy === 'listening'}
          onPointerDown={e => { e.preventDefault(); void startTalk(); }} onPointerUp={() => void stopTalk()} onPointerLeave={() => void stopTalk()}
          onKeyDown={e => { if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) { e.preventDefault(); void startTalk(); } }}
          onKeyUp={e => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); void stopTalk(); } }}><Mic /></button>
        <button className="s-icon-btn send" aria-label="Send the change" disabled={!text.trim() || !!busy}><Send /></button>
      </form>
      <p className="s-status" role="status" aria-live="polite" data-bad={status?.bad || undefined}>
        {busy ? `${BUSY_TEXT[busy]}${busy !== 'listening' ? ` · ${secs} s` : ''}` : status?.text ?? ''}
      </p>

      <p className="s-muted small s-make-note">Made from your photo and only the people and props in the set. Map imagery never goes into it.</p>
      <div className="s-make">
        <p className="s-muted small">Made from your photo and only the people and props in the set. Map imagery never goes into it.</p>
        <button className="s-btn primary big" onClick={make} disabled={!!busy}>{busy === 'render' ? 'Making it' : 'Make it'}</button>
      </div>
    </article>
  );
}

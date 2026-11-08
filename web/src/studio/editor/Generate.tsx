// Generate: words, voice or a photo to a real-scale prop through the crew (POST /api/props/generate, NVIDIA TRELLIS, with a
// concept image first when the crew supports it). Nemotron's and TRELLIS's steps stream in from agent_step rows.
// The studio places the result where the user last pointed (or the crew's placement) and selects it.
import { useEffect, useRef, useState } from 'react';
import { useTable } from 'spacetimedb/react';
import { tables } from '../../module_bindings/index.ts';
import { Ico, Seg } from './ui.tsx';

export type GenMode = '3d' | 'image3d' | 'poster';
export interface GenResult { url: string; name: string; prompt?: string; source: 'words' | 'photo' | 'voice'; conceptUrl?: string; heightM?: number; mode: GenMode; ms?: number; model?: string; objectId?: string }

const IMG_RE = /\/(?:asset|preview|photo|concept)\/[\w.-]+\.(?:png|jpe?g|webp)/i;

/** A photo as a JPEG data URL, at most 1024 px on the long side (the crew's limit is 12 MB of JSON). */
export async function shrinkToDataUrl(file: Blob, max = 1024): Promise<string> {
  const img = await createImageBitmap(file);
  const k = Math.min(1, max / Math.max(img.width, img.height));
  const c = document.createElement('canvas');
  c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
  c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.9);
}

export async function generate(sessionId: bigint, body: { prompt?: string; image?: string; name: string; mode: GenMode }): Promise<Record<string, unknown>> {
  const r = await fetch('/api/props/generate', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sessionId: String(sessionId), place: false, ...body }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(String(j.error ?? `generate HTTP ${r.status}`));
  return j;
}

const clean = (s: string) => s.replace(/[;=\n]/g, ' ').trim();

export default function Generate({ sessionId, onResult, external }: {
  sessionId: bigint; onResult: (r: GenResult) => void; external?: { file: File; n: number } | null;
}) {
  const [prompt, setPrompt] = useState('');
  const [mode, setMode] = useState<GenMode>('3d');
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [concept, setConcept] = useState('');
  const [done, setDone] = useState<GenResult | null>(null);
  const [over, setOver] = useState(false);
  const [rec, setRec] = useState<{ r: MediaRecorder; chunks: Blob[]; stream: MediaStream } | null>(null);
  const [now, setNow] = useState(Date.now());
  const fileIn = useRef<HTMLInputElement>(null);
  const [steps] = useTable(tables.agentStep.where(r => r.sessionId.eq(sessionId)));
  useEffect(() => { if (busy === null) return; const t = setInterval(() => setNow(Date.now()), 250); return () => clearInterval(t); }, [busy]);

  const [started, setStarted] = useState<number | null>(null);
  const live = started === null ? [] : [...steps]
    .filter(s => Number(s.at.microsSinceUnixEpoch / 1000n) >= started - 1500)
    .sort((a, b) => Number(a.at.microsSinceUnixEpoch - b.at.microsSinceUnixEpoch));
  useEffect(() => { for (const s of live) { const m = (s.result + ' ' + s.args).match(IMG_RE); if (m) setConcept(m[0]); } }, [live.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const run = async (body: { prompt?: string; image?: string; name: string; mode: GenMode }, source: GenResult['source']) => {
    const t0 = Date.now();
    setBusy(t0); setStarted(t0); setError(''); setDone(null); setConcept('');
    try {
      const j = await generate(sessionId, body);
      const conceptUrl = String(j.conceptUrl ?? j.imageUrl ?? j.concept ?? '') || concept || undefined;
      if (conceptUrl) setConcept(conceptUrl);
      const res: GenResult = {
        url: String(j.url), name: clean(body.name).slice(0, 60) || 'Generated prop', prompt: body.prompt ? clean(body.prompt).slice(0, 200) : undefined,
        source, conceptUrl, mode: body.mode, ms: Number(j.ms) || undefined, model: j.model ? String(j.model) : undefined,
        heightM: Number(j.heightM ?? j.height_m) || undefined,
        objectId: (j.object as { id?: string } | undefined)?.id,
      };
      setDone(res);
      onResult(res);
    } catch (e) { setError((e as Error).message); }
    setBusy(null);
  };
  const fromWords = (text = prompt, source: GenResult['source'] = 'words') => { if (text.trim() && busy === null) void run({ prompt: text.trim(), name: text.trim(), mode }, source); };
  const fromFile = async (f?: File | null) => {
    if (!f || busy !== null) return;
    if (!/^image\/(png|jpeg|webp)$/.test(f.type)) { setError('Use a PNG, JPEG or WebP photo.'); return; }
    void run({ image: await shrinkToDataUrl(f), name: f.name.replace(/\.[^.]+$/, ''), mode: mode === 'poster' ? 'poster' : '3d' }, 'photo');
  };
  useEffect(() => { if (external) void fromFile(external.file); }, [external?.n]); // eslint-disable-line react-hooks/exhaustive-deps

  // Hold to talk: record while pressed, transcribe with Parakeet through the crew, then generate from the words.
  const startMic = async () => {
    if (rec || busy !== null) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const r = new MediaRecorder(stream), chunks: Blob[] = [];
      r.ondataavailable = e => chunks.push(e.data);
      r.start();
      setRec({ r, chunks, stream });
      setError('');
    } catch { setError('The microphone is blocked. Allow it for this site, or type instead.'); }
  };
  const stopMic = async () => {
    const cur = rec;
    if (!cur) return;
    setRec(null);
    await new Promise<void>(ok => { cur.r.onstop = () => ok(); cur.r.stop(); });
    cur.stream.getTracks().forEach(t => t.stop());
    const blob = new Blob(cur.chunks, { type: cur.r.mimeType || 'audio/webm' });
    if (blob.size < 2000) { setError('Hold the mic while you talk.'); return; }
    try {
      const r = await fetch(`/api/voice/transcribe?session=${sessionId}&run=0`, { method: 'POST', headers: { 'content-type': blob.type }, body: blob });
      const j = await r.json();
      const heard = String(j.heard ?? j.text ?? j.reply ?? '').trim();
      if (!r.ok || !heard) throw new Error(j.error ?? 'nothing heard');
      setPrompt(heard);
      fromWords(heard, 'voice');
    } catch (e) { setError(`Voice: ${(e as Error).message}`); }
  };

  const secs = busy !== null ? Math.round((now - busy) / 1000) : 0;
  return (
    <section className="st-gen" aria-label="Generate a prop">
      <Seg label="What to make" flat value={mode} onChange={setMode}
        options={[{ value: '3d', label: 'Words to 3D' }, { value: 'image3d', label: 'Image, then 3D' }, { value: 'poster', label: 'Flat image' }]} />
      <textarea value={prompt} onChange={e => setPrompt(e.target.value)} placeholder="a red vintage bicycle with a wicker basket" aria-label="Describe the prop"
        onKeyDown={e => { e.stopPropagation(); if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) fromWords(); }} disabled={busy !== null} />
      <div className="st-gen-row">
        <button className="st-btn primary" onClick={() => fromWords()} disabled={busy !== null || !prompt.trim()}>{busy !== null ? `Generating ${secs} s` : 'Generate'}</button>
        <button className="st-btn st-mic" aria-pressed={!!rec} title="Hold to talk" disabled={busy !== null}
          onPointerDown={e => { (e.target as Element).setPointerCapture?.(e.pointerId); void startMic(); }} onPointerUp={() => void stopMic()} onPointerCancel={() => void stopMic()}
          onKeyDown={e => { if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) { e.preventDefault(); void startMic(); } }}
          onKeyUp={e => { if (e.key === ' ' || e.key === 'Enter') void stopMic(); }}>{rec ? 'Listening' : 'Hold to talk'}</button>
      </div>
      <div className="st-drop" data-over={over} role="button" tabIndex={0} onClick={() => fileIn.current?.click()}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') fileIn.current?.click(); }}
        onDragOver={e => { e.preventDefault(); e.stopPropagation(); setOver(true); }} onDragLeave={() => setOver(false)}
        onDrop={e => { e.preventDefault(); e.stopPropagation(); setOver(false); void fromFile(e.dataTransfer.files[0]); }}>
        <Ico n="image" s={16} /> Drop a photo to make it 3D
        <input ref={fileIn} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={e => void fromFile(e.target.files?.[0])} />
      </div>
      {(busy !== null || live.length > 0) && (
        <ol className="st-steps" aria-live="polite">
          {live.map((s, i) => (
            <li key={String(s.id)}><span className="n">{i + 1}</span><span>{s.tool.replace(/_/g, ' ')}: {s.result.slice(0, 80)}</span><span className="ms">{(s.ms / 1000).toFixed(1)} s</span></li>
          ))}
          {busy !== null && <li data-state="now"><span className="n">{live.length + 1}</span><span>{mode === '3d' ? 'TRELLIS is building the 3D model' : mode === 'image3d' ? 'Concept image, then the 3D model' : 'Making the image'}</span><span className="ms">{secs} s</span></li>}
          {busy !== null && <li data-state="wait"><span className="n">{live.length + 2}</span><span>Scale to real size and place</span><span /></li>}
        </ol>
      )}
      {done && <ol className="st-steps"><li><span className="n">✓</span><span>Placed "{done.name}" and selected it{done.ms ? ` (${(done.ms / 1000).toFixed(1)} s, ${done.model ?? 'TRELLIS'})` : ''}</span><span /></li></ol>}
      {concept && <img className="st-concept" src={concept} alt="Concept image the 3D model was built from" />}
      {error && <p className="st-note warn" role="alert">{error}</p>}
    </section>
  );
}

// Generation into the set (POST /api/props/generate): words to 3D, words to a concept image to 3D, a photo of an object to
// 3D, or any image as a flat poster, sign or screen. Each lands at real-world size; the steps stream in from agent_step.
import { useState, type FormEvent } from 'react';
import { brief, call, label, sid, stepTime, useAgentSteps, useElapsed } from './api.ts';

type Props = { sessionId: bigint; onAdd?: (url: string, name: string) => void };
type Mode = 'image3d' | 'text3d' | 'photo3d' | 'flat';
type Out = { mode: Mode; name: string; asset: { url: string; bytes: number; cached: boolean }; dims: { length_m: number; width_m: number; height_m: number; source: string };
  conceptUrl?: string; description?: string; object?: { id: string; name: string }; fallback?: string; ms: number };

const GEN_TOOLS = new Set(['concept_image', 'object_read', 'trellis', 'real_scale', 'flat_prop', 'place']);
const MODES: [Mode, string][] = [['image3d', 'Words, concept image, 3D'], ['text3d', 'Words to 3D'], ['photo3d', 'Photo to 3D'], ['flat', 'Flat image (poster, sign, screen)']];

/** A photo as a JPEG data URL, at most 1280 px on the long side. */
async function shrink(file: File): Promise<string> {
  const img = await createImageBitmap(file);
  const k = Math.min(1, 1280 / Math.max(img.width, img.height));
  const c = document.createElement('canvas');
  c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
  c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.9);
}

export function PropGenerator({ sessionId, onAdd }: Props) {
  const [prompt, setPrompt] = useState('');
  const [mode, setMode] = useState<Mode>('image3d');
  const [mount, setMount] = useState('wall');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [since, setSince] = useState(0);
  const [out, setOut] = useState<Out | null>(null);
  const [error, setError] = useState('');
  const secs = useElapsed(busy);
  const steps = useAgentSteps(sessionId).filter(s => since && stepTime(s) >= since - 1500 && GEN_TOOLS.has(s.tool));
  const needsPhoto = mode === 'photo3d', canSend = needsPhoto ? !!file : !!prompt.trim() || (mode === 'flat' && !!file);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!canSend || busy) return;
    setBusy(true); setError(''); setOut(null); setSince(Date.now());
    try {
      const image = file && (needsPhoto || mode === 'flat') ? await shrink(file) : undefined;
      const r = await call<Out>('/api/props/generate', {
        sessionId: sid(sessionId), mode, place: !onAdd, ...(prompt.trim() && { prompt: prompt.trim() }), ...(image && { image }),
        ...(needsPhoto && prompt.trim() && { label: prompt.trim() }), ...(mode === 'flat' && { mount }),
      });
      setOut(r);
      onAdd?.(r.asset.url, r.name);
    } catch (err) { setError((err as Error).message); }
    setBusy(false);
  };

  return (
    <section className="nv nv-card" aria-label="Generate a prop">
      <header><h3>Generate</h3><span className="nv-muted">FLUX, Nemotron, TRELLIS</span></header>
      <form onSubmit={submit} className="nv nv-gen">
        <select className="nv-input" value={mode} onChange={e => setMode(e.target.value as Mode)} aria-label="What to make">
          {MODES.map(([m, t]) => <option key={m} value={m}>{t}</option>)}
        </select>
        <input className="nv-input" value={prompt} onChange={e => setPrompt(e.target.value)} onKeyDown={e => e.stopPropagation()} disabled={busy}
          placeholder={needsPhoto ? 'Which object in the photo (optional): my bike' : mode === 'flat' ? 'A vintage travel poster of the bridge at sunset' : 'A red vintage bicycle with a wicker basket'}
          aria-label="Description" />
        {(needsPhoto || mode === 'flat') && (
          <label className="nv-btn nv-file">
            {file ? file.name : needsPhoto ? 'Choose a photo of the object' : 'Or use a photo'}
            <input type="file" accept="image/png,image/jpeg,image/webp" disabled={busy} onChange={e => setFile(e.target.files?.[0] ?? null)} />
          </label>
        )}
        {mode === 'flat' && (
          <select className="nv-input" value={mount} onChange={e => setMount(e.target.value)} aria-label="Where it goes">
            <option value="wall">On a wall</option><option value="stand">On a stand</option><option value="screen">Screen</option><option value="ground">On the ground</option>
          </select>
        )}
        <button className="nv-btn primary" disabled={busy || !canSend}>Generate and place</button>
      </form>
      {(busy || steps.length > 0) && (
        <ol className="nv-steps" aria-live="polite">
          {steps.map(s => <li key={String(s.id)}><span className="nv-step-tool">{label(s.tool)}</span><span className="nv-step-res">{brief(s.result)}</span><span className="nv-num nv-muted">{s.ms ? `${(s.ms / 1000).toFixed(1)} s` : ''}</span></li>)}
          {busy && <li className="nv-skel" aria-hidden="true" />}
        </ol>
      )}
      {busy && <p className="nv-muted nv-num">{secs} s (TRELLIS takes 10 to 90 s)</p>}
      {out && (
        <div className="nv-ok">
          {out.conceptUrl && <img className="nv-concept" src={out.conceptUrl} alt={`What ${out.name} was built from`} />}
          <p>{out.object ? `Placed "${out.object.name}"` : `Made "${out.name}"`}, {out.dims.height_m} m tall: <a href={out.asset.url} download>GLB</a>
            <span className="nv-muted nv-num"> {Math.round(out.asset.bytes / 1024)} KB, {(out.ms / 1000).toFixed(0)} s</span></p>
          {out.fallback && <p className="nv-warn">{out.fallback}</p>}
        </div>
      )}
      {error && <p className="nv-error" role="alert">{error}</p>}
    </section>
  );
}

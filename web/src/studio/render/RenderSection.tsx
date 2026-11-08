// Render tab: the NVIDIA RenderPanel when web/src/nvidia exports one (it receives getLayers), otherwise the studio's own
// fallback that previews the three layers and POSTs them to /api/render. Either way the layers hold only our objects.
import { useEffect, useState } from 'react';
import type { Layers } from './layers.ts';
import { postRender } from './layers.ts';
import { NvidiaSlot, useNvidiaHas } from '../slots.tsx';
import type { Shot } from '../state/useShotSettings.ts';

interface Props {
  getLayers: () => Promise<Layers>;
  sessionId: bigint; photoId?: bigint;
  shot: Shot; f35: number; time: string;
  sun: { azimuth: number; altitude: number };
  sunMatch: string | null; sunSource: 'photo' | 'plan'; onSunSource: (s: 'photo' | 'plan') => void;
  onSunFix: (azimuth: number, altitude: number) => void; fixNote: string; onFixDone: () => void;
}

export default function RenderSection(p: Props) {
  const has = useNvidiaHas('RenderPanel');
  const [layers, setLayers] = useState<{ l: Layers; urls: string[] } | null>(null);
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState('');
  useEffect(() => () => layers?.urls.forEach(URL.revokeObjectURL), [layers]);
  const settings = JSON.stringify({ ...p.shot, f35: p.f35, time: p.time, sunAzimuth: p.sun.azimuth, sunAltitude: p.sun.altitude });

  const make = async () => {
    setBusy('Rendering layers'); setMsg('');
    try {
      const l = await p.getLayers();
      setLayers({ l, urls: [l.beauty, l.shadow, l.depth, l.mask].map(b => URL.createObjectURL(b)) });
    } catch (e) { setMsg(String((e as Error).message ?? e)); }
    setBusy('');
  };
  const send = async () => {
    if (!layers) return;
    setBusy('Sending to the AI render'); setMsg('');
    try {
      const out = await postRender(layers.l, { sessionId: String(p.sessionId), photoId: String(p.photoId ?? ''), settings });
      setMsg(`Sent. ${out.slice(0, 160)}`);
    } catch (e) { setMsg(String((e as Error).message ?? e)); }
    setBusy('');
  };

  // One click after a sun fix: fresh layers with the new sun, straight to the AI render (the result lands beside the frame).
  const again = async () => {
    setBusy('Rendering again with the new sun'); setMsg('');
    try {
      const l = await p.getLayers();
      await postRender(l, { sessionId: String(p.sessionId), photoId: String(p.photoId ?? ''), settings });
      setMsg('Rendering. The new version appears beside the frame and in Renders.'); p.onFixDone();
    } catch (e) { setMsg(String((e as Error).message ?? e)); }
    setBusy('');
  };

  return (
    <div className="st-render st-sec">
      {p.sunMatch && (
        <p className="st-note" role="status">{p.sunMatch}.{' '}
          <button className="st-link" onClick={() => p.onSunSource(p.sunSource === 'photo' ? 'plan' : 'photo')}>{p.sunSource === 'photo' ? 'Use the planned sun' : 'Match the photo'}</button></p>
      )}
      {p.fixNote && (
        <div className="st-note" role="status">{p.fixNote}{' '}
          <button className="st-btn small" onClick={again} disabled={!!busy || p.photoId === undefined}>Render again</button></div>
      )}
      {has && <NvidiaSlot name="RenderPanel" props={{ sessionId: p.sessionId, photoId: p.photoId, getLayers: p.getLayers, settings: JSON.parse(settings), onSunFix: p.onSunFix }} />}
      <header className="st-sec-head"><span className="st-label">Render layers</span><span className="st-meta">your objects only, no map tiles</span></header>
      <p className="st-note">Beauty, shadows, depth and an object mask from {''}
        the shot camera at the photo's size. {has ? 'The NVIDIA panel above sends them to the AI render.' : 'The crew composites them over your photo for the AI render.'}</p>
      <button className="st-btn small" onClick={make} disabled={!!busy}>{busy || 'Preview the layers'}</button>
      {layers && (
        <>
          <div className="st-layers">
            {['Beauty', 'Shadow', 'Depth', 'Mask'].map((t, i) => (
              <figure key={t}><img src={layers.urls[i]} alt={`${t} layer`} /><figcaption>{t}</figcaption></figure>
            ))}
          </div>
          <p className="st-note mono">{layers.l.width} × {layers.l.height} px · depth {layers.l.depthNearM.toFixed(1)} to {layers.l.depthFarM.toFixed(1)} m · {layers.l.legend.length} objects</p>
          {!has && <button className="st-btn small primary" onClick={send} disabled={!!busy}>Send to the AI render</button>}
        </>
      )}
      {msg && <p className="st-note" role="status">{msg}</p>}
    </div>
  );
}

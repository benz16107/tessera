// The session's shared camera settings (shot_settings row), with local edits that stream to the module about 5 times a second.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTable, useReducer } from 'spacetimedb/react';
import { tables, reducers } from '../../module_bindings/index.ts';
import { bodyById, lensById, pickLens, defaultBody, clampFocal } from '../catalog/index.ts';
import { maxApertureAt } from '../catalog/lenses.ts';
import { shutterForScene } from '../optics.ts';

export interface Shot {
  bodyId: string; lensId: string; focalMm: number; aperture: number; shutterS: number; iso: number;
  whiteBalanceK: number; focusM: number; aspect: string; overlays: string; distortion: boolean;
}

export const ASPECTS = ['3:2', '4:3', '4:5', '1:1', '16:9', '65:24'] as const;
export const OVERLAYS = ['thirds', 'golden', 'spiral', 'center', 'horizon', 'safe'] as const;

/** Defaults from the solve: full frame, the closest real lens to the solved f35, f/4, ISO 100, shutter from the meter. */
export function defaultShot(f35: number, focusM: number, sceneEv: number): Shot {
  const body = defaultBody();
  const { lens, focal } = pickLens(body, f35);
  const aperture = Math.max(4, maxApertureAt(lens, focal));
  return {
    bodyId: body.id, lensId: lens.id, focalMm: focal, aperture, shutterS: shutterForScene(sceneEv, aperture, 100), iso: 100,
    whiteBalanceK: 5500, focusM, aspect: '3:2', overlays: 'thirds,horizon', distortion: false,
  };
}

/** Keep a settings object consistent: lens fits the body, focal inside the lens range, aperture no wider than the lens. */
export function sanitize(s: Shot): Shot {
  const body = bodyById(s.bodyId) ?? defaultBody();
  let lens = lensById(s.lensId);
  if (!lens || (body.fixedLens && lens.id !== body.fixedLens)) lens = lensById(body.fixedLens ?? '') ?? pickLens(body, s.focalMm * body.crop).lens;
  const focalMm = clampFocal(lens, s.focalMm);
  return { ...s, bodyId: body.id, lensId: lens.id, focalMm, aperture: Math.max(s.aperture, maxApertureAt(lens, focalMm)), focusM: Math.max(0.05, s.focusM) };
}

export function useShotSettings(sessionId: bigint, defaults: Shot) {
  const [rows] = useTable(tables.shotSettings.where(r => r.sessionId.eq(sessionId)));
  const write = useReducer(reducers.setShotSettings);
  const row = rows[0];
  const [local, setLocal] = useState<Shot | null>(null);
  const [error, setError] = useState('');
  const pending = useRef<Shot | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const last = useRef(0);

  const remote: Shot = useMemo(() => row ? {
    bodyId: row.bodyId, lensId: row.lensId, focalMm: row.focalMm, aperture: row.aperture, shutterS: row.shutterS, iso: row.iso,
    whiteBalanceK: row.whiteBalanceK, focusM: row.focusM, aspect: row.aspect, overlays: row.overlays, distortion: row.distortion,
  } : defaults, [row, defaults]);

  const flush = useCallback(() => {
    const s = pending.current;
    if (!s) return;
    pending.current = null;
    last.current = performance.now();
    write({ sessionId, ...s, iso: Math.round(s.iso), whiteBalanceK: Math.round(s.whiteBalanceK) })
      .then(() => { if (!pending.current) setLocal(null); setError(''); })
      .catch(e => setError(String(e?.message ?? e)));
  }, [sessionId, write]);

  const set = useCallback((patch: Partial<Shot>) => {
    setLocal(prev => {
      const next = sanitize({ ...(prev ?? remote), ...patch });
      pending.current = next;
      clearTimeout(timer.current);
      const wait = 200 - (performance.now() - last.current); // about 5 writes a second
      if (wait <= 0) queueMicrotask(flush); else timer.current = window.setTimeout(flush, wait);
      return next;
    });
  }, [remote, flush]);

  useEffect(() => () => clearTimeout(timer.current), []);
  return { shot: local ?? remote, set, saved: !!row, error };
}

// Calls to the crew's NVIDIA endpoints (crew/src/http.ts), and the small shared state the panels pass between them.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTable } from 'spacetimedb/react';
import { tables } from '../module_bindings/index.ts';
import type { AgentStep } from '../module_bindings/types.ts';

export type Step = { tool: string; args: string; result: string; ms: number };
export type CommandResult = { reply: string; intent: string; model: string; offline: boolean; steps: Step[]; ms: number; routeMs?: number; heard?: string; audio?: string; data?: unknown };
export type Check = { round: number; pass: boolean; summary: string; objects: { name: string; light: boolean; shadow: boolean; scale: boolean; color: boolean; note: string }[]; model: string; ms: number };
export type SunFix = { azimuth: number; altitude: number; why: string };
export type RenderResult = { url: string; compositeUrl: string; model: string; fallback?: string; prompt: string; label: string; ms: number; jobId?: string; strength: number; checks: Check[]; sunFix?: SunFix; rerendered: boolean };
export type Fix = { title: string; why: string; steps: { tool: string; args: Record<string, unknown> }[] };
export type Critique = { summary: string; strengths: string[]; fixes: Fix[]; model: string };

export async function call<T>(path: string, body?: unknown, init: RequestInit = {}): Promise<T> {
  const r = await fetch(path, body === undefined ? init : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), ...init });
  const text = await r.text();
  let j: any = null;
  try { j = JSON.parse(text); } catch { /* not JSON */ }
  if (!r.ok) throw new Error(j?.error ?? `HTTP ${r.status}: ${text.slice(0, 160)}`);
  return j as T;
}

export const sid = (s: bigint | string | number) => String(s);

/** agent_step rows for the session, oldest first. The crew writes one per model call or tool, so this is Nemotron's live trace. */
export function useAgentSteps(sessionId: bigint): AgentStep[] {
  const [rows] = useTable(tables.agentStep.where(r => r.sessionId.eq(sessionId)));
  return useMemo(() => [...rows].sort((a, b) => Number(a.id - b.id)), [rows]);
}

export const stepTime = (s: AgentStep) => Number(s.at.microsSinceUnixEpoch / 1000n);

/** The last render made in this browser, shared by RenderPanel and ArtDirector. */
let lastRender: RenderResult | null = null;
const listeners = new Set<(r: RenderResult | null) => void>();
export const setLastRender = (r: RenderResult) => { lastRender = r; listeners.forEach(f => f(r)); };
export function useLastRender() {
  const [r, set] = useState(lastRender);
  useEffect(() => { listeners.add(set); return () => { listeners.delete(set); }; }, []);
  return r;
}

/** Elapsed seconds while `on` is true, for long model calls (TRELLIS, FLUX, reasoning). */
export function useElapsed(on: boolean) {
  const [s, setS] = useState(0);
  const t0 = useRef(0);
  useEffect(() => {
    if (!on) return;
    t0.current = Date.now(); setS(0);
    const i = setInterval(() => setS(Math.floor((Date.now() - t0.current) / 1000)), 500);
    return () => clearInterval(i);
  }, [on]);
  return s;
}

export const LABELS: Record<string, string> = {
  command: 'Command', route: 'Lightning routed', safety_check: 'Content safety', bolt_plan: 'Bolt planned offline', add_people: 'Added people',
  add_prop: 'Added a prop', add_lights: 'Added lights', generate_prop: 'TRELLIS prop', move_object: 'Moved', delete_object: 'Removed', set_camera: 'Camera',
  set_time: 'Time of day', search_assets: 'Searched assets', rebuild_from_photo: 'Rebuilt from photo', read_photo: 'Read the photo', light_read: 'Read the light',
  render: 'Rendered', composite: 'Composited', render_check: 'Nemotron checked', physical_check: 'Physics (2nd check)', concept_image: 'Concept image', object_read: 'Read the object',
  trellis: 'TRELLIS 3D', real_scale: 'Real size', flat_prop: 'Image plane', place: 'Placed', add_image: 'Added an image', art_director: 'Art director', call_sheet: 'Call sheet', plan_shoot_day: 'cuOpt route', cuopt_route: 'cuOpt route',
};
export const label = (tool: string) => LABELS[tool] ?? tool.replace(/_/g, ' ');

/** Short result text for a step row: JSON results become a few words. */
export function brief(result: string): string {
  try {
    const j = JSON.parse(result);
    if (j.error) return `error: ${j.error}`;
    if (Array.isArray(j.added)) return `${j.added.length} placed`;
    if (j.added?.name) return `${j.added.name}, ${j.added.at ?? ''}`;
    if (typeof j.added === 'number') return `${j.added} ${j.type ?? ''} lights, ${j.kelvin ?? ''} K`;
    if (j.moved) return `${j.name}: ${j.now}`;
    if (j.deleted) return j.deleted.join(', ');
    if (j.done) return j.done.join('; ');
    if (j.placed) return `${j.placed.length} stand-ins`;
    if (j.results) return j.results.map((r: any) => r.name).join(', ');
    return result.slice(0, 120);
  } catch { return result.slice(0, 160); }
}

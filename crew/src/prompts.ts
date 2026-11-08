// Pure prompt builders and routing rules, shared by the render pass and the set agent; no connection, so the tests import them.
import { MODELS } from './config.ts';
import { parseJson } from './models.ts';
import { lightWords } from './geo.ts';
import type { LightRead } from './vision.ts';

export const INTENTS = ['edit', 'question', 'rebuild', 'call_sheet', 'route', 'critique'] as const;
export type Intent = (typeof INTENTS)[number];
export type Route = { intent: Intent; complex: boolean; reply: string };

/** The router's JSON, normalised; unknown or missing fields fall back to a complex edit (the safe, capable path). */
export function readRoute(raw: string): Route {
  const j = parseJson(raw) ?? {};
  const intent = INTENTS.includes(j.intent) ? j.intent : 'edit';
  return { intent, complex: j.complex !== false, reply: String(j.reply ?? '').slice(0, 600) };
}

/** Which model runs an edit: compositions (several objects, relations, judgment) need Super's reasoning; one-object edits do not. */
export const editTier = (r: Route) => (r.complex ? { model: MODELS.agent, think: true } : { model: MODELS.fast, think: false });

export function lensWords(f35: number, aperture?: number, focusM?: number): string {
  const lens = f35 < 20 ? `${Math.round(f35)} mm ultra-wide lens, strong perspective` : f35 < 35 ? `${Math.round(f35)} mm wide lens` : f35 < 60 ? `${Math.round(f35)} mm normal lens, natural perspective`
    : f35 < 105 ? `${Math.round(f35)} mm short telephoto, gentle compression` : `${Math.round(f35)} mm telephoto, compressed background`;
  const dof = aperture === undefined ? '' : aperture <= 2.8 ? `, f/${aperture}, shallow depth of field${focusM ? ` focused at ${Math.round(focusM * 10) / 10} m` : ''}, background softly blurred`
    : aperture >= 8 ? `, f/${aperture}, deep focus, everything sharp` : `, f/${aperture}, moderate depth of field`;
  return lens + dof;
}

export type PromptIn = { light?: LightRead; f35: number; aperture?: number; focusM?: number; sun?: { az: number; alt: number }; heading?: number; objects: string[]; people: number; text?: string; place?: string };

/** The render prompt: subject, place, light (planned sun first, else the photo's own light read), lens and the user's words. */
export function renderPrompt(o: PromptIn): string {
  const subject = o.objects.length ? `A photograph with ${o.objects.slice(0, 8).join(', ')}` : 'A photograph';
  const light = o.sun && o.heading !== undefined ? lightWords(o.sun.az, o.sun.alt, o.heading)
    : o.light ? `${o.light.time_look} light, sun ${o.light.sun_side}, ${o.light.hardness} light, about ${Math.round(o.light.color_temp_k)} K, ${o.light.sky} sky` : '';
  return [
    `${subject}${o.place ? ` at ${o.place}` : ''}`,
    light && `Lighting: ${light}`,
    `Shot on a ${lensWords(o.f35, o.aperture, o.focusM)}`,
    o.text?.trim(),
    'Photorealistic, every object lit by the same light as the street, matching shadows on the ground, matching colour and film grain, same camera position and framing, no text, no watermark',
  ].filter(Boolean).join('. ');
}

/** FLUX.1-dev takes sizes from 768 to 1344 in steps of 64; pick the one closest to the frame's aspect at about a megapixel. */
export function fluxSize(w: number, h: number): { width: number; height: number } {
  const sizes = Array.from({ length: 10 }, (_, i) => 768 + 64 * i);
  let best = { width: 1024, height: 1024 }, err = Infinity;
  for (const a of sizes) for (const b of sizes) {
    const e = Math.abs(Math.log((a / b) / (w / h))) * 4 + Math.abs(Math.log((a * b) / 1_100_000));
    if (e < err) { err = e; best = { width: a, height: b }; }
  }
  return best;
}


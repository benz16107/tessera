// Calls to hosted models. Keys are read at call time, so dropping a key file in turns a feature on without a restart.
import { MODELS, NVIDIA_BASE, NVIDIA_GENAI_BASE, secret } from './config.ts';

export type ChatMsg = { role: 'system' | 'user' | 'assistant' | 'tool'; content: any; tool_calls?: any[]; tool_call_id?: string };

export async function chat(base: string, key: string | null, body: Record<string, unknown>, timeoutMs = 90_000) {
  const r = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(key ? { authorization: `Bearer ${key}` } : {}) },
    body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs),
  });
  if (!r.ok) throw new Error(`${body.model} HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const j: any = await r.json();
  return j.choices?.[0]?.message ?? {};
}

const userImage = (text: string, image: string) =>
  ({ role: 'user' as const, content: [{ type: 'text', text }, { type: 'image_url', image_url: { url: image } }] });

// Nemotron 3.5 VL thinks by default; for one-shot classification that burns the token budget before it answers.
const NO_THINK = { chat_template_kwargs: { enable_thinking: false } };

let safetyModelMissing = false; // nemotron-3.5-content-safety is listed but 404s on Ben's key (2026-11-07)

/** null = no NVIDIA key, so the check was skipped. */
export async function safetyCheck(image: string, text = ''): Promise<{ safe: boolean; detail: string; model: string } | null> {
  const key = secret('nvidia_key');
  if (!key) return null;
  const ask = 'Should this photo be refused by a service that finds where a photo was taken? Refuse if it is unsafe content, if its subject is ' +
    'a private home or residence, or if it is aimed at a specific person rather than a public place (people in a public scene are fine).' +
    (text ? ` User text: ${text}` : '');
  if (!safetyModelMissing) {
    try {
      const m = await chat(NVIDIA_BASE, key, { model: MODELS.safety, messages: [userImage(ask, image)], max_tokens: 200, temperature: 0 });
      const out = String(m.content ?? '');
      // The safety model answers with JSON like {"User Safety": "unsafe", "Safety Categories": "..."}.
      return { safe: !/\bunsafe\b/i.test(out), detail: out.replace(/\s+/g, ' ').slice(0, 200), model: MODELS.safety };
    } catch (e) {
      if (!/HTTP 404/.test((e as Error).message)) throw e;
      safetyModelMissing = true;
      console.warn(`${MODELS.safety} is not deployed for this key; screening with ${MODELS.agent}`);
    }
  }
  const m = await chat(NVIDIA_BASE, key, {
    model: MODELS.agent, ...NO_THINK, max_tokens: 120, temperature: 0,
    messages: [userImage(`${ask}\nReply with strict JSON only: {"refuse": true|false, "reason": "<short>"}`, image)],
  });
  const out = String(m.content ?? '');
  return { safe: !/"refuse"\s*:\s*true/.test(out), detail: out.replace(/\s+/g, ' ').slice(0, 200), model: MODELS.agent };
}

export const FINE_TUNED = 'fine-tuned lens model';

const r1 = (x: number) => Math.round(x * 10) / 10;
/** The focal range the solver may search: a user's hint first, then the fine-tuned lens model. The base VL read is advisory only. */
export function solverRange(hint: number | undefined, lens: { f35: number; source: string } | null): [number, number] | undefined {
  if (hint !== undefined) return [r1(hint * 0.75), r1(hint * 1.33)];
  if (lens?.source === FINE_TUNED) return [r1(lens.f35 * 0.6), r1(lens.f35 * 1.6)];
  return undefined;
}

const firstNumber = (s: string) => { const m = /"?f35"?\s*:\s*([\d.]+)/.exec(s) ?? /([\d.]+)/.exec(s); return m ? Number(m[1]) : NaN; };

/** 35 mm-equivalent focal estimate from the fine-tuned lens model, else Nemotron VL, else null. */
export async function readLens(image: string): Promise<{ f35: number; source: string } | null> {
  const prompt = 'Estimate the 35 mm-equivalent focal length (diagonal) this photo was taken with. Reply with strict JSON only: {"f35": <number>}';
  let base: string, key: string | null, model: string, source: string;
  if (process.env.LENS_URL) {
    base = process.env.LENS_URL.replace(/\/$/, ''); key = null; model = process.env.LENS_MODEL ?? 'lens'; source = FINE_TUNED;
  } else if ((key = secret('nvidia_key'))) {
    base = NVIDIA_BASE; model = MODELS.lens; source = model;
  } else return null;
  const m = await chat(base, key, { model, ...(source === MODELS.lens && NO_THINK), messages: [userImage(prompt, image)], max_tokens: 60, temperature: 0 });
  const f35 = firstNumber(String(m.content ?? ''));
  if (!(f35 > 5 && f35 < 2000)) throw new Error(`lens reader gave no number: ${String(m.content).slice(0, 80)}`);
  return { f35, source };
}

let nvidiaEditModel: string | null | undefined; // undefined = not probed yet, null = none accepted on this key

async function nvidiaEdit(key: string, jpeg: Buffer, prompt: string): Promise<Buffer | null> {
  const candidates = nvidiaEditModel ? [nvidiaEditModel] : nvidiaEditModel === null ? [] : MODELS.nvidiaEdit;
  for (const model of candidates) {
    const r = await fetch(`${NVIDIA_GENAI_BASE}/${model}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify({ prompt, image: `data:image/jpeg;base64,${jpeg.toString('base64')}`, steps: 30, seed: 0 }),
      signal: AbortSignal.timeout(150_000),
    });
    if (r.status === 404 || r.status === 403 || r.status === 422) { console.warn(`image edit ${model}: HTTP ${r.status}, trying the next`); continue; }
    if (!r.ok) throw new Error(`${model} HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`);
    const j: any = await r.json();
    const b64 = j.artifacts?.[0]?.base64 ?? j.data?.[0]?.b64_json ?? j.image;
    if (!b64) throw new Error(`${model} returned no image`);
    nvidiaEditModel = model;
    return Buffer.from(String(b64).replace(/^data:[^,]+,/, ''), 'base64');
  }
  nvidiaEditModel = null;
  return null;
}

async function openaiEdit(key: string, jpeg: Buffer, prompt: string, size: string): Promise<Buffer> {
  const form = new FormData();
  form.set('model', MODELS.openaiEdit);
  form.set('prompt', prompt);
  form.set('size', size);
  form.set('image', new Blob([jpeg], { type: 'image/jpeg' }), 'photo.jpg');
  const r = await fetch('https://api.openai.com/v1/images/edits', {
    method: 'POST', headers: { authorization: `Bearer ${key}` }, body: form, signal: AbortSignal.timeout(170_000),
  });
  if (!r.ok) throw new Error(`${MODELS.openaiEdit} HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const j: any = await r.json();
  return Buffer.from(j.data[0].b64_json, 'base64');
}

/** Edits the photo. NVIDIA-hosted first, OpenAI as the fallback. Returns the image bytes and which model made it. */
export async function editImage(jpeg: Buffer, prompt: string, size: string): Promise<{ image: Buffer; model: string }> {
  const nv = secret('nvidia_key');
  if (nv) {
    const out = await nvidiaEdit(nv, jpeg, prompt);
    if (out) return { image: out, model: nvidiaEditModel! };
  }
  const oa = secret('openai_key');
  if (!oa) throw new Error('no image edit model: set ~/.config/shotmatch/nvidia_key or openai_key');
  return { image: await openaiEdit(oa, jpeg, prompt, size), model: MODELS.openaiEdit };
}

/** Logs which configured NVIDIA chat model ids the key cannot see. Runs once at start when the key exists. */
export async function verifyNvidiaModels() {
  const key = secret('nvidia_key');
  if (!key) return console.log('NVIDIA key not set yet: safety check, Nemotron lens read and the Nemotron agent are off');
  try {
    const r = await fetch(`${NVIDIA_BASE}/models`, { headers: { authorization: `Bearer ${key}` } });
    const ids = new Set(((await r.json()) as any).data.map((m: any) => m.id));
    for (const id of new Set([MODELS.safety, MODELS.agent, MODELS.lens]))
      console.log(`NVIDIA model ${id}: ${ids.has(id) ? 'listed' : 'NOT LISTED on this key'}`);
  } catch (e) { console.warn(`NVIDIA model list failed: ${(e as Error).message}`); }
}

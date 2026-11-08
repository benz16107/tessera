// Calls to hosted models. Keys are read at call time, so dropping a key file in turns a feature on without a restart.
import { MODELS, NVIDIA_BASE, NVIDIA_GENAI_BASE, VULTR_INFERENCE_BASE, secret } from './config.ts';
import { providerOf, timed } from './ledger.ts';

export type ChatMsg = { role: 'system' | 'user' | 'assistant' | 'tool'; content: any; tool_calls?: any[]; tool_call_id?: string };

export async function chat(base: string, key: string | null, body: Record<string, unknown>, timeoutMs = 90_000, role = '') {
  return timed(String(body.model), providerOf(base), role, async () => {
    const r = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(key ? { authorization: `Bearer ${key}` } : {}) },
      body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs),
    });
    if (!r.ok) throw new Error(`${body.model} HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`);
    const j: any = await r.json();
    return j.choices?.[0]?.message ?? {};
  });
}

/** Nemotron 3.5's reasoning switch: on for planning, off for quick reads (chat_template_kwargs.enable_thinking). */
export const thinking = (on: boolean) => ({ chat_template_kwargs: { enable_thinking: on } });

/** The first JSON object or array in a model reply (models wrap JSON in prose or code fences). */
export function parseJson<T = any>(s: string): T | null {
  const t = s.replace(/```(?:json)?/g, '');
  // Scan from each opening bracket to its balanced close (strings respected); replies sometimes carry an extra "}" at the end.
  for (let i = 0; i < t.length; i++) {
    if (t[i] !== '{' && t[i] !== '[') continue;
    let depth = 0, inStr = false;
    for (let j = i; j < t.length; j++) {
      const c = t[j];
      if (inStr) { if (c === '\\') j++; else if (c === '"') inStr = false; continue; }
      if (c === '"') inStr = true;
      else if (c === '{' || c === '[') depth++;
      else if ((c === '}' || c === ']') && --depth === 0) {
        try { return JSON.parse(t.slice(i, j + 1)); } catch { break; }
      }
    }
  }
  return null;
}

const userImage = (text: string, image: string) =>
  ({ role: 'user' as const, content: [{ type: 'text', text }, { type: 'image_url', image_url: { url: image } }] });

// Nemotron 3.5 VL thinks by default; for one-shot classification that burns the token budget before it answers.
const NO_THINK = { chat_template_kwargs: { enable_thinking: false } };

// nemotron-3.5-content-safety is listed on build.nvidia.com but 404s for our key (2026-11-07); Vultr hosts it. The NVIDIA
// copy is retried every 10 minutes in case it gets deployed.
let nvidiaSafetyRetryAt = 0;

export type Safety = { safe: boolean; detail: string; model: string };
const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim().slice(0, 200);

/** Nemotron Content Safety on one user turn (text, optionally with an image): Vultr first, then build.nvidia.com. Null if neither answers. */
async function contentSafety(content: any, role: string): Promise<Safety | null> {
  // The model answers "User Safety: safe|unsafe" and, when unsafe, a "Safety Categories" line.
  const read = (out: string, model: string) => ({ safe: !/\bunsafe\b/i.test(out), detail: oneLine(out), model });
  const vk = secret('vultr_inference_key');
  if (vk) {
    try { return read(String((await chat(VULTR_INFERENCE_BASE, vk, { model: MODELS.vultrSafety, messages: [{ role: 'user', content }], max_tokens: 60, temperature: 0 }, 20_000, role)).content ?? ''), MODELS.vultrSafety); }
    catch (e) { console.warn(`Vultr safety: ${(e as Error).message}`); }
  }
  const nk = secret('nvidia_key');
  if (nk && Date.now() >= nvidiaSafetyRetryAt) {
    try { return read(String((await chat(NVIDIA_BASE, nk, { model: MODELS.safety, messages: [{ role: 'user', content }], max_tokens: 60, temperature: 0 }, 20_000, role)).content ?? ''), MODELS.safety); }
    catch (e) { if (/HTTP 404/.test((e as Error).message)) nvidiaSafetyRetryAt = Date.now() + 600_000; else console.warn(`NVIDIA safety: ${(e as Error).message}`); }
  }
  return null;
}

const POLICY = 'Should this photo be refused by a service that finds where a photo was taken? Refuse if it is unsafe content, if its subject is ' +
  'a private home or residence, or if it is aimed at a specific person rather than a public place (people in a public scene are fine).';

/** Screens an upload: Nemotron Content Safety for general harm, and Super VL for Tessera's own rule (no homes, no photos aimed at a person), in parallel. null = no key at all. */
export async function safetyCheck(image: string, text = ''): Promise<Safety | null> {
  const key = secret('nvidia_key');
  if (!key && !secret('vultr_inference_key')) return null;
  const policy = key ? chat(NVIDIA_BASE, key, {
    model: MODELS.agent, ...NO_THINK, max_tokens: 120, temperature: 0,
    messages: [userImage(`${POLICY}${text ? ` User text: ${text}` : ''}\nReply with strict JSON only: {"refuse": true|false, "reason": "<short>"}`, image)],
  }, 60_000, 'upload policy check').then(m => { const out = String(m.content ?? ''); return { safe: !/"refuse"\s*:\s*true/.test(out), detail: oneLine(out), model: MODELS.agent }; })
    .catch(e => { console.warn(`policy check: ${e.message}`); return null; }) : Promise.resolve(null);
  const general = contentSafety([{ type: 'text', text: text || 'Find where this photo was taken.' }, { type: 'image_url', image_url: { url: image } }], 'upload safety');
  const got = (await Promise.all([general, policy])).filter((x): x is Safety => !!x);
  if (!got.length) throw new Error('no safety model answered');
  const refused = got.find(g => !g.safe);
  return refused ?? { safe: true, detail: got.map(g => `${g.model}: ${g.detail}`).join(' | ').slice(0, 200), model: got.map(g => g.model).join(' + ') };
}

/** Screens a typed or spoken set command. Fails open only when no safety model answers at all (logged). */
export async function screenText(text: string): Promise<Safety> {
  const r = await contentSafety(text, 'command safety');
  if (r) return r;
  const key = secret('nvidia_key');
  if (!key) return { safe: true, detail: 'no safety model reachable', model: 'none' };
  const m = await chat(NVIDIA_BASE, key, {
    model: MODELS.fast, ...NO_THINK, max_tokens: 60, temperature: 0,
    messages: [{ role: 'user', content: `Is this request to a photo-planning app harmful (stalking, harassment, sexual content involving real people, violence)? Reply JSON {"unsafe": true|false}.\n${text}` }],
  }, 20_000, 'command safety (fallback)');
  return { safe: !/"unsafe"\s*:\s*true/.test(String(m.content)), detail: oneLine(String(m.content)), model: MODELS.fast };
}

export const FINE_TUNED = 'fine-tuned lens model';

const r1 = (x: number) => Math.round(x * 10) / 10;
/** The focal range the solver may search: a user's hint first, then a fine-tuned read of 70 mm or more. Everything else is advisory.
 *  The fine-tune is good at long lenses (67% telephoto recall on held-out landmarks) and weak on normal ones (9% recall for
 *  35 to 70 mm, mostly read as wide: the 52.9 mm hero photo reads 24 mm), and the limit exists for the telephoto line-of-sight
 *  slide, so only long reads narrow the search, with a wide window. */
export const LENS_LIMIT_MIN_F35 = 70;
export const LENS_TRAINING_PROMPT = 'What is the 35 mm-equivalent focal length of this photo? Answer JSON.';
export function solverRange(hint: number | undefined, lens: { f35: number; source: string } | null): [number, number] | undefined {
  if (hint !== undefined) return [r1(hint * 0.75), r1(hint * 1.33)];
  if (lens?.source === FINE_TUNED && lens.f35 >= LENS_LIMIT_MIN_F35) return [r1(lens.f35 * 0.45), r1(lens.f35 * 2.2)];
  return undefined;
}

const firstNumber = (s: string) => { const m = /"?f35"?\s*:\s*([\d.]+)/.exec(s) ?? /([\d.]+)/.exec(s); return m ? Number(m[1]) : NaN; };

/** 35 mm-equivalent focal estimate from the fine-tuned lens model, else Nemotron VL, else null. */
export async function readLens(image: string): Promise<{ f35: number; source: string } | null> {
  // The fine-tune gets its training prompt (lens/labels.py PROMPT): 55.6% bin accuracy with it, 44.0% with the zero-shot prompt
  // (lens/RESULTS.md). LENS_PROMPT in the service overrides it.
  const zeroShot = 'Estimate the 35 mm-equivalent focal length (diagonal) this photo was taken with. Reply with strict JSON only: {"f35": <number>}';
  const prompt = process.env.LENS_URL ? process.env.LENS_PROMPT ?? LENS_TRAINING_PROMPT : zeroShot;
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

// Cosmos Reason2 is listed but 404s for our key (2026-11-07); it is retried every 10 minutes, and Nemotron Nano Omni
// (vision with reasoning) answers meanwhile.
let cosmosRetryAt = 0;
const PHYSICAL = 'Look at this rendered photo of a set. Is it physically plausible: people and objects standing on the ground (not floating or sinking), ' +
  'nothing inside a wall or another object, realistic scale relative to the street and each other, shadows consistent with one light? ' +
  'Answer in one line starting with PLAUSIBLE or IMPLAUSIBLE, then the main reason.';

/** Physical plausibility of a render: Cosmos Reason2 when it answers, else Nemotron Nano Omni. null when no key. */
export async function physicalCheck(image: string): Promise<{ ok: boolean; verdict: string; model: string } | null> {
  const key = secret('nvidia_key');
  if (!key) return null;
  const verdictOf = (m: any, model: string) => {
    const lines = String(m.content ?? '').trim().split('\n').filter(Boolean);
    const verdict = (lines.find(l => /PLAUSIBLE/i.test(l)) ?? lines.pop() ?? '').slice(0, 200);
    return { ok: !/IMPLAUSIBLE/i.test(verdict), verdict, model };
  };
  if (Date.now() >= cosmosRetryAt) {
    try { return verdictOf(await chat(NVIDIA_BASE, key, { model: MODELS.physical, max_tokens: 300, temperature: 0, messages: [userImage(PHYSICAL, image)] }, 60_000, 'physical check'), MODELS.physical); }
    catch (e) { if (!/HTTP 404/.test((e as Error).message)) console.warn(`cosmos: ${(e as Error).message}`); cosmosRetryAt = Date.now() + 600_000; }
  }
  // Reasoning off: with it on, Omni sometimes spent the whole budget thinking and answered nothing (2026-11-07); off it answers in about 1 s.
  return verdictOf(await chat(NVIDIA_BASE, key, { model: MODELS.omni, ...NO_THINK, max_tokens: 300, temperature: 0, messages: [userImage(PHYSICAL, image)] }, 60_000, 'physical check (Cosmos stand-in)'), MODELS.omni);
}

let nvidiaEditModel: string | null | undefined; // undefined = not probed yet, null = none accepted on this key

async function nvidiaEdit(key: string, jpeg: Buffer, prompt: string): Promise<Buffer | null> {
  const candidates = nvidiaEditModel ? [nvidiaEditModel] : nvidiaEditModel === null ? [] : MODELS.nvidiaEdit;
  for (const model of candidates) {
    // flux.1-kontext-dev stopped answering at all on 2026-11-07 (nothing in 150 s), so while probing a timeout counts as "not accepted".
    const r = await fetch(`${NVIDIA_GENAI_BASE}/${model}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify({ prompt, image: `data:image/jpeg;base64,${jpeg.toString('base64')}`, steps: 30, seed: 0 }),
      signal: AbortSignal.timeout(nvidiaEditModel ? 150_000 : 30_000),
    }).catch(e => { console.warn(`image edit ${model}: ${(e as Error).message}, trying the next`); return null; });
    if (!r) continue;
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

/** OpenAI-style multipart /images/edits, which both OpenAI and Vultr Serverless Inference accept. */
async function imagesEdit(base: string, key: string, model: string, jpeg: Buffer, prompt: string, size: string, extra: Record<string, string> = {}): Promise<Buffer> {
  const form = new FormData();
  for (const [k, v] of Object.entries({ model, prompt, size, ...extra })) form.set(k, v);
  form.set('image', new Blob([jpeg], { type: 'image/jpeg' }), 'photo.jpg');
  const r = await fetch(`${base}/images/edits`, {
    method: 'POST', headers: { authorization: `Bearer ${key}` }, body: form, signal: AbortSignal.timeout(170_000),
  });
  if (!r.ok) throw new Error(`${model} HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const j: any = await r.json();
  return Buffer.from(j.data[0].b64_json, 'base64');
}

// 30 steps with guidance 4 placed people more naturally than the 6-step default, for 14 s instead of 4 s.
const VULTR_EDIT = { response_format: 'b64_json', output_format: 'jpeg', steps: '30', guidance_scale: '4' };

/** Edits the photo: NVIDIA-hosted if a free endpoint takes user photos, then Vultr, then OpenAI. Returns the bytes and the model. */
export async function editImage(jpeg: Buffer, prompt: string, size: string): Promise<{ image: Buffer; model: string }> {
  const nv = secret('nvidia_key');
  if (nv) {
    const out = await nvidiaEdit(nv, jpeg, prompt);
    if (out) return { image: out, model: nvidiaEditModel! };
  }
  const vk = secret('vultr_inference_key');
  if (vk) {
    try { return { image: await imagesEdit(VULTR_INFERENCE_BASE, vk, MODELS.vultrEdit, jpeg, prompt, size, VULTR_EDIT), model: MODELS.vultrEdit }; }
    catch (e) { console.warn(`${(e as Error).message}; falling back to ${MODELS.openaiEdit}`); }
  }
  const oa = secret('openai_key');
  if (!oa) throw new Error('no image edit model: set ~/.config/shotmatch/vultr_inference_key or openai_key');
  return { image: await imagesEdit('https://api.openai.com/v1', oa, MODELS.openaiEdit, jpeg, prompt, size), model: MODELS.openaiEdit };
}

/** Logs which configured NVIDIA chat model ids the key cannot see. Runs once at start when the key exists. */
export async function verifyNvidiaModels() {
  const key = secret('nvidia_key');
  if (!key) return console.log('NVIDIA key not set yet: safety check, Nemotron lens read and the Nemotron agent are off');
  try {
    const r = await fetch(`${NVIDIA_BASE}/models`, { headers: { authorization: `Bearer ${key}` } });
    const ids = new Set(((await r.json()) as any).data.map((m: any) => m.id));
    for (const id of new Set([MODELS.safety, MODELS.agent, MODELS.fast, MODELS.edge, MODELS.omni, MODELS.embedText, MODELS.embed, MODELS.physical]))
      console.log(`NVIDIA model ${id}: ${ids.has(id) ? 'listed' : 'NOT LISTED on this key'}`);
  } catch (e) { console.warn(`NVIDIA model list failed: ${(e as Error).message}`); }
}

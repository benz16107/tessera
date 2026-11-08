// Latency of the Nemotron tiers on the same two jobs ShotMatch runs: routing a command (short JSON) and planning a set edit
// with tool calls. Raw fetch, no Spacetime connection. Run on the Vultr VM so Ollama is local:
//   node --import tsx scripts/latency.ts [runs]      (prints a markdown table; writes data/latency.json)
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const N = Number(process.argv[2] ?? 5);
const key = readFileSync(join(homedir(), '.config/shotmatch/nvidia_key'), 'utf8').trim();
const vkey = (() => { try { return readFileSync(join(homedir(), '.config/shotmatch/vultr_inference_key'), 'utf8').trim(); } catch { return ''; } })();
const NV = 'https://integrate.api.nvidia.com/v1/chat/completions', VU = 'https://api.vultrinference.com/v1/chat/completions';
const CMD = 'two friends walking toward camera, a red vintage bike on the left wall, warm string lights';
const ROUTER = [{ role: 'system', content: 'Classify a message to a photo set editor. Reply with strict JSON only: {"intent": "edit|question|rebuild|call_sheet|route|critique", "complex": true|false}.' }, { role: 'user', content: CMD }];
const TOOLS = [
  { type: 'function', function: { name: 'add_people', description: 'Place people', parameters: { type: 'object', properties: { count: { type: 'integer' }, pose: { type: 'string' }, frame_x: { type: 'number' }, distance_m: { type: 'number' }, facing: { type: 'string' } }, required: ['count', 'pose', 'frame_x', 'distance_m'] } } },
  { type: 'function', function: { name: 'add_prop', description: 'Place a library prop: bike, car, bench', parameters: { type: 'object', properties: { asset_id: { type: 'string' }, frame_x: { type: 'number' }, distance_m: { type: 'number' }, color: { type: 'string' } }, required: ['asset_id', 'frame_x', 'distance_m'] } } },
  { type: 'function', function: { name: 'add_lights', description: 'Add lights; string lights are a row of point lights', parameters: { type: 'object', properties: { type: { type: 'string' }, count: { type: 'integer' }, kelvin: { type: 'number' }, frame_x: { type: 'number' }, frame_x_to: { type: 'number' }, distance_m: { type: 'number' } }, required: ['type', 'frame_x', 'distance_m'] } } },
];
const PLAN = [{ role: 'system', content: 'You place objects in a 3D photo set. frame_x -1 is the left edge, 1 the right edge; distance_m is metres from the camera. Call every tool needed in one turn.' }, { role: 'user', content: CMD }];

type Case = { name: string; url: string; auth: string; body: object; job: string };
const think = (on: boolean) => ({ chat_template_kwargs: { enable_thinking: on } });
const cases: Case[] = [
  { job: 'route', name: 'Nemotron 3.5 Lightning 30B-A3B', url: NV, auth: key, body: { model: 'nvidia/nemotron-3.5-lightning-30b-a3b', messages: ROUTER, max_tokens: 80, temperature: 0, ...think(false) } },
  { job: 'route', name: 'Nemotron 3.5 Super VL 120B-A12B, reasoning off', url: NV, auth: key, body: { model: 'nvidia/nemotron-3.5-super-vl-120b-a12b', messages: ROUTER, max_tokens: 80, temperature: 0, ...think(false) } },
  { job: 'route', name: 'Nemotron 3.5 Bolt E4B (hosted)', url: NV, auth: key, body: { model: 'nvidia/nemotron-3.5-bolt-e4b', messages: ROUTER, max_tokens: 80, temperature: 0 } },
  { job: 'route', name: 'Nemotron 3.5 Bolt E4B (Ollama, VM CPU)', url: 'http://127.0.0.1:11434/v1/chat/completions', auth: '', body: { model: 'nemotron-3.5-bolt:e4b', messages: ROUTER, max_tokens: 80, temperature: 0, reasoning_effort: 'none' } },
  { job: 'route', name: 'Nemotron 3.5 Content Safety (Vultr)', url: VU, auth: vkey, body: { model: 'nemotron-3.5-content-safety', messages: [{ role: 'user', content: CMD }], max_tokens: 20, temperature: 0 } },
  { job: 'plan', name: 'Nemotron 3.5 Lightning 30B-A3B', url: NV, auth: key, body: { model: 'nvidia/nemotron-3.5-lightning-30b-a3b', messages: PLAN, tools: TOOLS, max_tokens: 1500, temperature: 0.2, ...think(false) } },
  { job: 'plan', name: 'Nemotron 3.5 Super VL 120B-A12B, reasoning off', url: NV, auth: key, body: { model: 'nvidia/nemotron-3.5-super-vl-120b-a12b', messages: PLAN, tools: TOOLS, max_tokens: 1500, temperature: 0.2, ...think(false) } },
  { job: 'plan', name: 'Nemotron 3.5 Super VL 120B-A12B, reasoning on', url: NV, auth: key, body: { model: 'nvidia/nemotron-3.5-super-vl-120b-a12b', messages: PLAN, tools: TOOLS, max_tokens: 6000, temperature: 0.2, ...think(true) } },
  { job: 'plan', name: 'Nemotron 3.5 Bolt E4B (hosted)', url: NV, auth: key, body: { model: 'nvidia/nemotron-3.5-bolt-e4b', messages: PLAN, tools: TOOLS, max_tokens: 1500, temperature: 0.2 } },
];

const med = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : NaN; };
const out: any[] = [];
for (const c of cases) {
  const ms: number[] = [];
  let calls = 0, err = '';
  for (let i = 0; i < N; i++) {
    const t0 = Date.now();
    try {
      const r = await fetch(c.url, { method: 'POST', headers: { 'content-type': 'application/json', ...(c.auth && { authorization: `Bearer ${c.auth}` }) }, body: JSON.stringify(c.body), signal: AbortSignal.timeout(180_000) });
      const j: any = await r.json();
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      ms.push(Date.now() - t0);
      calls = j.choices?.[0]?.message?.tool_calls?.length ?? calls;
    } catch (e) { err = (e as Error).message; }
  }
  out.push({ job: c.job, model: c.name, runs: ms.length, median_ms: med(ms), min_ms: Math.min(...ms), ...(c.job === 'plan' && { tool_calls: calls }), ...(err && { error: err }) });
  console.error(`${c.job} ${c.name}: ${med(ms)} ms (${ms.join(', ')})${err ? ` error ${err}` : ''}`);
}
mkdirSync('../data', { recursive: true });
writeFileSync('../data/latency.json', JSON.stringify({ at: new Date().toISOString(), runs: N, results: out }, null, 1));
console.log(`| Job | Model | Median | Fastest | Tool calls |\n|---|---|---|---|---|`);
for (const r of out) console.log(`| ${r.job === 'route' ? 'Route a command' : 'Plan the set edit'} | ${r.model} | ${Number.isFinite(r.median_ms) ? `${(r.median_ms / 1000).toFixed(2)} s` : r.error} | ${Number.isFinite(r.min_ms) ? `${(r.min_ms / 1000).toFixed(2)} s` : ''} | ${r.tool_calls ?? ''} |`);

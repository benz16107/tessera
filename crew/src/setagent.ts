// Text to set: "two friends walking toward camera, a red vintage bike on the left wall, warm string lights" becomes
// scene_object edits. Nemotron Content Safety screens the text while Nemotron 3.5 Lightning routes it; simple edits stay on Lightning,
// compositions go to Nemotron 3.5 Super with reasoning on; when the hosted API fails, Nemotron 3.5 Bolt plans the same
// tool calls offline through Ollama on the Vultr VM. Every step is an agent_step row the studio shows live.
import { MODELS, NVIDIA_BASE, OLLAMA_URL, secret } from './config.ts';
import { chat, parseJson, screenText, thinking } from './models.ts';
import { timed } from './ledger.ts';
import { logStep } from './stdb.ts';
import { ASSET_IDS, describeObjects, framingNote, joinAsCrew, sessionObjects, setContext, type SetCtx } from './set.ts';
import { fpxOf, frameOf, groundAt, hfovOf } from './setgeo.ts';
import { SET_TOOLS, runTool, toolSpecs, type StepLog } from './settools.ts';
import { callSheet, sessionLight, readsFor } from './vision.ts';

export { INTENTS, editTier, readRoute, type Intent, type Route } from './prompts.ts';
import { editTier, readRoute, type Intent } from './prompts.ts';

/** Plain words for the shot camera and the set, shared by every prompt. */
export function setBrief(ctx: SetCtx): string {
  const c = ctx.cam, light = sessionLight(ctx.sessionId), read = ctx.photo ? readsFor(ctx.photo.id)?.scene : undefined;
  return [
    `Shot camera: ${Math.round(c.f35)} mm equivalent (horizontal field of view ${Math.round(hfovOf(c))} deg), facing ${Math.round(c.heading)} deg from north, pitch ${c.pitch.toFixed(1)} deg, ${c.z.toFixed(1)} m above the ground. Ground is flat at height 0.`,
    framingNote(c),
    'Positions: frame_x -1 is the left edge of the shot, 0 the centre, 1 the right edge (thirds at -0.33 and 0.33); distance_m is metres from the camera along the ground. frame_y -1 bottom, 1 top.',
    `Objects in the set now:\n${describeObjects(ctx)}`,
    read?.summary ? `The user's photo shows: ${read.summary}` : '',
    light ? `Light in the user's photo: sun ${light.sun_side}, ${light.hardness}, looks like ${light.time_look}, ${Math.round(light.color_temp_k)} K.` : '',
  ].filter(Boolean).join('\n');
}

const SYSTEM = `You are the set builder in Tessera, a virtual photo set. You turn a director's words into tool calls that place people, props and lights in the 3D set, as seen from the shot camera.
Rules: call every tool needed in as few turns as possible (several calls in one turn is good). Use library props (add_prop) when one fits; search_assets when unsure; generate_prop only for things the library lacks. Posters, murals, signs and screens: add_image.
"On the left" means frame_x about -0.6; "left wall" about -0.85; "in the background" means farther (15 to 40 m); "close" 2 to 4 m. People "walking toward camera" use pose walk and facing camera.
String lights: add_lights type point, count 10 to 16, warm 2200 to 2700 K, height 2.6 to 3.2 m, spanning frame_x from one side to the other above the subjects.
Use existing object ids to move or delete. Never invent ids. For weather, sunset colour, tide, permits, scaffolding or shade, call conditions. When done, reply in one or two plain sentences saying what you placed and where. No markdown.`;

const ROUTER = `Classify one message to a virtual photo set editor. Reply with strict JSON only: {"intent": "edit|question|rebuild|call_sheet|route|critique", "complex": true|false, "reply": "..."}.
edit: add, move, remove, recolor or relight objects, people, props, lights, or change the camera, lens or time. complex is true when the edit involves two or more objects, relations between objects, or composition judgment; false for one simple object change.
question: asks something about the set, the light or how to shoot it; put a 1 to 3 sentence answer in reply.
rebuild: copy what is in the user's photo into the set. call_sheet: a shot list or call sheet. route: a walking route between viewpoints. critique: feedback on the composition.`;

export type CommandResult = { reply: string; intent: Intent | 'refused' | 'error'; model: string; offline: boolean; steps: StepLog[]; ms: number; routeMs?: number; data?: unknown };

async function toolLoop(ctx: SetCtx, text: string, model: string, think: boolean, steps: StepLog[]): Promise<string> {
  const key = secret('nvidia_key')!;
  const messages: any[] = [{ role: 'system', content: `${SYSTEM}\n\n${setBrief(ctx)}` }, { role: 'user', content: text }];
  const tools = toolSpecs(Object.keys(SET_TOOLS).filter(n => n !== 'plan_shoot_day'));
  for (let i = 0; i < 6; i++) {
    const m = await chat(NVIDIA_BASE, key, { model, messages, tools, tool_choice: 'auto', temperature: 0.2, max_tokens: think ? 6000 : 1500, ...thinking(think) },
      think ? 150_000 : 45_000, think ? 'text to set (planning, reasoning on)' : 'text to set (quick edit)');
    if (!m.tool_calls?.length) return String(m.content ?? '').trim();
    messages.push({ role: 'assistant', content: m.content ?? '', tool_calls: m.tool_calls });
    for (const tc of m.tool_calls) {
      let args: any = {};
      try { args = JSON.parse(tc.function.arguments || '{}'); } catch { /* bad JSON from the model: run with no args */ }
      messages.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify(await runTool(ctx.sessionId, tc.function.name, args, steps)) });
    }
    // Later turns see the set as it is now.
    messages[0].content = `${SYSTEM}\n\n${setBrief(setContext(ctx.sessionId) ?? ctx)}`;
  }
  return 'Done. That took several rounds of edits; the set shows the result.';
}

/** A short brief for Bolt on CPU (prompt processing runs about 44 tokens a second there): camera, the nearest objects, ids. */
export function boltBrief(ctx: SetCtx): string {
  const c = ctx.cam, near = groundAt(c, c.w / 2, c.h * 0.97)?.dist, full = (1.75 * fpxOf(c)) / (c.h * 0.66);
  const rows = sessionObjects(ctx.sessionId).filter(o => o.kind !== 'camera'), lights = rows.filter(o => o.kind === 'light').length;
  const objs = rows.filter(o => o.kind !== 'light').slice(-12).map(o => { const f = frameOf(c, o); return `id ${o.id} ${o.kind === 'person' ? 'person' : o.assetId.startsWith('/asset/') ? 'generated' : o.assetId} "${o.name}" frame_x ${Number.isFinite(f.frameX) ? f.frameX.toFixed(2) : 'n/a'} ${f.dist.toFixed(0)} m`; });
  return [`Camera: ${Math.round(c.f35)} mm. frame_x -1 left edge, 0 centre, 1 right edge; distance_m from the camera. People full-body between ${Math.max(near ?? 0, full).toFixed(0)} and ${(full * 2.5).toFixed(0)} m.`,
    `Objects: ${objs.length ? objs.join('; ') : 'none'}${lights ? `; plus ${lights} lights` : ''}.`].join('\n');
}

const BOLT_FORMAT = `Reply with strict JSON only: {"reply": "<one sentence>", "steps": [{"tool": "<name>", "args": {...}}]}. Tools:
add_people {count, pose: stand|walk|sit|lean|point|jump|talk|crouch|push, frame_x, distance_m, facing: camera|away|left|right}
add_prop {asset_id: ${ASSET_IDS.join('|')}, frame_x, distance_m, facing, color}
add_lights {type: point|spot|area|sun, count, kelvin, frame_x, frame_x_to, distance_m, height_m}
move_object {id, frame_x, distance_m, right_m, forward_m, facing}
delete_object {id}
set_camera {focal_mm, aperture, pan_deg, tilt_deg}
set_time {when}`;

/** Offline planner: Nemotron 3.5 Bolt writes the tool calls as JSON (no tool-calling round trips); Ollama on the VM first. */
export async function boltPlan(ctx: SetCtx, text: string): Promise<{ plan: { reply: string; steps: { tool: string; args: any }[] }; model: string; provider: string }> {
  const system = `You turn a director's words into edits of a virtual photo set.\n${boltBrief(ctx)}\n${BOLT_FORMAT}`;
  const read = (content: string) => { const j = parseJson(content); if (!j || !Array.isArray(j.steps)) throw new Error(`Bolt gave no plan: ${content.slice(0, 100)}`); return { reply: String(j.reply ?? ''), steps: j.steps.filter((s: any) => s && SET_TOOLS[s.tool]).slice(0, 12) }; };
  try {
    // Ollama's own API: think off (Bolt reasons by default) and JSON output.
    const j: any = await timed(MODELS.edgeOllama, 'Ollama on the Vultr VM (CPU)', 'offline command parser', async () => {
      const r = await fetch(`${OLLAMA_URL}/api/chat`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, signal: AbortSignal.timeout(90_000),
        body: JSON.stringify({ model: MODELS.edgeOllama, think: false, format: 'json', stream: false, keep_alive: '24h', options: { temperature: 0.1, num_ctx: 4096, num_predict: 500 },
          messages: [{ role: 'system', content: system }, { role: 'user', content: text }] }),
      });
      if (!r.ok) throw new Error(`Ollama HTTP ${r.status}: ${(await r.text()).slice(0, 160)}`);
      return r.json();
    });
    return { plan: read(String(j.message?.content ?? '')), model: MODELS.edgeOllama, provider: 'Ollama on the Vultr VM (CPU)' };
  } catch (e) {
    console.warn(`Bolt on Ollama: ${(e as Error).message}; trying hosted Bolt`);
    const key = secret('nvidia_key');
    if (!key) throw e;
    const m = await chat(NVIDIA_BASE, key, { model: MODELS.edge, messages: [{ role: 'system', content: system }, { role: 'user', content: text }], temperature: 0.1, max_tokens: 800 }, 30_000, 'command parser (hosted fallback)');
    return { plan: read(String(m.content ?? '')), model: MODELS.edge, provider: 'NVIDIA API Catalog' };
  }
}

async function offline(ctx: SetCtx, text: string, steps: StepLog[], why: string) {
  const t0 = Date.now(), b = await boltPlan(ctx, text);
  await logStep(ctx.sessionId, 'bolt_plan', `${why}; ${b.model} on ${b.provider}`, JSON.stringify(b.plan.steps).slice(0, 1500), Date.now() - t0);
  for (const s of b.plan.steps) await runTool(ctx.sessionId, s.tool, s.args, steps);
  return { reply: b.plan.reply || `Placed ${b.plan.steps.length} edits.`, model: b.model };
}

/** One set command from the studio, a voice turn or a text thread. */
export async function setCommand(sessionId: bigint, text: string, opts: { offline?: boolean; channel?: string } = {}): Promise<CommandResult> {
  const t0 = Date.now(), steps: StepLog[] = [];
  const clean = text.trim().slice(0, 1000);
  const done = (r: Omit<CommandResult, 'steps' | 'ms' | 'offline'> & { offline?: boolean }): CommandResult => ({ offline: false, ...r, steps, ms: Date.now() - t0 });
  if (!clean) return done({ reply: 'Say what to put in the set.', intent: 'error', model: '' });
  const ctx = setContext(sessionId);
  if (!ctx) return done({ reply: 'This session has no shot camera yet. Solve a photo or add a camera in the studio first.', intent: 'error', model: '' });
  void joinAsCrew(sessionId);
  await logStep(sessionId, 'command', `${opts.channel ?? 'studio'}${opts.offline ? ', offline' : ''}`, clean, 0);

  const key = secret('nvidia_key');
  const routeP = !key || opts.offline ? Promise.resolve(null) : (async () => {
    const r0 = Date.now();
    const m = await chat(NVIDIA_BASE, key, { model: MODELS.fast, ...thinking(false), temperature: 0, max_tokens: 300, messages: [
      { role: 'system', content: ROUTER }, { role: 'user', content: `Set summary: ${sessionObjects(sessionId).length} objects. Message: ${clean}` },
    ] }, 20_000, 'intent router');
    const r = readRoute(String(m.content ?? ''));
    await logStep(sessionId, 'route', MODELS.fast, `${r.intent}${r.intent === 'edit' ? (r.complex ? ', composition: Super with reasoning' : ', simple: Lightning') : ''}`, Date.now() - r0);
    return { r, ms: Date.now() - r0 };
  })().catch(e => { console.warn(`router: ${e.message}`); return null; });
  const s0 = Date.now();
  const [safety, routed] = await Promise.all([screenText(clean), routeP]);
  await logStep(sessionId, 'safety_check', 'command', `${safety.safe ? 'safe' : 'refused'} (${safety.model}): ${safety.detail}`, Date.now() - s0);
  if (!safety.safe) return done({ reply: "I can't help with that one. Tessera plans photos of public places.", intent: 'refused', model: safety.model });

  if (!routed) {
    try { const o = await offline(ctx, clean, steps, key ? 'hosted router failed' : 'no NVIDIA key'); return done({ reply: o.reply, intent: 'edit', model: o.model, offline: true }); }
    catch (e) { return done({ reply: `The offline parser failed too: ${(e as Error).message}`, intent: 'error', model: MODELS.edge, offline: true }); }
  }
  const { r, ms: routeMs } = routed;
  try {
    if (r.intent === 'question') {
      // Weather, light, tide, permit or shade questions get the live conditions (geo layers) as context.
      const cond = /weather|rain|cloud|sky|colou?r|sunset|sunrise|golden|tide|wind|haze|smog|alert|permit|scaffold|closure|shade|shadow|moon|crowd/i.test(clean)
        ? await runTool(sessionId, 'conditions', {}, steps).catch(() => null) : null;
      const m = await chat(NVIDIA_BASE, key!, { model: MODELS.fast, ...thinking(false), temperature: 0.3, max_tokens: 300, messages: [
        { role: 'system', content: `You answer questions about a virtual photo set in one to three plain sentences.\n${setBrief(ctx)}${cond?.text ? `\nLive conditions: ${cond.text}` : ''}` }, { role: 'user', content: clean }] }, 20_000, 'quick reply');
      return done({ reply: String(m.content ?? r.reply).trim(), intent: 'question', model: MODELS.fast, routeMs });
    }
    if (r.intent === 'rebuild') {
      const out = await runTool(sessionId, 'rebuild_from_photo', { replace: /replace|again|redo/i.test(clean) }, steps);
      return done({ reply: out.error ?? `Rebuilt from your photo: ${out.placed?.length ?? 0} stand-ins placed.`, intent: 'rebuild', model: MODELS.agent, routeMs, data: out });
    }
    if (r.intent === 'route') {
      const out = await runTool(sessionId, 'plan_shoot_day', {}, steps);
      return done({ reply: out.error ?? `Route by NVIDIA cuOpt: ${out.stops?.map((s: any) => `${s.order}. ${s.name} ${s.arrive}`).join('; ')}`, intent: 'route', model: 'NVIDIA cuOpt', routeMs, data: out });
    }
    if (r.intent === 'call_sheet') {
      const t1 = Date.now(), sheet = await callSheet(sessionId);
      await logStep(sessionId, 'call_sheet', MODELS.agent, `${sheet.title ?? 'Call sheet'}: ${(sheet.shots ?? []).map((s: any) => `${s.n}. ${s.name} ${s.time} ${s.lens_mm} mm`).join('; ')}`.slice(0, 3800), Date.now() - t1);
      return done({ reply: `Call sheet ready: ${sheet.shots.length} shots, call ${sheet.call_time ?? 'see sheet'}.`, intent: 'call_sheet', model: MODELS.agent, routeMs, data: sheet });
    }
    if (r.intent === 'critique') return done({ reply: 'Render the shot first, then press Art director for a critique with one-click fixes.', intent: 'critique', model: MODELS.fast, routeMs });
    const tier = editTier(r);
    const reply = await toolLoop(ctx, clean, tier.model, tier.think, steps);
    return done({ reply, intent: 'edit', model: tier.model, routeMs });
  } catch (e) {
    // The hosted model failed or timed out mid-command: Bolt finishes it offline.
    console.warn(`set command on hosted Nemotron failed: ${(e as Error).message}`);
    if (r.intent !== 'edit') return done({ reply: `That failed: ${(e as Error).message.slice(0, 200)}`, intent: 'error', model: '', routeMs });
    try { const o = await offline(ctx, clean, steps, `hosted model failed: ${(e as Error).message.slice(0, 80)}`); return done({ reply: o.reply, intent: 'edit', model: o.model, offline: true, routeMs }); }
    catch (e2) { return done({ reply: `That failed: ${(e2 as Error).message.slice(0, 200)}`, intent: 'error', model: MODELS.edge, offline: true, routeMs }); }
  }
}

// Creates (or updates) the ElevenLabs "ShotMatch guide" phone agent, its three webhook tools and the post-call webhook.
// Safe to re-run: ids live in data/voice.json. Secrets: elevenlabs_key, voice_tool_secret; writes elevenlabs_webhook_secret.
// Usage: npx tsx scripts/setup-voice.ts [public-base-url]
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { REPO, SECRETS, PUBLIC_URL, secret } from '../src/config.ts';

const base = (process.argv[2] ?? PUBLIC_URL).replace(/\/$/, '');
const key = secret('elevenlabs_key'), toolSecret = secret('voice_tool_secret');
if (!key || !toolSecret) throw new Error('need ~/.config/shotmatch/elevenlabs_key and voice_tool_secret');
const statePath = join(REPO, 'data/voice.json');
let st: Record<string, any> = {};
try { st = JSON.parse(readFileSync(statePath, 'utf8')); } catch { /* first run */ }
const save = () => { mkdirSync(join(REPO, 'data'), { recursive: true }); writeFileSync(statePath, JSON.stringify(st, null, 1)); };

async function el(method: string, path: string, body?: object) {
  const r = await fetch(`https://api.elevenlabs.io${path}`, { method, headers: { 'xi-api-key': key!, 'content-type': 'application/json' }, body: body && JSON.stringify(body) });
  const text = await r.text();
  if (!r.ok) throw new Error(`${method} ${path}: HTTP ${r.status} ${text.slice(0, 400)}`);
  return text ? JSON.parse(text) : {};
}

const me = await fetch('https://api.elevenlabs.io/v1/user', { headers: { 'xi-api-key': key } });
console.log(`key check: GET /v1/user -> ${me.status}`);
if (!me.ok) process.exit(1);

// The tool secret is stored as an ElevenLabs workspace secret, so it never appears in the agent config.
if (!st.secretId) {
  st.secretId = (await el('POST', '/v1/convai/secrets', { type: 'new', name: 'shotmatch_voice_tool_secret', value: toolSecret })).secret_id;
  save();
}

const caller = { type: 'string', dynamic_variable: 'system__caller_id' };
const TOOLS = {
  get_plan: { description: "Get the caller's shot plan: where the mark is, which way to face and how far to zoom. Call it at the start of the call.", props: {} },
  scout_status: { description: "Where the caller's scout phone is relative to the mark, with walking directions. Use it while guiding them.", props: {} },
  distance_to_mark: { description: 'Distance and direction from the caller to the mark, from their scout page GPS.', props: {} },
} as const;

st.tools ??= {};
for (const [name, t] of Object.entries(TOOLS)) {
  const tool_config = {
    type: 'webhook', name, description: t.description, response_timeout_secs: 10,
    api_schema: {
      url: `${base}/api/tools/${name}`, method: 'POST',
      request_headers: { 'x-shotmatch-tool-secret': { secret_id: st.secretId } },
      request_body_schema: { type: 'object', description: 'Caller info', properties: { caller, ...t.props }, required: ['caller'] },
    },
  };
  if (st.tools[name]) await el('PATCH', `/v1/convai/tools/${st.tools[name]}`, { tool_config });
  else { st.tools[name] = (await el('POST', '/v1/convai/tools', { tool_config })).id; save(); }
}

if (!st.webhookId) {
  const w = await el('POST', '/v1/workspace/webhooks', { settings: { auth_type: 'hmac', name: 'ShotMatch post-call', webhook_url: `${base}/api/voice/ended` } });
  st.webhookId = w.webhook_id; save();
  if (w.webhook_secret) writeFileSync(join(SECRETS, 'elevenlabs_webhook_secret'), w.webhook_secret, { mode: 0o600 });
  console.log(`post-call webhook ${w.webhook_id}${w.webhook_secret ? ', secret saved to elevenlabs_webhook_secret' : ', NO secret returned'}`);
}

const prompt = `You are the ShotMatch guide on a phone call. The caller texted ShotMatch a photo of a place and wants to stand where the photographer stood.
Start by calling get_plan and tell them the plan in one or two short sentences. Then guide them to the mark: call scout_status or distance_to_mark whenever they ask "where now" or say they moved, and give one instruction at a time ("walk about 20 metres north", "turn left a little").
When they reach the mark, tell them which way to face and how far to zoom on their phone. Keep every answer under 25 words. Never read out coordinates. If a tool says there is no plan, ask them to text the photo first.
Say you will text them the final framing after the call.`;

const agentBody = {
  name: 'ShotMatch guide',
  conversation_config: {
    agent: { first_message: 'Hi, this is ShotMatch. I can walk you to the spot for your shot. One second while I pull up your plan.', language: 'en', prompt: { prompt, tool_ids: Object.values(st.tools) } },
  },
  platform_settings: { workspace_overrides: { webhooks: { post_call_webhook_id: st.webhookId, events: ['transcript'] } } },
};
if (st.agentId) await el('PATCH', `/v1/convai/agents/${st.agentId}`, agentBody);
else { st.agentId = (await el('POST', '/v1/convai/agents/create', agentBody)).agent_id; save(); }
console.log(`agent "ShotMatch guide": ${st.agentId}`);
console.log(`tools: ${JSON.stringify(st.tools)}`);

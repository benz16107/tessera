// Creates (or updates) the ElevenLabs "Tessera guide" phone agent, its three webhook tools and the post-call webhook.
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
const TOOLS: Record<string, { description: string; props: Record<string, object>; timeout?: number }> = {
  get_plan: { description: "Get the caller's set: where the mark is, which way to face and the lens. Call it at the start of the call.", props: {} },
  guide_me: { description: "One turn-by-turn instruction from the caller's live phone position and compass to the mark (for example 'Turn left 26 degrees, then walk 12 m north'). Call it every time they say they moved or ask where now.", props: {} },
  edit_set: {
    description: "Change the virtual set by voice: move, add or remove people and props, change the light or time of day, the lens. Pass the caller's words. Planners see the change live.",
    props: { instruction: { type: 'string', description: "What to change, in the caller's words, for example 'move the bike to the left' or 'make it sunset'" } }, timeout: 25,
  },
  scout_status: { description: 'Same as guide_me: walking directions from the scout phone to the mark.', props: {} },
  distance_to_mark: { description: 'Same as guide_me: distance and direction to the mark.', props: {} },
};

st.tools ??= {};
for (const [name, t] of Object.entries(TOOLS)) {
  const tool_config = {
    type: 'webhook', name, description: t.description, response_timeout_secs: t.timeout ?? 10,
    api_schema: {
      url: `${base}/api/tools/${name}`, method: 'POST',
      request_headers: { 'x-shotmatch-tool-secret': { secret_id: st.secretId } },
      request_body_schema: { type: 'object', description: 'Caller info', properties: { caller, ...t.props }, required: ['caller', ...Object.keys(t.props)] },
    },
  };
  if (st.tools[name]) await el('PATCH', `/v1/convai/tools/${st.tools[name]}`, { tool_config });
  else { st.tools[name] = (await el('POST', '/v1/convai/tools', { tool_config })).id; save(); }
}

if (!st.webhookId) {
  const w = await el('POST', '/v1/workspace/webhooks', { settings: { auth_type: 'hmac', name: 'Tessera post-call', webhook_url: `${base}/api/voice/ended` } });
  st.webhookId = w.webhook_id; save();
  if (w.webhook_secret) writeFileSync(join(SECRETS, 'elevenlabs_webhook_secret'), w.webhook_secret, { mode: 0o600 });
  console.log(`post-call webhook ${w.webhook_id}${w.webhook_secret ? ', secret saved to elevenlabs_webhook_secret' : ', NO secret returned'}`);
}

const prompt = `You are the Tessera set on a phone call. The caller is part of a photo shoot planned in a shared virtual set, and they may be walking to the spot right now.
Start by calling get_plan and say the plan in one short sentence. To guide them, call guide_me and read its one instruction; call it again every time they say they moved or ask "where now", until it says they are on the mark.
When they ask to change the shot ("move the bike to the left", "make it sunset", "add two friends"), call edit_set with their words and tell them it is done; everyone planning sees it live.
Keep every answer under 25 words. Never read out coordinates. If a tool says there is no set, ask them to text Tessera a photo first or to say the six-letter set code.
Before hanging up, say you will text them the final framing.`;

const agentBody = {
  name: 'Tessera guide',
  conversation_config: {
    agent: { first_message: 'Hi, this is Tessera. I can walk you to your mark or change the shot by voice. One second while I pull up your set.', language: 'en', prompt: { prompt, tool_ids: Object.values(st.tools) } },
  },
  platform_settings: { workspace_overrides: { webhooks: { post_call_webhook_id: st.webhookId, events: ['transcript'] } } },
};
if (st.agentId) await el('PATCH', `/v1/convai/agents/${st.agentId}`, agentBody);
else { st.agentId = (await el('POST', '/v1/convai/agents/create', agentBody)).agent_id; save(); }
console.log(`agent "Tessera guide": ${st.agentId}`);
console.log(`tools: ${JSON.stringify(st.tools)}`);

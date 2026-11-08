import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const PHOTOS_DIR = join(REPO, 'data/photos');
export const PREVIEWS_DIR = join(REPO, 'data/previews');
export const ASSETS_DIR = join(REPO, 'data/assets'); // TRELLIS GLBs, served at /asset/<id>.glb
export const VISION_DIR = join(REPO, 'data/vision'); // Nemotron's scene and light reads, one JSON per photo
export const SPOTS_DIR = join(REPO, 'spots');
export const WEB_DIST = join(REPO, 'web/dist');
export const SECRETS = join(homedir(), '.config/shotmatch');

export const PORT = Number(process.env.PORT ?? 8790);
export const SPACETIME_HOST = process.env.SPACETIME_HOST ?? 'wss://maincloud.spacetimedb.com';
export const DB_NAME = process.env.DB_NAME ?? 'shotmatch';
// The Vultr VM in Dallas (ops/deploy-vultr.sh deploys it).
export const PUBLIC_URL = process.env.PUBLIC_URL ?? 'https://app.tesseraphoto.com';
export const SOLVER_URL = process.env.SOLVER_URL ?? 'http://127.0.0.1:8791';
export const MAX_UPLOAD = 25 * 1024 * 1024;

// Every hosted model id lives here, so a renamed endpoint is a one-line change.
export const NVIDIA_BASE = 'https://integrate.api.nvidia.com/v1';
export const NVIDIA_GENAI_BASE = 'https://ai.api.nvidia.com/v1/genai';
export const VULTR_INFERENCE_BASE = 'https://api.vultrinference.com/v1';
// Ollama on the Vultr VM (CPU), for the offline Bolt command parser. ops/ollama.sh installs it as a user service.
export const OLLAMA_URL = process.env.OLLAMA_URL ?? 'http://127.0.0.1:11434';
export const NVIDIA_RETRIEVAL_BASE = 'https://ai.api.nvidia.com/v1/retrieval';
// NVIDIA Riva speech on NVCF: one gRPC host, the model picked by function id (listed with GET api.nvcf.nvidia.com/v2/nvcf/functions, 2026-11-07).
export const RIVA_GRPC = 'grpc.nvcf.nvidia.com:443';
export const RIVA = {
  asr: { name: 'nvidia/parakeet-ctc-1.1b-asr', functionId: '1598d209-5e27-4d3c-8079-4751568b1081' },
  tts: { name: 'nvidia/magpie-tts-multilingual', functionId: '877104f7-e885-42b9-8de8-f6e4c6303969', voice: 'Magpie-Multilingual.EN-US.Aria' },
};
export const MODELS = {
  // Vultr Serverless Inference hosts this one (0.7 s); the same id is listed on build.nvidia.com but 404s for our key.
  safety: 'nvidia/nemotron-3.5-content-safety',
  vultrSafety: 'nemotron-3.5-content-safety',
  agent: 'nvidia/nemotron-3.5-super-vl-120b-a12b',
  lens: 'nvidia/nemotron-3.5-super-vl-120b-a12b',
  // Latency tier: routing, quick replies, single-object edits, voice turns.
  fast: 'nvidia/nemotron-3.5-lightning-30b-a3b',
  // Edge tier: the offline command parser. Ollama tag on the VM first, the hosted id if Ollama is not answering.
  edge: 'nvidia/nemotron-3.5-bolt-e4b',
  edgeOllama: 'nemotron-3.5-bolt:e4b',
  // Vision + audio + reasoning; hosted on Vultr and on build.nvidia.com. Voice notes and the second opinion.
  omni: 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning',
  vultrOmni: 'nemotron-3-nano-omni-30b-a3b-reasoning',
  // Text embeddings for the asset library, session messages and spots; the VL reranker reorders the top hits.
  embedText: 'nvidia/nemotron-3.5-embed-1b',
  rerank: 'nvidia/llama-nemotron-rerank-vl-1b-v2',
  trellis: 'microsoft/trellis',
  flux: 'black-forest-labs/flux.1-dev',
  // Tried in order; the first endpoint the key accepts is kept for the life of the process. Checked 2026-11-07: the
  // free kontext-dev and klein endpoints answer 422 "Expected: example_id" for user images, qwen-image-edit is 404, so OpenAI runs.
  // flux.1-kontext-dev is left out: it stopped answering at all (150 s timeouts) and cost every first render 30 s of probing.
  nvidiaEdit: ['black-forest-labs/flux.2-klein-4b', 'qwen/qwen-image-edit'],
  // Vultr Serverless Inference (OpenAI-compatible, VULTR_INFERENCE_BASE). Edits keep the photo's geometry far better than
  // gpt-image-2 and take 4 to 14 s instead of about 170 s (compared 2026-11-07). Evaluation-only license, fine for the hackathon.
  vultrEdit: 'qwen-image-2.1',
  openaiEdit: 'gpt-image-2',
  // Voice notes that arrive through Photon (Telegram, iMessage), converted to mp3 with ffmpeg first.
  transcribe: 'whisper-large-v3-turbo',
  // Text and images share one vector space (checked 2026-11-07: both return 2048-d vectors).
  embed: 'nvidia/llama-nemotron-embed-vl-1b-v2',
  // Listed on the key but 404 "function not found" on 2026-11-07; physical_check skips itself while it 404s.
  physical: 'nvidia/cosmos-reason2-8b',
};

/** Reads a secret at use time; null when the file does not exist yet. Never log the value. */
export function secret(name: string): string | null {
  try { return readFileSync(join(SECRETS, name), 'utf8').trim() || null; } catch { return null; }
}

export type Spot = { id: string; name: string; lat: number; lon: number; radius_m: number; cameras: number; model_version: string };

export function loadSpots(): Spot[] {
  if (!existsSync(SPOTS_DIR)) return [];
  const out: Spot[] = [];
  for (const d of readdirSync(SPOTS_DIR)) {
    const f = join(SPOTS_DIR, d, 'spot.json');
    if (!existsSync(f)) continue;
    try { out.push(JSON.parse(readFileSync(f, 'utf8'))); } catch (e) { console.warn(`bad ${f}: ${(e as Error).message}`); }
  }
  return out;
}

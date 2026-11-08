// What each NVIDIA model does in ShotMatch, for the studio's "Powered by NVIDIA" list (with live latency from the ledger)
// and docs/NVIDIA.md. Ids come from config.ts so this list cannot drift from what the code calls.
import { MODELS, RIVA } from './config.ts';

export type CatalogEntry = { model: string; family: string; where: string; does: string[] };

export const NVIDIA_CATALOG: CatalogEntry[] = [
  { model: MODELS.agent, family: 'Nemotron 3.5 Super VL 120B-A12B', where: 'NVIDIA API Catalog',
    does: ['plans set compositions with reasoning on and calls set tools', 'reads the photo: people, vehicles and props with boxes', 'reads the light', 'art director critique with one-click fixes', 'call sheet', 'runs the iMessage and Telegram agent', 'upload policy check'] },
  { model: MODELS.fast, family: 'Nemotron 3.5 Lightning 30B-A3B', where: 'NVIDIA API Catalog',
    does: ['routes every command (which tool, or escalate to Super)', 'quick replies and single-object edits', 'voice turns'] },
  { model: MODELS.edgeOllama, family: 'Nemotron 3.5 Bolt E4B', where: 'Ollama on the Vultr VM CPU, hosted copy as backup',
    does: ['offline command parser when the hosted API is slow or down'] },
  { model: MODELS.omni, family: 'Nemotron 3 Nano Omni 30B-A3B (reasoning)', where: 'Vultr Serverless Inference and NVIDIA API Catalog',
    does: ['physical plausibility check of renders while Cosmos Reason2 is unavailable', 'speech to text fallback for voice notes'] },
  { model: MODELS.vultrSafety, family: 'Nemotron 3.5 Content Safety', where: 'Vultr Serverless Inference (primary), NVIDIA API Catalog (retried)',
    does: ['screens every upload and every typed or spoken command'] },
  { model: MODELS.embedText, family: 'Nemotron 3.5 Embed 1B', where: 'NVIDIA API Catalog', does: ['semantic search over the asset library, session messages and spots'] },
  { model: MODELS.rerank, family: 'Llama Nemotron Rerank VL 1B v2', where: 'NVIDIA API Catalog', does: ['reranks the top search hits'] },
  { model: MODELS.embed, family: 'Llama Nemotron Embed VL 1B v2', where: 'NVIDIA API Catalog', does: ['similar-shot search over each spot\'s photos (image and text in one space)'] },
  { model: MODELS.trellis, family: 'TRELLIS', where: 'NVIDIA API Catalog', does: ['text or photo to a 3D prop (GLB) placed in the set'] },
  { model: MODELS.flux, family: 'FLUX.1-dev (depth and canny)', where: 'NVIDIA API Catalog', does: ['AI render pass over the user\'s photo, conditioned on the composite'] },
  { model: RIVA.asr.name, family: 'Parakeet CTC 1.1B (Riva ASR)', where: 'NVIDIA NVCF over gRPC', does: ['hold-to-talk set commands', 'Telegram and iMessage voice notes'] },
  { model: RIVA.tts.name, family: 'Magpie TTS Multilingual (Riva TTS)', where: 'NVIDIA NVCF over gRPC', does: ['spoken replies in the studio voice mode'] },
  { model: MODELS.physical, family: 'Cosmos Reason2 8B', where: 'NVIDIA API Catalog (404 for our key, retried every 10 min)', does: ['physical plausibility of renders, when it answers'] },
  { model: 'nvidia/cuopt', family: 'cuOpt', where: 'NVIDIA API Catalog', does: ['shoot-day walking route with light time windows'] },
];

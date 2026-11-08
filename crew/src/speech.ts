// NVIDIA Riva on NVCF: Parakeet speech to text and Magpie text to speech, over gRPC with the API key and a function id
// in the call metadata. Protos are NVIDIA's (MIT) from github.com/nvidia-riva/common, vendored in crew/proto.
import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import { execFile } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { MODELS, REPO, RIVA, RIVA_GRPC, VULTR_INFERENCE_BASE, secret } from './config.ts';
import { record, timed } from './ledger.ts';
import { chat } from './models.ts';

const PROTO = join(REPO, 'crew/proto');
let pkg: any;
const riva = () => (pkg ??= grpc.loadPackageDefinition(protoLoader.loadSync(
  [join(PROTO, 'riva/proto/riva_asr.proto'), join(PROTO, 'riva/proto/riva_tts.proto')],
  { keepCase: true, longs: String, enums: String, defaults: true, oneofs: true, includeDirs: [PROTO] },
)) as any).nvidia.riva;

const clients = new Map<string, any>();
function client(kind: 'asr' | 'tts') {
  if (!clients.has(kind)) {
    const Svc = kind === 'asr' ? riva().asr.RivaSpeechRecognition : riva().tts.RivaSpeechSynthesis;
    clients.set(kind, new Svc(RIVA_GRPC, grpc.credentials.createSsl()));
  }
  return clients.get(kind);
}

function meta(functionId: string) {
  const key = secret('nvidia_key');
  if (!key) throw new Error('NVIDIA key not set');
  const m = new grpc.Metadata();
  m.set('authorization', `Bearer ${key}`);
  m.set('function-id', functionId);
  return m;
}

const call = <T>(c: any, method: string, req: object, md: grpc.Metadata, ms: number) =>
  new Promise<T>((res, rej) => c[method](req, md, { deadline: Date.now() + ms }, (e: Error | null, r: T) => (e ? rej(e) : res(r))));

/** Any audio (browser webm/opus, Telegram ogg, iMessage caf, wav) to 16 kHz mono 16-bit PCM, through ffmpeg. */
export async function toPcm16k(audio: Buffer): Promise<Buffer> {
  const dir = mkdtempSync(join(tmpdir(), 'asr-'));
  try {
    writeFileSync(join(dir, 'in'), audio);
    await promisify(execFile)('ffmpeg', ['-loglevel', 'error', '-i', join(dir, 'in'), '-ac', '1', '-ar', '16000', '-f', 's16le', join(dir, 'out.pcm')], { timeout: 60_000 });
    return readFileSync(join(dir, 'out.pcm'));
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

/** Parakeet (Riva ASR) on 16 kHz mono PCM. */
export async function parakeet(pcm: Buffer): Promise<string> {
  return timed(RIVA.asr.name, 'NVIDIA NVCF (Riva gRPC)', 'speech to text', async () => {
    const r: any = await call(client('asr'), 'Recognize', {
      config: { encoding: 'LINEAR_PCM', sample_rate_hertz: 16000, language_code: 'en-US', max_alternatives: 1, enable_automatic_punctuation: true, audio_channel_count: 1 },
      audio: pcm,
    }, meta(RIVA.asr.functionId), 30_000);
    return (r.results ?? []).map((x: any) => x.alternatives?.[0]?.transcript ?? '').join(' ').replace(/\s+/g, ' ').trim();
  });
}

const wav = (pcm: Buffer, rate: number) => {
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + pcm.length, 4); h.write('WAVE', 8); h.write('fmt ', 12);
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate * 2, 28);
  h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
};

/** Magpie (Riva TTS): text to a WAV file's bytes. */
export async function magpie(text: string, voice = RIVA.tts.voice): Promise<Buffer> {
  const rate = 44100;
  return timed(RIVA.tts.name, 'NVIDIA NVCF (Riva gRPC)', 'text to speech', async () => {
    const r: any = await call(client('tts'), 'Synthesize', { text: text.slice(0, 1500), language_code: 'en-US', encoding: 'LINEAR_PCM', sample_rate_hz: rate, voice_name: voice },
      meta(RIVA.tts.functionId), 30_000);
    return wav(Buffer.from(r.audio), rate);
  });
}

/** Speech to text for every channel: Parakeet first, then Nemotron Nano Omni (audio in) on Vultr, then Whisper on Vultr. */
export async function transcribe(audio: Buffer): Promise<{ text: string; model: string } | null> {
  let pcm: Buffer;
  try { pcm = await toPcm16k(audio); } catch (e) { throw new Error(`could not decode the audio: ${(e as Error).message}`); }
  if (secret('nvidia_key')) {
    try { return { text: await parakeet(pcm), model: RIVA.asr.name }; }
    catch (e) { console.warn(`parakeet: ${(e as Error).message}`); }
  }
  const vk = secret('vultr_inference_key');
  if (!vk) return null;
  const file = wav(pcm, 16000);
  try {
    const m = await chat(VULTR_INFERENCE_BASE, vk, {
      model: MODELS.vultrOmni, max_tokens: 400, temperature: 0, ...{ chat_template_kwargs: { enable_thinking: false } },
      messages: [{ role: 'user', content: [{ type: 'text', text: 'Transcribe this audio exactly. Reply with the words only.' }, { type: 'input_audio', input_audio: { data: file.toString('base64'), format: 'wav' } }] }],
    }, 60_000, 'speech to text (Parakeet fallback)');
    const text = String(m.content ?? '').trim();
    if (text) return { text, model: MODELS.vultrOmni };
  } catch (e) { console.warn(`omni transcribe: ${(e as Error).message}`); }
  const form = new FormData();
  form.set('model', MODELS.transcribe);
  form.set('file', new Blob([file], { type: 'audio/wav' }), 'voice.wav');
  const t0 = Date.now();
  const r = await fetch(`${VULTR_INFERENCE_BASE}/audio/transcriptions`, { method: 'POST', headers: { authorization: `Bearer ${vk}` }, body: form, signal: AbortSignal.timeout(120_000) });
  record(MODELS.transcribe, 'Vultr Serverless Inference', 'speech to text (last fallback)', Date.now() - t0, r.ok);
  if (!r.ok) throw new Error(`${MODELS.transcribe} HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return { text: String(((await r.json()) as any).text ?? '').trim(), model: MODELS.transcribe };
}

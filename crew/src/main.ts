import { longRequests, startHttp, stopAccepting } from './http.ts';
import { conn, ready, syncSpots } from './stdb.ts';
import { runningJobs, startJobLoops, stopClaiming } from './jobs.ts';
import { verifyNvidiaModels } from './models.ts';
import { startPhoton, startOutbox } from './photon.ts';
import { buildAll } from './similar.ts';
import { warmAssets } from './search.ts';

startHttp();
void verifyNvidiaModels();
await ready;
console.log('crew registered and subscribed; taking jobs');
startJobLoops();
startPhoton();
startOutbox();
void buildAll(); // embeds new spot photos once; cached in data/embeddings
void warmAssets(); // the studio asset library for semantic search
setInterval(() => void syncSpots(), 60_000); // picks up spot.json files the solver writes after start

// Graceful restart (a deploy): refuse new long requests and job claims, let renders, generations and jobs already running
// finish for up to 150 s (systemd waits 180 s, TimeoutStopSec in ops/shotmatch-crew.service), then leave.
let stopping = false;
const stop = async () => {
  if (stopping) return;
  stopping = true;
  stopAccepting(); stopClaiming();
  const end = Date.now() + 150_000;
  for (let n; (n = longRequests() + runningJobs()) > 0 && Date.now() < end;) {
    console.log(`draining: waiting for ${n} in-flight jobs`);
    await new Promise(r => setTimeout(r, 2000));
  }
  console.log('drained; exiting');
  conn.disconnect();
  process.exit(0);
};
process.on('SIGTERM', () => void stop());
process.on('SIGINT', () => void stop());

import { startHttp } from './http.ts';
import { conn, ready, syncSpots } from './stdb.ts';
import { startJobLoops } from './jobs.ts';
import { verifyNvidiaModels } from './models.ts';

startHttp();
void verifyNvidiaModels();
await ready;
console.log('crew registered and subscribed; taking jobs');
startJobLoops();
setInterval(() => void syncSpots(), 60_000); // picks up spot.json files the solver writes after start

const stop = () => { conn.disconnect(); process.exit(0); };
process.on('SIGTERM', stop);
process.on('SIGINT', stop);

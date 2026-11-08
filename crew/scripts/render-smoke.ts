// Live check of the render pass on a session: node --import tsx scripts/render-smoke.ts <sessionId> <photoId> <beauty.png> [shadow.png] [text]
import { readFileSync } from 'node:fs';
import { ready } from '../src/stdb.ts';
import { render } from '../src/render.ts';
const [sid, pid, beauty, shadow, text] = process.argv.slice(2);
await ready;
const r = await render({ sessionId: BigInt(sid), photoId: BigInt(pid), beauty: readFileSync(beauty), shadow: shadow ? readFileSync(shadow) : undefined, text, sun: { az: 280, alt: 20 } });
console.log(JSON.stringify(r, null, 1).slice(0, 3000));
setTimeout(() => process.exit(0), 12_000);

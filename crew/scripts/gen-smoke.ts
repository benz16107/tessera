// Live check of generation modes: npx tsx scripts/gen-smoke.ts <sessionId> <photoUrl> [modes...]
import { ready } from '../src/stdb.ts';
import { generateProp } from '../src/gen.ts';
const [sid, photoUrl, ...modes] = process.argv.slice(2);
await ready;
const runs: Record<string, Parameters<typeof generateProp>[0]> = {
  text3d: { mode: 'text3d', prompt: 'a red vintage bicycle with a wicker basket', frame_x: -0.85, distance_m: 7, facing: 'right' },
  image3d: { mode: 'image3d', prompt: 'a wooden cafe chalkboard sign', frame_x: 0.6, distance_m: 8 },
  photo3d: { mode: 'photo3d', imageUrl: photoUrl, label: 'silver car', frame_x: 0.3, distance_m: 12 },
  flat_words: { mode: 'flat', prompt: 'a vintage travel poster of the Brooklyn Bridge at sunset', mount: 'wall', frame_x: -0.9, distance_m: 9, facing: 'right' },
  flat_photo: { mode: 'flat', imageUrl: photoUrl, mount: 'stand', frame_x: 0.5, distance_m: 9, height_m: 1.2 },
};
for (const m of modes.length ? modes : Object.keys(runs)) {
  const t0 = Date.now();
  try { const g = await generateProp({ sessionId: BigInt(sid), ...runs[m] }); console.log(`\n${m} ok in ${Date.now() - t0} ms: ${g.mode} ${g.name} ${g.asset.url} ${g.dims.length_m}x${g.dims.width_m}x${g.dims.height_m} m (${g.dims.source}) obj ${g.object?.id}${g.fallback ? `\n  fallback: ${g.fallback}` : ''}\n  ${g.ran.join('\n  ')}`); }
  catch (e) { console.log(`\n${m} FAILED in ${Date.now() - t0} ms: ${(e as Error).message}`); }
}
setTimeout(() => process.exit(0), 11_000);

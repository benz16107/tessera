import { test } from 'node:test';
import assert from 'node:assert/strict';
import { editTier, fluxSize, lensWords, readRoute, renderPrompt } from '../src/prompts.ts';
import { parseJson } from '../src/models.ts';
import { MODELS } from '../src/config.ts';
import { glbJson, planeGlb } from '../src/glb.ts';

test('router replies are normalised; unknown output falls back to a complex edit', () => {
  assert.deepEqual(readRoute('{"intent": "question", "complex": false, "reply": "53 mm"}'), { intent: 'question', complex: false, reply: '53 mm' });
  assert.deepEqual(readRoute('Sure! ```json\n{"intent":"edit","complex":false}\n```'), { intent: 'edit', complex: false, reply: '' });
  assert.deepEqual(readRoute('no idea'), { intent: 'edit', complex: true, reply: '' });
  assert.equal(readRoute('{"intent":"dance"}').intent, 'edit');
});

test('compositions go to Super with reasoning, single edits to Lightning', () => {
  assert.deepEqual(editTier({ intent: 'edit', complex: true, reply: '' }), { model: MODELS.agent, think: true });
  assert.deepEqual(editTier({ intent: 'edit', complex: false, reply: '' }), { model: MODELS.fast, think: false });
});

test('parseJson takes the first balanced object, even with a stray brace after it', () => {
  assert.deepEqual(parseJson('{"items": [{"box": [1, 2, 3, 4]}]}}'), { items: [{ box: [1, 2, 3, 4] }] });
  assert.deepEqual(parseJson('here: {"a": "x}y"} trailing'), { a: 'x}y' });
  assert.equal(parseJson('nothing'), null);
});

test('render prompt carries the light read, the lens and the user words', () => {
  const p = renderPrompt({ light: { sun_side: 'left', hardness: 'hard', time_look: 'golden hour', color_temp_k: 3200, sky: 'clear', summary: '' }, f35: 85, aperture: 1.8, focusM: 4,
    objects: ['2 people', 'red bike'], people: 2, text: 'light rain', place: 'DUMBO' });
  assert.match(p, /2 people, red bike at DUMBO/);
  assert.match(p, /golden hour light, sun left, hard light, about 3200 K/);
  assert.match(p, /85 mm short telephoto.*f\/1.8, shallow depth of field focused at 4 m/);
  assert.match(p, /light rain/);
  // A planned sun wins over the photo's own light.
  assert.match(renderPrompt({ f35: 24, objects: [], people: 0, sun: { az: 180, alt: 5 }, heading: 0 }), /warm low golden sun behind the camera, front-lit scene/);
  assert.match(lensWords(16), /ultra-wide/);
});

test('FLUX sizes keep the aspect within the allowed range', () => {
  const s = fluxSize(1280, 1707);
  assert.ok(s.width >= 768 && s.width <= 1344 && s.height >= 768 && s.height <= 1344 && s.width % 64 === 0 && s.height % 64 === 0);
  assert.ok(s.height > s.width, `${s.width}x${s.height}`);
});

test('the image plane GLB is valid and real-sized', () => {
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xd9, 1]); // contents are opaque to the container
  const glb = planeGlb(jpeg, 'image/jpeg', 0.6, 0.9);
  assert.equal(glb.toString('ascii', 0, 4), 'glTF');
  assert.equal(glb.readUInt32LE(8), glb.length);
  const j = glbJson(glb);
  assert.deepEqual(j.accessors[0].max, [0.3, 0.9, 0]);
  assert.equal(j.images[0].mimeType, 'image/jpeg');
  assert.equal(j.buffers[0].byteLength % 4, 0);
  assert.equal(j.bufferViews[4].byteLength, jpeg.length);
});

test('placeholders become real people and props, with pose, height, clothes and light', async () => {
  const { placeholderPrompt, whenWords } = await import('../src/prompts.ts');
  const when = whenWords(new Date('2026-11-08T22:30:00Z'), 5, 'cloudy');
  assert.equal(when, 'cloudy late autumn golden hour');
  const p = placeholderPrompt({ id: '7', kind: 'person', name: 'Person 1', asset: 'mannequin', pose: 'walk', heightM: 1.72, frameX: -0.5, dist: 8.4, facing: 'the camera' }, when, 'soft overcast light');
  assert.equal(p, 'the grey mannequin on the left, about 8 m from the camera becomes a real person, walking, about 1.72 m tall, casual clothes that suit a cloudy late autumn golden hour, lit by soft overcast light, facing the camera');
  assert.match(placeholderPrompt({ id: '9', kind: 'model', name: 'Bicycle', asset: 'bike', frameX: 0.6, dist: 5, facing: 'left' }, when, 'x'), /stand-in bicycle on the right.*becomes a real bicycle/);
});

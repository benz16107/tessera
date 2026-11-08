import { test } from 'node:test';
import assert from 'node:assert/strict';
import { io } from 'socket.io-client';
import { fakePhoton } from './fake-photon.ts';
import { lensOptions, plan, sheetMarkdown, channelOf, platformOf, type SetEvent } from '../src/channels/format.ts';
import { correction, guide, awayWords, alertLead, conditionsLine } from '../src/channels/marks.ts';
import { parseCommand, cleanAddress } from '../src/channels/commands.ts';
import { labelIn, treeText } from '../src/channels/tree.ts';
import { tryOrder, people } from '../src/channels/order.ts';
import { parseCallEnded, parseInbound, stripQuoted } from '../src/photon-event.ts';

const render: SetEvent = { kind: 'render', label: 'v3', caption: 'Red bike on the left, golden hour', image: '/r/v3.jpg', imageUrl: 'https://x/preview/v3.jpg',
  lenses: [{ f35: 35, path: '/r/v3.jpg' }, { f35: 50, path: '/r/v3_50.jpg' }, { f35: 85, path: '/r/v3_85.jpg' }], planUrl: 'https://x/p/ABC', title: 'Bridge at dusk', progressKey: 'job:7' };

test('fan-out: each channel gets the render in its own form', () => {
  assert.deepEqual(plan(render, 'imessage').map(o => o.op), ['image', 'text']);
  assert.match((plan(render, 'imessage')[1] as any).text, /^v3: Red bike.*Reply to this to change it\.$/);
  const tg = plan(render, 'telegram');
  assert.equal(tg[0].op, 'album');
  assert.deepEqual((tg[0] as any).paths, ['/r/v3.jpg', '/r/v3_50.jpg', '/r/v3_85.jpg']);
  assert.match((tg[0] as any).caption, /Lens options: 35 mm, 50 mm, 85 mm/);
  assert.equal(tg[1].op, 'progress');
  assert.equal(plan({ ...render, progressKey: undefined } as SetEvent, 'telegram').length, 1, 'no progress line without a progress message');
  const sms = plan(render, 'sms');
  assert.equal(sms.length, 1);
  assert.match((sms[0] as any).text, /^ShotMatch v3: .* See it: https:\/\/x\/preview\/v3\.jpg$/);
  const email = plan(render, 'email');
  assert.equal((email[0] as any).format, 'markdown');
  assert.match((email[0] as any).subject, /^ShotMatch v3: Bridge at dusk$/);
  assert.equal(email[1].op, 'image');
  assert.deepEqual(plan(render, 'voice'), []);
  // progress only on Telegram
  assert.deepEqual(plan({ kind: 'progress', key: 'k', text: 'Rendering' }, 'imessage'), []);
  assert.equal(plan({ kind: 'progress', key: 'k', text: 'Rendering' }, 'telegram')[0].op, 'progress');
});

test('fan-out: email gets the whole call sheet, chat channels a summary and the link', () => {
  const sheet = { title: 'DUMBO at dusk', call_time: '4:30 PM', shots: [{ n: 1, name: 'Hero', time: '4:52 PM', lens_mm: 50, aperture: 2.8, framing: 'bridge centred' }, { n: 2, name: 'Wide', time: '5:05 PM', lens_mm: 24 }], windows: { golden: '4:52 PM to 5:20 PM' } };
  const ev: SetEvent = { kind: 'callsheet', sheet, sheetUrl: 'https://x/sheet/ABC', planUrl: 'https://x/p/ABC' };
  const md = (plan(ev, 'email')[0] as any).text as string;
  assert.match(md, /^# DUMBO at dusk/);
  assert.match(md, /\| 1 \| 4:52 PM \| Hero \| 50 mm f\/2\.8 \| bridge centred \|/);
  assert.match(md, /\[Open the designed call sheet\]\(https:\/\/x\/sheet\/ABC\)/);
  assert.ok(!/<[a-z]/i.test(md), 'Photon refuses HTML inside Markdown');
  assert.match((plan(ev, 'sms')[0] as any).text, /^DUMBO at dusk, call 4:30 PM\n1\. 4:52 PM Hero, 50 mm\n2\. 5:05 PM Wide, 24 mm\nFull call sheet: https:\/\/x\/sheet\/ABC$/);
  assert.equal(sheetMarkdown(sheet, 'u', 'p').split('\n').filter(l => l.startsWith('| ')).length, 3);
});

test('lens options are exact crops: never wider than the render', () => {
  assert.deepEqual(lensOptions(24), [24, 50, 85]);
  assert.deepEqual(lensOptions(35), [35, 50, 85]);
  assert.deepEqual(lensOptions(70), [70, 85]);
  assert.deepEqual(lensOptions(100), [100]);
  assert.equal(platformOf('whatsapp'), 'whatsapp_business');
  assert.equal(channelOf('whatsapp_business'), 'whatsapp');
  assert.equal(channelOf('fax'), null);
});

test('check-in: the correction names distance, side, facing and the move', () => {
  const north = { x: 0, y: 0, heading: 0 };
  const c = correction(north, { x: 3.2, y: 0, heading: -14 });
  assert.equal(c.verdict, 'close');
  assert.equal(Math.round(c.distanceM * 10) / 10, 3.2);
  assert.equal(c.words, "You're 3.2 m east of the mark and facing 14 degrees too far left. 4 paces to your left, then turn right 14 degrees.");
  // In front of a mark that faces east: step back.
  assert.match(correction({ x: 0, y: 0, heading: 90 }, { x: 1.6, y: 0, heading: 90 }).words, /east of the mark\. Step back two paces\.$/);
  assert.equal(correction(north, { x: 0.4, y: -0.6, heading: 3 }).words, "You're on the mark. Take the shot.");
  assert.equal(correction(north, { x: 30, y: 40, heading: 120 }).verdict, 'off the mark');
});

test('voice guidance: one instruction from the live phone pose', () => {
  assert.equal(guide({ x: 0, y: 0, heading: 26 }, { x: 0, y: 12, heading: 90 }), 'Turn left 26 degrees, then walk 12 m north.');
  assert.equal(guide({ x: 0, y: 0, heading: 3 }, { x: 0, y: 12, heading: 90 }), 'Walk 12 m north, straight ahead.');
  assert.equal(guide({ x: 0, y: 0, heading: 180 }, { x: 0, y: 40, heading: 90 }), 'Turn around, then walk 40 m north.');
  assert.equal(guide({ x: 0, y: 11, heading: 60 }, { x: 0, y: 12, heading: 90 }), "You're on the mark. Turn right 30 degrees.");
  assert.equal(guide({ x: 0, y: 0 }, { x: 0, y: 12, heading: 90 }), 'Walk 12 m north.');
});

test('alerts: distance on foot and the lead line', () => {
  assert.equal(awayWords(300), "You're 300 m away, about 4 min on foot.");
  assert.equal(awayWords(1234), "You're 1.2 km away, about 15 min on foot.");
  assert.equal(awayWords(9), "You're at the mark.");
  assert.equal(awayWords(undefined), '');
  const now = new Date('2026-11-08T22:32:00Z');
  assert.equal(alertLead('golden hour', new Date('2026-11-08T22:52:00Z'), now), 'Golden hour starts in 20 min.');
  const c = { colorChance: { score: 37, label: 'fair', why: '11% mid and high cloud to catch the light, no low cloud in the way' },
    blockers: [{ label: 'Sidewalk shed', m: 41 }, { label: 'Supported scaffold', m: 41 }, { label: 'Street closure', m: 120 }] };
  assert.equal(conditionsLine(c), 'Fair colour chance (37/100): 11% mid and high cloud to catch the light, no low cloud in the way. Watch for sidewalk shed 41 m away and supported scaffold 41 m away.');
  assert.equal(conditionsLine({ colorChance: null, blockers: [] }), '');
  assert.equal(conditionsLine(null), '');
});

test('alerts: a late message skips an iMessage line the person never texted, and falls back by channel', () => {
  const maya = [{ channel: 'imessage' as const, address: '+14695550101', name: 'Maya' }, { channel: 'email' as const, address: 'm@x.io', name: 'Maya' }, { channel: 'telegram' as const, address: '@maya', name: 'Maya' }];
  assert.deepEqual(tryOrder(maya, () => true).map(l => l.channel), ['imessage', 'telegram', 'email']);
  assert.deepEqual(tryOrder(maya, () => false).map(l => l.channel), ['telegram', 'email']);
  const groups = people([...maya, { channel: 'sms' as const, address: '+1', name: 'Jun', participantId: 5n }, { channel: 'email' as const, address: 'j@x', name: 'J', participantId: 5n }]);
  assert.deepEqual(groups.map(g => g.length), [3, 2]);
});

test('text commands: invites by channel, versions, join, call sheet, remind', () => {
  assert.deepEqual(parseCommand('add Maya +1 555 010 0199 on WhatsApp'), { kind: 'invite', name: 'Maya', channel: 'whatsapp', address: '+15550100199' });
  assert.deepEqual(parseCommand('invite Priya by email priya@x.io'), { kind: 'invite', name: 'Priya', channel: 'email', address: 'priya@x.io' });
  assert.deepEqual(parseCommand('add @theo_k on telegram'), { kind: 'invite', name: 'A friend', channel: 'telegram', address: '@theo_k' });
  assert.deepEqual(parseCommand('add Sam Lee 469-555-0101'), { kind: 'invite', name: 'Sam Lee', channel: 'sms', address: '+14695550101' });
  assert.equal(parseCommand('add two people')?.kind, undefined, 'set edits are not invites');
  assert.equal(parseCommand('add a red bike on the left'), null);
  assert.deepEqual(parseCommand('versions'), { kind: 'versions' });
  assert.deepEqual(parseCommand('/start ab3dkq'), { kind: 'join', code: 'AB3DKQ' });
  assert.deepEqual(parseCommand('send the call sheet'), { kind: 'callsheet' });
  assert.deepEqual(parseCommand('remind me before golden hour'), { kind: 'remind' });
  assert.equal(cleanAddress('email', 'not an email'), null);
  assert.equal(cleanAddress('sms', '12'), null);
  assert.equal(cleanAddress('imessage', 'Ana@iCloud.com'), 'ana@icloud.com');
});

test('version tree: thread versions in order, forks under their parent', () => {
  const at = (m: number) => new Date(Date.UTC(2026, 10, 8, 22, m));
  const vs = [
    { id: 1n, label: 'v1', channel: 'imessage', externalMessageId: 'a', imageUrl: '/p/1.jpg', createdAt: at(0) },
    { id: 2n, parentVersionId: 1n, label: 'v2', channel: 'studio', externalMessageId: 'b', imageUrl: '/p/2.jpg', createdAt: at(5) },
    { id: 3n, parentVersionId: 1n, label: 'v1.1', channel: 'telegram', externalMessageId: 'c', imageUrl: '', createdAt: at(9) },
    { id: 4n, parentVersionId: 3n, label: 'v1.1.1', channel: 'sms', externalMessageId: 'd', imageUrl: '/p/4.jpg', createdAt: at(12) },
  ];
  assert.equal(treeText(vs, 'UTC'), ['v1 · 10:00 PM · imessage', '  └ v1.1 · 10:09 PM · telegram (no image yet)', '    └ v1.1.1 · 10:12 PM · sms', 'v2 · 10:05 PM · studio', "Reply to any version's message to fork from it."].join('\n'));
  assert.equal(labelIn('v3.1 (from v3): moved the bike'), 'v3.1');
  assert.equal(labelIn('ShotMatch v2: x'), 'v2');
  assert.equal(labelIn('version 2'), null);
});

test('photon events: every messaging platform, voice notes, email quotes, call.ended', () => {
  const ev = (o: any) => ({ id: 'e', type: 'message.received', data: { object: { id: 'm', status: 'received', sentBy: { handle: 'jun@x.io', kind: 'human', metadata: { displayName: 'Jun' } }, receivedBy: { id: 'pho_usr_a' }, space: { id: 's', kind: 'direct' }, ...o } } });
  const email = parseInbound(ev({ platform: 'email', content: { type: 'text', format: 'plain', text: 'make it 85mm\n\nOn Sat, Nov 7, 2026 ShotMatch wrote:\n> v2: ...' } }));
  assert.equal(email?.text, 'make it 85mm');
  assert.equal(email?.displayName, 'Jun');
  assert.equal(parseInbound(ev({ platform: 'whatsapp_business', content: { type: 'voice', attachmentId: 'pho_att_v' } }))?.attachmentIds[0], 'pho_att_v');
  assert.equal(parseInbound(ev({ platform: 'voice', content: { type: 'text', format: 'plain', text: 'x' } })), null);
  const tg = parseInbound(ev({ platform: 'telegram', content: { type: 'attachment', attachmentId: 'pho_att_p', metadata: { caption: { format: 'plain', text: 'Manhattan Bridge from DUMBO' } } } }));
  assert.deepEqual([tg?.text, tg?.attachmentIds], ['Manhattan Bridge from DUMBO', ['pho_att_p']], 'Telegram captions arrive on the attachment');
  assert.deepEqual(parseCallEnded({ id: 'e', type: 'call.ended', data: { object: { id: 'c1', direction: 'inbound', caller: { handle: '+14695550101' } } } }), { callId: 'c1', caller: '+14695550101' });
  assert.equal(parseCallEnded({ type: 'call.ended', data: { object: { direction: 'outbound', caller: { handle: 'x' } } } }), null);
  assert.equal(stripQuoted('ok\n-- Original Message\nold'), 'ok');
});

test('Photon client against the fake server: outbound-first spaces, uploads, albums, edits and refusals', async () => {
  const f = await fakePhoton({ agents: { sms: '+18885550100', email: 'set@mail.shotmatch.test', imessage: '+18885550111' } });
  Object.assign(process.env, { PHOTON_API_URL: f.url, PHOTON_API_KEY: f.key, PHOTON_PROJECT_ID: f.project });
  try {
    const api = await import('../src/channels/api.ts');
    const agent = await api.userId('sms', '+18885550100'), jun = await api.userId('sms', '+14695550199');
    assert.equal(f.users.get('sms:+18885550100')?.kind, 'agent');
    const sp = await api.spaceId('sms', [agent, jun]);
    assert.equal(await api.spaceId('sms', [jun, agent]), sp, 'same participants converge on one space');
    const id = await api.sendMessage({ spaceId: sp, senderId: agent, content: { type: 'text', format: 'plain', text: 'v1 is ready' } }, 'k1');
    assert.equal(await api.sendMessage({ spaceId: sp, senderId: agent, content: { type: 'text', format: 'plain', text: 'v1 is ready' } }, 'k1'), id, 'same idempotency key, same message');
    assert.equal(f.sentTo(sp).length, 1);
    const att = await api.uploadAttachment(Buffer.from('JPEGDATA'), 'image/jpeg', 'v1.jpg');
    const a2 = await api.uploadAttachment(Buffer.from('JPEG2'), 'image/jpeg', 'v1_85.jpg');
    await api.sendMessage({ spaceId: sp, senderId: agent, content: { type: 'group', parts: [{ type: 'attachment', attachmentId: att }, { type: 'attachment', attachmentId: a2 }] } });
    assert.equal(f.sent.at(-1)!.content.parts.length, 2);
    await api.editText(sp, agent, id, 'v1 is ready (edited)');
    assert.equal(f.sent.at(-1)!.content.type, 'message.update');
    assert.equal(f.sent.at(-1)!.parentMessageId, id);
    // A shared iMessage line can't start a conversation; a refused late send is a refusal the caller falls back from.
    const ia = await api.userId('imessage', '+18885550111'), im = await api.userId('imessage', '+14695550101');
    await assert.rejects(api.spaceId('imessage', [ia, im]), (e: any) => e.code === 'SHARED_LINE_INBOUND_REQUIRED' && api.isRefusal(e));
    f.refuse.set(sp, 'SPACE_NOT_SENDABLE');
    await assert.rejects(api.sendMessage({ spaceId: sp, senderId: agent, content: { type: 'text', format: 'plain', text: 'late' } }), (e: any) => api.isRefusal(e));
    f.refuse.delete(sp);
    await assert.rejects(api.sendMessage({ spaceId: sp, senderId: agent, content: { type: 'text', format: 'markdown', text: '<b>x</b>' } }), (e: any) => e.status === 422 && e.code === 'INVALID_CONTENT');
    const dl = await api.download(att);
    assert.equal(dl.type, 'image/jpeg');
    assert.equal((await dl.bytes()).toString(), 'JPEGDATA');
  } finally { await f.close(); delete process.env.PHOTON_API_URL; }
});

test('event stream: subscribe acks, live delivery, and replay after the saved cursor', async () => {
  const f = await fakePhoton();
  const first = f.inbound({ platform: 'telegram', handle: 'maya', text: '/start AB3DKQ' });
  const connect = (startSeq: number) => new Promise<{ evs: any[]; close: () => void; sock: any }>((resolve, reject) => {
    const evs: any[] = [];
    const s = io(f.url, { path: `/v1/projects/${f.project}/events/ws`, addTrailingSlash: false, transports: ['websocket'], extraHeaders: { Authorization: `Bearer ${f.key}` } });
    s.on('delivery', (ev, meta) => evs.push({ ev, meta }));
    s.on('connect', async () => { const ack = await s.emitWithAck('subscribe', { startSeq }); ack.ok ? resolve({ evs, close: () => s.close(), sock: s }) : reject(new Error('refused')); });
    s.on('connect_error', reject);
  });
  const a = await connect(0);
  f.inbound({ platform: 'sms', handle: '+14695550101', text: 'versions' });
  await new Promise(r => setTimeout(r, 200));
  assert.deepEqual(a.evs.map(e => e.meta.seq), [1, 2]);
  assert.equal(parseInbound(a.evs[0].ev)?.messageId, first.messageId);
  a.close();
  const b = await connect(1);
  await new Promise(r => setTimeout(r, 200));
  assert.deepEqual(b.evs.map(e => parseInbound(e.ev)?.text), ['versions'], 'resumes after the cursor');
  b.close();
  const bad = io(f.url, { path: `/v1/projects/${f.project}/events/ws`, addTrailingSlash: false, transports: ['websocket'], extraHeaders: { Authorization: 'Bearer wrong' }, reconnection: false });
  await new Promise<void>(r => bad.on('connect_error', () => r()));
  bad.close();
  await f.close();
});

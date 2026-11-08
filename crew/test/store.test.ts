import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store, normHandle } from '../src/store.ts';

test('handles normalise phone formats and emails', () => {
  assert.equal(normHandle('(469) 555-0101'), '+14695550101');
  assert.equal(normHandle('+1 469 555 0101'), '+14695550101');
  assert.equal(normHandle('tel:+14695550101'), '+14695550101');
  assert.equal(normHandle('Ben@Example.com'), 'ben@example.com');
});

test('one thread maps to one session, survives a restart, and a caller finds their latest thread', () => {
  const path = join(mkdtempSync(join(tmpdir(), 'crew-')), 'photon.json');
  const a = new Store(path);
  assert.equal(a.thread('imessage', 'chat1'), undefined);
  a.setThread({ sessionId: '7', channel: 'imessage', chatId: 'chat1', handle: '+14695550101' });
  a.setThread({ sessionId: '8', channel: 'telegram', chatId: '-100200', handle: '' });
  a.cursor = 'cur-42';
  const b = new Store(path);
  assert.equal(b.thread('imessage', 'chat1')?.sessionId, '7');
  assert.equal(b.thread('telegram', '-100200')?.sessionId, '8');
  assert.equal(b.cursor, 'cur-42');
  assert.equal(b.byHandle('(469) 555-0101')?.sessionId, '7');
  b.setThread({ sessionId: '9', channel: 'imessage', chatId: 'chat2', handle: '4695550101' });
  assert.equal(new Store(path).byHandle('+14695550101')?.sessionId, '9');
  assert.equal(b.byHandle('+15550000000'), undefined);
  assert.equal(b.bySession('8')?.chatId, '-100200');
  assert.equal(b.bySession('99'), undefined);
});

import { createHmac } from 'node:crypto';
import { verifySignature } from '../src/sig.ts';
test('post-call webhook signature', () => {
  const body = '{"type":"post_call_transcription"}', key = 'wsec_test', t = 1_800_000_000;
  const sig = `t=${t},v0=${createHmac('sha256', key).update(`${t}.${body}`).digest('hex')}`;
  assert.equal(verifySignature(sig, body, key, t * 1000), true);
  assert.equal(verifySignature(sig, body + ' ', key, t * 1000), false);
  assert.equal(verifySignature(sig, body, 'other', t * 1000), false);
  assert.equal(verifySignature(sig, body, key, (t + 3600) * 1000), false); // replayed an hour later
  assert.equal(verifySignature(undefined, body, key), false);
});

import { replyText } from '../src/words.ts';
test('reply text is plain, labels previews and adds session links once', () => {
  assert.equal(replyText('**Solid**: DUMBO', { hasPreview: false }), 'Solid: DUMBO');
  const t = replyText('Here you go.', { hasPreview: true, links: { plan: 'https://x/p/ABC', scout: 'https://x/s/ABC' } });
  assert.equal(t, 'Here you go.\nThe picture is an AI interpretation of your version, made from your photo.\nLive plan: https://x/p/ABC\nScout at the spot: https://x/s/ABC');
  assert.equal(replyText('An AI interpretation at 85 mm.', { hasPreview: true }), 'An AI interpretation at 85 mm.');
  assert.ok(replyText('x'.repeat(5000), { hasPreview: false }).length <= 1891);
});

import { parseInbound, attachmentBody } from '../src/photon-event.ts';
test('photon events: a photo with text in a group, and things we ignore', () => {
  const ev = { id: 'pho_evt_1', type: 'message.received', data: { projectId: 'p', object: {
    id: 'pho_msg_1', platform: 'imessage', status: 'received', parentMessageId: null,
    sentBy: { id: 'pho_usr_h', handle: '+14695550101', kind: 'human' }, receivedBy: { id: 'pho_usr_agent', kind: 'agent' },
    space: { id: 'pho_spc_1', kind: 'direct' },
    content: { type: 'group', parts: [{ type: 'attachment', attachmentId: 'pho_att_1' }, { type: 'text', format: 'plain', text: 'where is this?' }] } } } };
  assert.deepEqual(parseInbound(ev), { eventId: 'pho_evt_1', platform: 'imessage', spaceId: 'pho_spc_1', spaceKind: 'direct', messageId: 'pho_msg_1',
    parentId: '', handle: '+14695550101', agentUserId: 'pho_usr_agent', text: 'where is this?', attachmentIds: ['pho_att_1'] });
  const o = ev.data.object;
  assert.equal(parseInbound({ ...ev, type: 'message.delivered' }), null);
  assert.equal(parseInbound({ ...ev, data: { object: { ...o, sentBy: { ...o.sentBy, kind: 'agent' } } } }), null);
  assert.equal(parseInbound({ ...ev, data: { object: { ...o, content: { type: 'space.typing.update', typing: true } } } }), null);
  assert.equal(parseInbound({ ...ev, data: { object: { ...o, platform: 'email' } } }), null);
  assert.equal(parseInbound({ ...ev, data: { object: { ...o, platform: 'telegram', parentMessageId: 'pho_msg_0', content: { type: 'text', text: 'make it 85mm' } } } })?.parentId, 'pho_msg_0');
});

test('attachment upload body carries the exact size', () => {
  const { body, contentType } = attachmentBody(Buffer.from('JPEGDATA'), 'image/jpeg', 'p.jpg');
  const b = contentType.split('boundary=')[1], s = body.toString();
  assert.ok(s.startsWith(`--${b}\r\nContent-Type: application/json\r\n\r\n{"contentType":"image/jpeg","sizeBytes":8,"filename":"p.jpg"}`));
  assert.ok(s.endsWith(`\r\nJPEGDATA\r\n--${b}--\r\n`));
});

// Pure parsing of Photon 2.0 beta events (shape from https://api.photon.codes/openapi.json, MessageReceivedEvent).

export type Inbound = {
  eventId: string; platform: string; spaceId: string; spaceKind: string; messageId: string; parentId: string;
  handle: string; agentUserId: string; text: string; attachmentIds: string[];
};

const PLATFORMS = new Set(['imessage', 'telegram', 'sms']);

function flatten(c: any, texts: string[], atts: string[]) {
  if (!c) return;
  if (c.type === 'text' && c.text) texts.push(String(c.text));
  else if (c.type === 'attachment' && c.attachmentId) atts.push(String(c.attachmentId));
  else if (c.type === 'group' && Array.isArray(c.parts)) for (const p of c.parts) flatten(p, texts, atts);
}

/** A human's message.received on a channel ShotMatch answers, else null (receipts, typing, edits, our own sends). */
export function parseInbound(ev: any): Inbound | null {
  if (ev?.type !== 'message.received') return null;
  const m = ev.data?.object ?? ev.data;
  if (!m || m.status !== 'received' || !PLATFORMS.has(m.platform) || m.sentBy?.kind === 'agent' || !m.space?.id) return null;
  const texts: string[] = [], attachmentIds: string[] = [];
  flatten(m.content, texts, attachmentIds);
  if (!texts.length && !attachmentIds.length) return null;
  return {
    eventId: String(ev.id), platform: m.platform, spaceId: String(m.space.id), spaceKind: String(m.space.kind ?? ''),
    messageId: String(m.id), parentId: m.parentMessageId ? String(m.parentMessageId) : '',
    handle: String(m.sentBy?.handle ?? ''), agentUserId: String(m.receivedBy?.id ?? ''), text: texts.join('\n'), attachmentIds,
  };
}

/** multipart/related body for POST /attachments: a JSON part with the size, then the raw bytes. */
export function attachmentBody(bytes: Buffer, contentType: string, filename: string) {
  const boundary = `shotmatch${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
  const meta = JSON.stringify({ contentType, sizeBytes: bytes.length, filename });
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Type: application/json\r\n\r\n${meta}\r\n--${boundary}\r\nContent-Type: ${contentType}\r\n\r\n`),
    bytes, Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  return { body, contentType: `multipart/related; boundary=${boundary}` };
}

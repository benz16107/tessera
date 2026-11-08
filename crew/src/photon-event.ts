// Pure parsing of Photon 2.0 beta events (shapes from https://api.photon.codes/openapi.json: MessageReceivedEvent, VoiceCallEndedEvent).
export { attachmentBody } from './channels/api.ts';

export type Inbound = {
  eventId: string; platform: string; spaceId: string; spaceKind: string; messageId: string; parentId: string;
  handle: string; displayName: string; agentUserId: string; text: string; attachmentIds: string[];
};

// Every messaging platform Photon Beta delivers; WhatsApp Business arrives as whatsapp_business.
const PLATFORMS = new Set(['imessage', 'telegram', 'sms', 'email', 'whatsapp', 'whatsapp_business']);

function flatten(c: any, texts: string[], atts: string[]) {
  if (!c) return;
  if (c.type === 'text' && c.text) texts.push(String(c.text));
  else if ((c.type === 'attachment' || c.type === 'voice') && c.attachmentId) {
    atts.push(String(c.attachmentId));
    if (c.metadata?.caption?.text) texts.push(String(c.metadata.caption.text)); // a Telegram photo's caption rides on the attachment
  }
  else if (c.type === 'group' && Array.isArray(c.parts)) for (const p of c.parts) flatten(p, texts, atts);
}

/** Email replies quote the whole thread below the new text; keep only what the person wrote. */
export const stripQuoted = (t: string) => t.split(/\n(?:On .{5,200} wrote:|-{2,} ?Original Message|>.*\n>)/)[0].trim();

/** A human's message.received on a channel Tessera answers, else null (receipts, typing, edits, our own sends). */
export function parseInbound(ev: any): Inbound | null {
  if (ev?.type !== 'message.received') return null;
  const m = ev.data?.object ?? ev.data;
  if (!m || m.status !== 'received' || !PLATFORMS.has(m.platform) || m.sentBy?.kind === 'agent' || !m.space?.id) return null;
  const texts: string[] = [], attachmentIds: string[] = [];
  flatten(m.content, texts, attachmentIds);
  if (!texts.length && !attachmentIds.length) return null;
  const text = texts.join('\n');
  return {
    eventId: String(ev.id), platform: m.platform, spaceId: String(m.space.id), spaceKind: String(m.space.kind ?? ''),
    messageId: String(m.id), parentId: m.parentMessageId ? String(m.parentMessageId) : '',
    handle: String(m.sentBy?.handle ?? ''), displayName: String(m.sentBy?.metadata?.displayName ?? m.metadata?.displayName ?? '').slice(0, 40),
    agentUserId: String(m.receivedBy?.id ?? ''), text: m.platform === 'email' ? stripQuoted(text) : text, attachmentIds,
  };
}

/** call.ended on an inbound call: the caller's number, so the crew can text them the framing. */
export function parseCallEnded(ev: any): { callId: string; caller: string } | null {
  if (ev?.type !== 'call.ended') return null;
  const c = ev.data?.object ?? ev.data;
  if (!c || c.direction !== 'inbound' || !c.caller?.handle) return null;
  return { callId: String(c.id ?? ev.id), caller: String(c.caller.handle) };
}

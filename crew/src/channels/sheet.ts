// The call sheet as a message: Nemotron writes it (vision.ts callSheet), every channel gets its form (email the whole sheet,
// the rest a summary), and /sheet/<code> serves the designed page the messages link to.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { conn, logStep } from '../stdb.ts';
import { PUBLIC_URL, REPO } from '../config.ts';
import { callSheet } from '../vision.ts';
import { broadcast, planUrl, type Result } from './fanout.ts';
import type { Sheet } from './format.ts';

const DIR = join(REPO, 'data/sheets');
const file = (sessionId: bigint) => join(DIR, `${sessionId}.json`);

export function savedSheet(sessionId: bigint): Sheet | null {
  try { return JSON.parse(readFileSync(file(sessionId), 'utf8')); } catch { return null; }
}

export async function sendCallSheet(sessionId: bigint, opts: { skip?: string } = {}): Promise<{ sheet: Sheet; url: string; sent: Result[] } | { error: string }> {
  const t0 = Date.now();
  let sheet: Sheet;
  try { sheet = await callSheet(sessionId) as Sheet; } catch (e) { return { error: `I couldn't write the call sheet: ${(e as Error).message.slice(0, 160)}` }; }
  mkdirSync(DIR, { recursive: true });
  writeFileSync(file(sessionId), JSON.stringify(sheet));
  const code = conn.db.session.id.find(sessionId)?.code ?? '';
  const url = `${PUBLIC_URL}/sheet/${code}`;
  const sent = await broadcast(sessionId, { kind: 'callsheet', sheet, sheetUrl: url, planUrl: planUrl(sessionId) }, { idem: `sheet:${sessionId}:${t0}`, skip: opts.skip ? new Set([opts.skip]) : undefined });
  await logStep(sessionId, 'send_call_sheet', url, `${sheet.shots.length} shots to ${sent.filter(s => s.ok).map(s => `${s.name} (${s.channel})`).join(', ') || 'nobody on a channel yet'}`, Date.now() - t0);
  return { sheet, url, sent };
}

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

/** The designed call sheet: a printable page, light and dark, no external requests. */
export function sheetHtml(s: Sheet, code: string, imageUrl?: string): string {
  const rows = s.shots.map(x => `<tr><td class="n">${esc(x.n)}</td><td class="t">${esc(x.time)}</td><td><b>${esc(x.name)}</b>${x.framing ? `<div class="sub">${esc(x.framing)}</div>` : ''}</td>
    <td class="t">${esc(x.lens_mm)} mm${x.aperture ? `<div class="sub">f/${esc(x.aperture)}${x.shutter ? ` · ${esc(x.shutter)}` : ''}</div>` : ''}</td><td>${esc(x.people ?? '')}</td><td>${esc(x.light ?? '')}${x.notes ? `<div class="sub">${esc(x.notes)}</div>` : ''}</td></tr>`).join('');
  const windows = s.windows ? Object.entries(s.windows).map(([k, v]) => `<li><span>${esc(k.replace(/_/g, ' '))}</span> ${esc(v)}</li>`).join('') : '';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(s.title ?? 'Call sheet')} · Tessera</title>
<style>
:root{--paper:#f4f1ea;--ink:#1d1b18;--mute:#6b665d;--rule:#d8d2c4;--mark:#c2410c}
@media (prefers-color-scheme:dark){:root{--paper:#16150f;--ink:#ece8de;--mute:#a39d90;--rule:#3a372f;--mark:#f0884f}}
*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font:15px/1.5 "Iowan Old Style","Palatino Linotype",Georgia,serif}
main{max-width:980px;margin:0 auto;padding:40px 16px 64px}
header{display:grid;grid-template-columns:1fr auto;gap:8px 24px;border-bottom:2px solid var(--ink);padding-bottom:16px}
.kicker{font:600 12px/1 ui-monospace,Menlo,monospace;letter-spacing:.12em;text-transform:uppercase;color:var(--mark)}
h1{margin:6px 0 0;font-size:34px;line-height:1.1;font-weight:600}
.meta{font:13px/1.6 ui-monospace,Menlo,monospace;text-align:right;color:var(--mute)}
.meta b{color:var(--ink);font-weight:600}
.hero{margin:24px 0;border:1px solid var(--rule)}.hero img{display:block;width:100%;height:auto}
.hero p{margin:0;padding:8px 12px;font:12px ui-monospace,Menlo,monospace;color:var(--mute);border-top:1px solid var(--rule)}
table{width:100%;border-collapse:collapse;margin-top:24px}th{font:600 11px ui-monospace,Menlo,monospace;letter-spacing:.08em;text-transform:uppercase;color:var(--mute);text-align:left;padding:8px;border-bottom:1px solid var(--ink)}
td{padding:12px 8px;border-bottom:1px solid var(--rule);vertical-align:top}td.n{font:600 18px ui-monospace,Menlo,monospace;color:var(--mark);width:36px}
td.t{font:14px ui-monospace,Menlo,monospace;white-space:nowrap}.sub{color:var(--mute);font-size:13px;margin-top:2px}
section{margin-top:32px;display:grid;grid-template-columns:1fr 1fr;gap:32px}h2{font:600 12px ui-monospace,Menlo,monospace;letter-spacing:.1em;text-transform:uppercase;margin:0 0 8px}
ul{margin:0;padding:0;list-style:none}li{padding:6px 0;border-bottom:1px solid var(--rule)}li span{display:inline-block;min-width:120px;color:var(--mute)}
footer{margin-top:40px;font:12px ui-monospace,Menlo,monospace;color:var(--mute)}a{color:var(--mark)}
@media (max-width:720px){header{grid-template-columns:1fr}.meta{text-align:left}section{grid-template-columns:1fr}table,tbody,tr,td{display:block}thead{display:none}tr{border-bottom:1px solid var(--rule);padding:8px 0}td{border:0;padding:2px 0}}
@media print{body{background:#fff}a{color:inherit}}
</style></head><body><main>
<header><div><div class="kicker">Call sheet · set ${esc(code)}</div><h1>${esc(s.title ?? 'Call sheet')}</h1></div>
<div class="meta">${s.date ? `${esc(s.date)}<br>` : ''}${s.location ? `${esc(s.location)}<br>` : ''}${s.call_time ? `Call <b>${esc(s.call_time)}</b>` : ''}${s.wrap_time ? ` · Wrap <b>${esc(s.wrap_time)}</b>` : ''}</div></header>
${imageUrl ? `<figure class="hero"><img src="${esc(imageUrl)}" alt="The latest render of the hero shot"><p>Hero shot, latest render. An AI interpretation made from the set.</p></figure>` : ''}
<table><thead><tr><th>#</th><th>Time</th><th>Shot</th><th>Lens</th><th>People</th><th>Light and notes</th></tr></thead><tbody>${rows}</tbody></table>
<section>${windows ? `<div><h2>Light</h2><ul>${windows}</ul></div>` : ''}${s.crew_notes?.length ? `<div><h2>Crew notes</h2><ul>${s.crew_notes.map(n => `<li>${esc(n)}</li>`).join('')}</ul></div>` : ''}</section>
<footer>Written by Nemotron 3.5 Super from the live set. <a href="${esc(`${PUBLIC_URL}/p/${code}`)}">Open the set</a> · <a href="${esc(`${PUBLIC_URL}/s/${code}`)}">Scout page</a></footer>
</main></body></html>`;
}

// The thread as a version tree: pure helpers over shot_version rows (module/src/index.ts, "Photon: ... shot versions").
export type V = { id: bigint; parentVersionId?: bigint; label: string; channel: string; externalMessageId: string; imageUrl: string; createdAt: Date };

/** The version label a crew message starts with ("v3: ...", "v3.1 (from v3): ..."), or null. */
export const labelIn = (text: string) => /^(?:(?:Tessera|ShotMatch)\s+)?(v\d+(?:\.\d+)*)\b/.exec(text.trim())?.[1] ?? null;

const fmt = (d: Date, tz?: string) => d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', ...(tz && { timeZone: tz }) });

/** "versions": thread versions (v1, v2, v3) in order, each with its forks (v3.1, v3.1.1) indented under it. */
export function treeText(vs: V[], tz?: string): string {
  if (!vs.length) return 'No versions yet. Each render I send is numbered, and replying to one forks the set from it.';
  const byId = new Map(vs.map(v => [String(v.id), v]));
  const isFork = (v: V) => v.label.includes('.') && v.parentVersionId !== undefined && byId.has(String(v.parentVersionId));
  const forks = (v: V) => vs.filter(c => isFork(c) && c.parentVersionId === v.id).sort((a, b) => Number(a.id - b.id));
  const lines: string[] = [];
  const walk = (v: V, depth: number) => {
    lines.push(`${'  '.repeat(depth)}${depth ? '└ ' : ''}${v.label} · ${fmt(v.createdAt, tz)} · ${v.channel}${v.imageUrl ? '' : ' (no image yet)'}`);
    for (const c of forks(v)) walk(c, depth + 1);
  };
  for (const r of vs.filter(v => !isFork(v)).sort((a, b) => Number(a.id - b.id))) walk(r, 0);
  return `${lines.join('\n')}\nReply to any version's message to fork from it.`;
}

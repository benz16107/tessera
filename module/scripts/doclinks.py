# Re-points every `[..](../module/src/index.ts#L<n>)` link in docs/SPACETIME.md at the line it names, after module edits.
# Each link's target is found from the text just before it (a backticked name, or a known phrase). Run from the repo root.
import re, sys
src = open('module/src/index.ts').read().split('\n')
def find(pat):
    r = re.compile(pat)
    for i, l in enumerate(src):
        if r.search(l): return i + 1
    sys.exit(f'not found in source: {pat}')
NAMED = {  # backticked name in the doc -> definition in the source
    'visibility': r'^export const visibility', 'SESSION_TABLES': r'^const SESSION_TABLES', 'EVENT_TABLES': r'^const EVENT_TABLES',
    'session_member': r'^const sessionMember', 'grant': r'^const grant = ', 'ensureSetup': r'^const ensureSetup', 'audience': r'^const audience',
    'notify': r'^const notify', 'traceAs': r'^const traceAs', 'titleSession': r'^export const titleSession', 'sweep': r'^export const sweep = ',
    'set_event': r'^const setEvent = table', 'sendSetEvent': r'^export const sendSetEvent', 'activity': r'^const activity = table',
    'publish_prop_outbox': r'^const publishPropOutbox', 'publish_shot_outbox': r'^const publishShotOutbox', 'library_link': r'^const libraryLink',
    'sharePropToLibrary': r'^const sharePropToLibrary', 'onPublishProp': r'^export const onPublishProp', 'shareShot': r'^export const shareShot',
    'onPublishShot': r'^export const onPublishShot', 'scene_change': r'^const sceneChange = table', 'recordChange': r'^const recordChange',
    'undoSceneChange': r'^export const undoSceneChange', 'restoreSceneTo': r'^export const restoreSceneTo', 'restoreTo': r'^const restoreTo = ',
    'shot_version': r'^const shotVersion', 'recordShotVersion': r'^export const recordShotVersion', 'updateShotVersion': r'^export const updateShotVersion',
    'restoreToVersion': r'^export const restoreToVersion', 'channel_link': r'^const channelLink', 'addChannelLink': r'^export const addChannelLink',
    'checkin': r'^const checkin = table', 'recordCheckin': r'^export const recordCheckin', 'init': r'^export const init', 'onConnect': r'^export const onConnect',
    'onDisconnect': r'^export const onDisconnect', 'upgrade': r'^export const upgrade', 'newCode': r'^const newCode',
    'joinSessionAsCrew': r'^export const joinSessionAsCrew', 'startRender': r'^export const startRender', 'refreshLayers': r'^export const refreshLayers',
    'layer_snapshot': r'^const layerSnapshot', 'layer_toggle': r'^const layerToggle', 'setLayerToggle': r'^export const setLayerToggle',
}
PHRASES = {  # text right before an unnamed link -> source pattern
    "view `session_card(code)` ([line": r'^export const sessionCard', "`by_online` index ([line": r"accessor: 'by_online'",
    "schedule table ([line": r'titleJob\.insert', "with `ctx.http.fetch` ([line": r"ctx\.http\.fetch\('https://integrate",
    "declared in the schema ([line": r'^  env: \{', "Router at [line": r'^export const router', "`GET /health` ([line": r'^export const health',
    "`GET /shot?code=<share code>` ([line": r'^export const shotJson', "`POST /hooks/elevenlabs` ([line": r'^export const elevenlabsWebhook',
    "fails instead ([line": r"const render = j\.kind === 'render'", "`toast` ([line": r'^const toast = table', "as a submodule ([line": r'^  rateLimit,$',
    "8 pings per 10 seconds ([line": r'^const setEventLimit', "`session.code` is unique ([line": r"code: t\.string\(\)\.unique\(\)",
    "moving this object\", [line": r"if \(o\.lockedBy && !o\.lockedBy\.equals\(ctx\.sender\)\) throw new SenderError\('someone else is moving this object'\);",
    "`t.result(t.unit(), t.string())` ([line": r't\.result\(t\.unit\(\), t\.string\(\)\)', "`registerCrew` at [line": r'^export const registerCrew',
}
ROWS = {  # table rows starting with these -> pattern for the first link in the row
    '| `my_sessions`': r'^export const mySessions', '| `my_scene_locks`': r'^export const mySceneLocks', '| `session_card(code)`': r'^export const sessionCard',
    '| `live_sessions`': r'^export const liveSessions', '| `spot_library`': r'^export const spotLibrary', '| `shot_library`': r'^export const shotLibrary',
    '| `prop_library`': r'^export const propLibrary', '| `sweep_timer`': r'^export const sweep = ', '| `reminder`': r'^export const fireReminder',
    '| `presence_timer`': r'^export const presenceSweep', '| `sun_clock`': r'^export const sunTick', '| `title_job`': r'^const titleJob',
    '| `layer_timer`': r'^export const refreshLayers',
}
LINK = r'\(\.\./module/src/index\.ts#L\d+\)'
doc = open('docs/SPACETIME.md').read()
doc = re.sub(r"\[`([A-Za-z_]+)`, line \d+\]" + LINK,
             lambda m: (lambda k: f"[`{m.group(1)}`, line {k}](../module/src/index.ts#L{k})")(find(NAMED[m.group(1)])) if m.group(1) in NAMED else m.group(0), doc)
for ctx, pat in PHRASES.items():
    k, i = find(pat), doc.find(ctx)
    if i < 0: continue
    j = i + len(ctx)
    m = re.match(r" \d+\]" + LINK, doc[j:])
    if m: doc = doc[:j] + f" {k}](../module/src/index.ts#L{k})" + doc[j + m.end():]
lines = []
for l in doc.split('\n'):
    for start, pat in ROWS.items():
        if l.startswith(start):
            k = find(pat); l = re.sub(r"\[\d+\]" + LINK, f"[{k}](../module/src/index.ts#L{k})", l, count=1)
    lines.append(l)
open('docs/SPACETIME.md', 'w').write('\n'.join(lines))
left = [l for l in re.findall(r"#L(\d+)", '\n'.join(lines))]
print(f'{len(left)} links re-pointed')

# SpacetimeDB in Tessera

Tessera is a shared virtual film set. You drop a photo of a place, Tessera finds where the photographer stood, and your group builds its own version of the shot in a 3D set: people, props, lights, a camera with real lenses. Everything a session is lives in SpacetimeDB. There is no application server between the browser and the data, no websocket layer we wrote, no queue and no cron. The browser, the scout's phone, our GPU worker ("the crew"), the phone agent and the iMessage bridge all read and write the same rows in one TypeScript module on Maincloud.

- Module: [`module/src/index.ts`](../module/src/index.ts) (database `shotmatch` on Maincloud)
- Second database: [`module/library/src/index.ts`](../module/library/src/index.ts) (`shotmatch-library`)
- Web pieces: [`web/src/spacetime/`](../web/src/spacetime/) (hooks, presence bar, Live data inspector)
- Proof scripts: [`module/scripts/`](../module/scripts/) (`proof.ts`, `loadtest.ts`, `demo.sh`)

SpacetimeDB 2.14.1 (CLI, server SDK and client SDK). Every feature below was checked against the 2.14 TypeScript docs and the package's type definitions, then run against Maincloud.

## Architecture

```
  planner browsers        scout phone          crew (Node, Vultr GPU box)        phone agent (ElevenLabs)
  React + three.js        camera + GPS         solver, Nemotron, renders, Photon  post-call webhook
        |  websocket            |  websocket            |  websocket                      |  HTTPS POST
        v                       v                       v                                 v
 +---------------------------------------------------------------------------------------------------+
 |  Maincloud: database `shotmatch` (one TypeScript module)                                          |
 |                                                                                                   |
 |  tables ----- row-level security: a session's rows reach only its members and the crew           |
 |  reducers --- every write, validated, atomic (scene edits, locks, jobs, leases, versions)         |
 |  views ------ my_sessions, my_scene_locks (per user); session_card(code), live_sessions,          |
 |               spot_library, shot_library, prop_library (anonymous, shared by all subscribers)     |
 |  event tables toast, set_event (cursors, laser pings, camera follow), activity: never stored      |
 |  schedules -- job sweep 10 s, presence sweep 10 s, live sun 1 s, reminders, title job             |
 |  procedure -- title_session: calls NVIDIA Nemotron 3.5 Lightning over HTTP, writes the title      |
 |  HTTP routes  GET /health, GET /shot?code=, POST /hooks/elevenlabs (HMAC checked in the module)   |
 |  submodule -- official @spacetimedb/rate-limit: per-sender quotas on set events                   |
 |  outboxes --- publish_prop_outbox, publish_shot_outbox ----+                                      |
 +------------------------------------------------------------|--------------------------------------+
                                                              | inter-database calls, exactly once,
                                                              v in order; results come back (onResult)
 +---------------------------------------------------------------------------------------------------+
 |  Maincloud: database `shotmatch-library`: the public library of finished shots and generated     |
 |  props shared by every session; accepts calls only from allow-listed databases (trusted_db)       |
 +---------------------------------------------------------------------------------------------------+
```

## Feature by feature

Line numbers point into `module/src/index.ts` unless another file is named.

### 1. Row-level security

Every session-scoped table is visible only to that session's participants and the crew identity. Spots and the library views stay public.

- The filters: [`visibility`, line 1624](../module/src/index.ts#L1624), built from [`SESSION_TABLES`, line 1616](../module/src/index.ts#L1616) and [`EVENT_TABLES`, line 1621](../module/src/index.ts#L1621). One filter per table: `SELECT t.* FROM t JOIN session_member ON t.session_id = session_member.session_id WHERE session_member.identity = :sender`.
- [`session_member`, line 238](../module/src/index.ts#L238) holds one row per participant per session, plus one for the crew in every session ([`grant`, line 541](../module/src/index.ts#L541), [`ensureSetup`, line 553](../module/src/index.ts#L553)).
- Event tables can't be the lookup side of a filter join, so each event row is addressed to one recipient ([`audience`, line 495](../module/src/index.ts#L495), [`notify`, line 501](../module/src/index.ts#L501), [`traceAs`, line 505](../module/src/index.ts#L505)) and filtered by `recipient = :sender`.
- Joining by code without leaking sessions: the session row is filtered too, so a newcomer reads the anonymous view `session_card(code)` ([line 1581](../module/src/index.ts#L1581)) to see the title, then calls `joinSession`. The code is the capability. Client side: [`useSessionCard`](../web/src/spacetime/hooks.ts#L19), used by [`Planner.tsx` line 110](../web/src/Planner.tsx#L110) and [`Scout.tsx` line 14](../web/src/Scout.tsx#L14).

Why we chose filters over per-user views: they keep every existing table subscription in the web app, the studio and the crew exactly as it was (`tables.photo.where(sessionId = ...)`), while the database decides what each client receives.

Proof (`node scripts/proof.ts shotmatch`, two fresh anonymous identities against production): Jun, not a participant, subscribes to every table and receives 0 sessions, 0 participants, 0 objects and 0 history rows of Maya's session. He sees the session card through the code, joins, and immediately receives the session, its 2 participants and its objects. The crew identity sees every session.

### 2. Views

| View | Kind | Line | What it does |
|---|---|---|---|
| `my_sessions` | per user, query builder semijoin | [1567](../module/src/index.ts#L1567) | Sessions I'm in. The home page's "Your shoots" list reads it ([`Planner.tsx` line 29](../web/src/Planner.tsx#L29)). |
| `my_scene_locks` | per user | [1571](../module/src/index.ts#L1571) | Objects whose gizmo I hold, in any session. |
| `session_card(code)` | anonymous, with an argument | [1581](../module/src/index.ts#L1581) | Title, spot, people online and object count for one code. |
| `live_sessions` | anonymous | [1590](../module/src/index.ts#L1590) | Sessions with someone online right now, with counts and no codes or titles. Reads through the `by_online` index ([line 45](../module/src/index.ts#L45)). |
| `spot_library` | anonymous, query builder | [1605](../module/src/index.ts#L1605) | Spots that have a 3D model. |
| `shot_library` | anonymous, query builder | [1607](../module/src/index.ts#L1607) | Finished shots people chose to share. |
| `prop_library` | anonymous, query builder | [1609](../module/src/index.ts#L1609) | Generated props from every session, mirrored from `shotmatch-library`. |

Anonymous views are computed once and shared by every subscriber; the query-builder ones are evaluated incrementally by the query engine.

### 3. Procedure with outbound HTTP: Nemotron names the shoot

When the crew finishes a solve for a session still called "Untitled shoot", `finishJob` inserts a one-shot row into the `title_job` schedule table ([line 584](../module/src/index.ts#L584)). That runs the procedure [`titleSession`, line 1441](../module/src/index.ts#L1441): it reads the spot, lens, heading, plan time, people and what the group said in one transaction, calls NVIDIA's `nvidia/nemotron-3.5-lightning-30b-a3b` with `ctx.http.fetch` ([line 1464](../module/src/index.ts#L1464)), then writes the title, an `agent_step` row and a toast in a second transaction. No worker is involved. Measured: 121 to 126 ms for the NVIDIA call ("Washington Street Bridge View", "Northward Frame").

Secrets: the NVIDIA key and the ElevenLabs webhook secret are database environment variables declared in the schema ([line 450](../module/src/index.ts#L450)) and set at publish time from `~/.config/shotmatch` by [`module/scripts/publish.sh`](../module/scripts/publish.sh). They are never in source and never reach clients. Publishing keeps stored values, so `npm run publish` keeps working.

A second procedure, [`refreshLayers`, line 1529](../module/src/index.ts#L1529), runs every 15 minutes from the `layer_timer` schedule. It finds the active spots (sessions with someone present or a scene edit in the last 2 hours, plus `nyc_dumbo`) and, for each, fetches the hourly cloud, visibility, rain, wind and temperature forecast from Open-Meteo and the active National Weather Service alerts, then writes one [`layer_snapshot`, line 409](../module/src/index.ts#L409) row per spot and layer (public spot data). A failed fetch keeps the last good summary and records the error. Each refresh posts an activity event to the sessions at that spot, so it shows in the Live inspector. Measured on production: weather 90 ms, alerts 212 ms. Which layers a session shows is shared through [`layer_toggle`, line 423](../module/src/index.ts#L423) (session data under row-level security) and [`setLayerToggle`, line 1500](../module/src/index.ts#L1500).

### 4. HTTP handlers (inbound)

Router at [line 1705](../module/src/index.ts#L1705), served at `https://maincloud.spacetimedb.com/v1/database/shotmatch/route/...`:

- `GET /health` ([line 1638](../module/src/index.ts#L1638)): counts read in a transaction. Try it: [health](https://maincloud.spacetimedb.com/v1/database/shotmatch/route/health).
- `GET /shot?code=<share code>` ([line 1646](../module/src/index.ts#L1646)): public JSON for a shared shot (image, spot, camera position, heading, lens). Strict routing has no path parameters, so the code is a query parameter.
- `POST /hooks/elevenlabs` ([line 1666](../module/src/index.ts#L1666)): the phone agent's post-call webhook. The module checks the `ElevenLabs-Signature` HMAC-SHA256 itself ([`module/src/sha256.ts`](../module/src/sha256.ts), checked against `node:crypto` by `npm run check`), rejects anything older than 30 minutes, dedupes retries by conversation id, and writes the transcript straight into the session's `message` rows plus a toast. The session comes from the agent's `session_code` dynamic variable, or for a real phone call from the caller's number matched against `channel_link`. It is live: the Tessera phone agent's post-call webhook points here (ElevenLabs webhook `d459b97d6a1d4ad5b44f47116c15a707`), with its HMAC secret in the database environment. Proof: a bad signature gets 401, a valid one writes 2 transcript rows, a retry is a no-op, and a call with only a caller number lands in the session that linked that number.

### 5. Schedules

| Schedule | Interval | Line | Job |
|---|---|---|---|
| `sweep_timer` runs `sweep` | 10 s | [1281](../module/src/index.ts#L1281) | Requeues solve and preview jobs whose worker stopped renewing its lease (kill the worker mid-solve and the job comes back). A render's layers lived in the crew's request, so an expired render fails instead ([line 1294](../module/src/index.ts#L1294)). |
| `reminder` runs `fireReminder` | one-shot | [1234](../module/src/index.ts#L1234) | Golden-hour reminder: a toast plus an outbox row the crew texts out. |
| `presence_timer` runs `presenceSweep` | 10 s | [1313](../module/src/index.ts#L1313) | Marks a silent editor idle after 30 s, drops them after 2 minutes, and frees the gizmo locks they hold. A frozen tab keeps its websocket open, so `onDisconnect` alone never frees its lock. |
| `sun_clock` runs `sunTick` | 1 s, per session | [1369](../module/src/index.ts#L1369) | Live sun: while the row exists, the set's clock (`session.planTime`) follows the real clock (rate 1) or plays a time-lapse (60x, 600x). The studio's sun light reads `planTime`, so every client's light moves together. Proof: 600x moved the set 30.0 minutes in 3.2 s. |
| `title_job` runs `titleSession` (procedure) | one-shot | [315](../module/src/index.ts#L315) | See 3. |
| `layer_timer` runs `refreshLayers` (procedure) | 15 min | [1529](../module/src/index.ts#L1529) | Weather and NWS alerts for active spots, fetched by the database itself. |

### 6. Event tables: ephemeral collaboration

- [`set_event`, line 263](../module/src/index.ts#L263), written by [`sendSetEvent`, line 1337](../module/src/index.ts#L1337): cursors on the ground, laser-pointer pings ("Maya is pointing here"), camera views and follow requests. Rows reach the session's members once and are never stored: `SELECT COUNT(*) FROM set_event` is always 0.
- [`activity`, line 278](../module/src/index.ts#L278): one event per reducer call in a session, so the Live data inspector can name other people's calls (a client only learns reducer names for its own calls).
- `toast` ([line 205](../module/src/index.ts#L205)): "Shot located", "Maya reached the spot".
- Client: [`useSetEvents`](../web/src/spacetime/hooks.ts#L81) (cursors fade after 3 s, pings after 4 s, cursor sends throttled to 10 Hz, follow and "follow me"). The studio draws them in the 3D set.
- The official [Rate Limit module](https://spacetimedb.com/modules/rate-limit) is mounted as a submodule ([line 442](../module/src/index.ts#L442)) and caps each sender at 40 set events a second and 8 pings per 10 seconds ([line 1335](../module/src/index.ts#L1335)). Proof: a 12-ping burst let 7 through and refused 5.

### 7. Inter-database communication

`shotmatch-library` is a second database holding the public library of generated props and finished shots. Sessions publish to it through outbox tables; the library answers through `onResult` reducers.

- Receiver bindings: `npm run generate:library` (`spacetime generate --bindings module`) writes [`module/src/remote_bindings/library`](../module/src/remote_bindings/library/index.ts) from the library's source, so a wrong argument is a compile error.
- Outboxes: [`publish_prop_outbox`, line 327](../module/src/index.ts#L327) and [`publish_shot_outbox`, line 335](../module/src/index.ts#L335). The target column has the library's identity type, read from [`library_link`, line 323](../module/src/index.ts#L323).
- Real use: when the crew adds a TRELLIS prop (`kind = prop_generated`) to any set, [`sharePropToLibrary`, line 864](../module/src/index.ts#L864) queues it in the same transaction. The library dedupes by URL and counts sessions; [`onPublishProp`, line 1421](../module/src/index.ts#L1421) mirrors it into `library_prop`, and every session's asset library (`prop_library` view) offers it.
- Sharing a shot: [`shareShot`, line 1390](../module/src/index.ts#L1390) gives a finished preview or render an 8-letter share code and sends it; [`onPublishShot`, line 1408](../module/src/index.ts#L1408) marks it published; `GET /shot?code=` serves it.
- In production this already carries real work: the crew's TRELLIS props ("wooden cafe chalkboard sign", "vintage travel poster of the Brooklyn Bridge at sunset", "silver car") went out through the outbox, the library accepted them, and they appear in every session's Library panel. `spacetime logs shotmatch` shows `idc publish_prop "wooden cafe chalkboard sign" -> shotmatch-library: ok`.
- The library accepts calls only from databases in its `trusted_db` allow list ([`module/library/src/index.ts`](../module/library/src/index.ts)); the caller's `ctx.sender` is the calling database's identity.

The guarantees we rely on come from SpacetimeDB: the call is sent if and only if the sending transaction commits, runs exactly once, in order, after the sender's transaction is durable.

### 8. Scene history: time travel the set

- [`scene_change`, line 288](../module/src/index.ts#L288): who changed which object, with its state before and after as JSON. [`recordChange`, line 835](../module/src/index.ts#L835) folds a drag (edits by one person to one object less than 2 s apart) into one entry: the load test's 900 edits left 6 history rows.
- Undo by anyone: [`undoSceneChange`, line 920](../module/src/index.ts#L920) puts the object back the way it was before that change.
- Restore to any point: [`restoreSceneTo`, line 951](../module/src/index.ts#L951) (shared helper [`restoreTo`, line 930](../module/src/index.ts#L930)): every object touched since goes to the `before` state of its earliest later change, in one transaction. Restores are themselves history rows, so a restore can be undone.
- Client: the History tab's scrubber ([`HistoryScrubber`](../web/src/spacetime/LiveInspector.tsx#L125)) and [`sceneAt`](../web/src/spacetime/hooks.ts#L152), which rebuilds the set at any point on the client for a ghost preview before restoring.

### 9. Photon: a text thread as a version tree over scene history

The iMessage bridge (Photon) treats a thread as versions of the shot. Each version points at a `scene_change` id, so the set at that version is exactly what scene history rebuilds.

- [`shot_version`, line 378](../module/src/index.ts#L378): label (v1, v2, v3), parent version, the Photon message id, channel, scene change id, image. [`recordShotVersion`, line 1015](../module/src/index.ts#L1015) (crew) and [`updateShotVersion`, line 1038](../module/src/index.ts#L1038) (the render lands later).
- "Go back to v1 but make it 85 mm": [`restoreToVersion`, line 1050](../module/src/index.ts#L1050) restores the set to v1's snapshot with the same history machinery and records a new branch under it, v1.1. The thread becomes a tree; the set's history stays one undoable line.
- [`channel_link`, line 363](../module/src/index.ts#L363): how each person is reached (iMessage, Telegram, SMS, WhatsApp, email, voice), including invitees who have no SpacetimeDB identity yet ([`addChannelLink`, line 965](../module/src/index.ts#L965)).
- [`checkin`, line 391](../module/src/index.ts#L391): a scout's photo from the mark, scored against the planned camera, with a toast to everyone ([`recordCheckin`, line 1068](../module/src/index.ts#L1068)).

All three are session data under the same row-level security.

### 10. The rest of the toolbox

- Lifecycle reducers: [`init`, line 566](../module/src/index.ts#L566), [`onConnect`, line 587](../module/src/index.ts#L587), [`onDisconnect`, line 592](../module/src/index.ts#L592) (marks people offline, drops their presence, frees their locks). `init` never re-runs on a publish, so the owner-only [`upgrade`, line 573](../module/src/index.ts#L573) runs the same idempotent setup after one.
- Indexes and unique constraints: `session.code` is unique ([line 33](../module/src/index.ts#L33)) and session codes are drawn with `ctx.random` ([`newCode`, line 523](../module/src/index.ts#L523)); `sun_clock.session_id` is unique (one clock per session); btree indexes on every `session_id` feed the filter joins and the views.
- `scheduleAt` and `Timestamp`: schedule tables above; job leases are `Timestamp`s compared in the sweep.
- `SenderError`: every validation failure the caller should see, for example the gizmo lock ("someone else is moving this object", [line 892](../module/src/index.ts#L892)) and the rate limit.
- `t.result`: the `onResult` reducers receive `t.result(t.unit(), t.string())` ([line 1410](../module/src/index.ts#L1410)).
- Migration-safe changes only: new tables, and columns appended with `.default()` (`preview_job.kind`, `preview_job.requestId`, `toast.recipient`, `channel_link.name`, the `checkin` position columns). Demo session A9TVAN survived every publish.
- The nvidia worker's requests: [`joinSessionAsCrew`, line 616](../module/src/index.ts#L616) and render rows in `preview_job` with `kind = 'render'` ([`startRender`, line 1144](../module/src/index.ts#L1144); the crew finds its row by `requestId`).

## Identity and security model

| Who | Identity | How it is kept | What it may do |
|---|---|---|---|
| Planner (browser) | anonymous SpacetimeDB identity | token in `localStorage`, keyed by host and database ([`web/src/main.tsx`](../web/src/main.tsx)) | create sessions, join by code, edit the sets it is a member of |
| Scout (phone page) | a second anonymous identity | its own token key (`/scout`), so one browser can plan and scout as two people | join as scout, push GPS and compass |
| Crew (worker) | anonymous identity made privileged | token in `~/.config/shotmatch/crew_token`; it redeems a one-time code the owner set (`setCrewCode`, `registerCrew` at [line 608](../module/src/index.ts#L608)) | claim jobs, finish solves and renders, record versions and check-ins, read every session |
| Owner | Ben's CLI identity (the publisher) | `spacetime login` | `upgrade`, `setLibrary`, `setCrewCode`, delete any session; sees all rows (owners bypass filters) |
| `shotmatch` as a caller | the database's own identity | Maincloud | publish to the library, which allow-lists it in `trusted_db` |
| HTTP request | a random identity per request | none | nothing by identity; the webhook proves itself with its HMAC signature |

What a stranger can read: spots, the anonymous views (no codes, no titles in `live_sessions`), a session card if they know its code, and `session_member` (numeric session ids and anonymous identities, no names; see limits).

## Measured numbers

Load test ([`module/scripts/loadtest.ts`](../module/scripts/loadtest.ts)): 3 headless clients in one session, each dragging its own object at 10 Hz for 30 s exactly like the studio's gizmo (lock, `updateSceneObject` per frame, unlock), against production with filters on.

| Run from | Network (TCP connect) | Committed | Round trip p50 / p95 / p99 | Another client sees it p50 / p95 / p99 |
|---|---|---|---|---|
| linuxbox, home Wi-Fi, run 1 | about 45 ms | 900 of 900 | 42 / 409 / 638 ms | 41 / 432 / 649 ms |
| linuxbox, home Wi-Fi, run 2 | about 45 ms | 900 of 900 | 44 / 144 / 341 ms | 43 / 152 / 348 ms |
| Vultr VM, Dallas | 30 to 60 ms | 900 of 900 | 50 / 199 / 750 ms | 50 / 221 / 846 ms |

The median round trip equals one network round trip, so the database's own time per edit is small next to the network. The tail varies run to run with the network. Throughput was 27.3 committed transactions a second, the rate we sent; no call failed.

Other numbers: Nemotron title procedure 121 to 126 ms for the NVIDIA call; the inspector's heartbeat round trip read 30 ms in one browser run and 245 to 553 ms in headless Chrome on the same Wi-Fi; `proof.ts` passes 38 of 38 checks on the scratch database `shotmatch-scratch` and 19 of 19 on production (crew steps skipped there because they would re-register the crew identity).

## How to check it yourself

```bash
cd module
npm run check                                   # SHA-256/HMAC against node:crypto
node scripts/proof.ts shotmatch-scratch             # every feature, two users plus a crew (scratch database)
node scripts/proof.ts shotmatch                 # production: filters, views, presence, events, history, HTTP
node scripts/loadtest.ts shotmatch 3 10 30      # the load test above
scripts/demo.sh shotmatch                       # live SQL over both databases, HTTP routes, log highlights
```

In the app, open a set at `/studio/<code>` and press Live data: the Feed tab streams this session's reducer calls and row changes as they arrive, with changes per second, the measured round trip and how many rows this client can see; History scrubs and restores the set; Library shares shots and offers props from every session.

## What SpacetimeDB couldn't do, and what we did instead

- A filter may not join a table that has filters of its own. The error says "Subscriptions require indexes on join columns" even when both columns are indexed; we reproduced it in a two-table lab database. So filters join `session_member`, which is public and unfiltered: anyone can see which anonymous identities belong to which numeric session ids, but no names, codes or content.
- Event tables can't be the lookup side of a subscription join, so event rows are fanned out per recipient.
- Filters can't reference private tables, and a table switched from private to public can't get a filter in the same publish (two publishes needed).
- A join without an `ON` column is refused in subscriptions.
- HTTP routes have no path parameters (`/shot?code=` instead of `/shot/<code>`).
- TypeScript client query builders don't take view arguments, so `session_card(code)` is the one SQL-string subscription.
- A receiving reducer can't return a value through inter-database calls; `onResult` gets only success or the error message, so the sender keeps its own mirror rows.
- Clients built with older bindings fail to decode a table that gained columns ("Can't deserialize an option type"), so every publish that appends a column is followed by regenerating bindings and redeploying the crew. The crew on Vultr crash-looped for about a minute after the first publish until we did.
- Row-level security is marked experimental in the docs, which recommend views. We use it because it kept every existing subscription unchanged.
- Deleting a receiving database and publishing a new one under the same name (same identity) leaves calls from a sender that had already talked to the old one pending forever, and pending outbox rows can't be cancelled. Senders that had never called the old database deliver normally (production did). We retired the affected scratch database.

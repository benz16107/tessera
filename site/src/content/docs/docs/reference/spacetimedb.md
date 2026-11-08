---
title: SpacetimeDB module
description: The tables, reducers, views, schedules, procedures and HTTP routes of the shotmatch and shotmatch-library databases.
---

Source: `module/src/index.ts` (database `shotmatch` on Maincloud) and `module/library/src/index.ts` (`shotmatch-library`). SpacetimeDB 2.14.1. How the pieces work together: [Live sync](/docs/how-it-works/live-sync/).

## Who may call what

| Caller | How it is identified | May |
|---|---|---|
| Member | an anonymous identity that called `createSession` or `joinSession` | edit the sessions it belongs to |
| Crew | the worker's identity, after `registerCrew` with the owner's crew code | claim and finish jobs, write versions and check-ins, relay channels, read every session |
| Owner | the publisher's CLI identity | `upgrade`, `setLibrary`, `setCrewCode`, delete any session; sees all rows |
| Anyone | | read spots, the anonymous views, and a session card by code |

A failed check raises a `SenderError` the caller sees, for example "crew only", "join the session first" or "someone else is moving this object".

## Tables

Session-scoped tables are filtered by row-level security: a session's rows reach only its members and the crew. Event tables (marked "event") are never stored; each row is written once per recipient.

| Table | Columns, in brief |
|---|---|
| `spot` | `id`, `name`, `lat`, `lon`, `radiusM`, `cameras`, `modelVersion` (public) |
| `session` | `id`, `code` (unique), `spotId`, `title`, `owner`, `planTime` (the set's clock), `createdAt` |
| `participant` | `sessionId`, `identity`, `name`, `role` (planner, scout or crew), `online`, `lastSeen` |
| `session_member` | `sessionId`, `identity`, `role` (member or crew); what the row-level filters join (public: ids only) |
| `photo` | `sessionId`, `owner`, `url`, `thumb` (small JPEG data URL), `width`, `height`, `pinLat`, `pinLon`, `exifF35`, `source` |
| `solve_job` | `photoId`, `sessionId`, `spotId`, `state` (queued, running, done, failed), `progress`, `worker`, `leaseUntil`, `attempts`, `error`, `lensHintF35` |
| `solve_result` | `photoId`, `sessionId`, `jobId`, `pose`, `inliers`, `confidence` (solid, check, none), `reason`, `lensReadF35`, `secs` |
| `camera` | `sessionId`, `pose`, `updatedBy` |
| `person` | `sessionId`, `lat`, `lon`, `heading`, `label`, `pose`, `heightM` |
| `device_pose` | `participantId`, `sessionId`, `lat`, `lon`, `accuracyM`, `heading`, `at` (the scout's phone) |
| `shot_settings` | `sessionId`, `bodyId`, `lensId`, `focalMm`, `aperture`, `shutterS`, `iso`, `whiteBalanceK`, `focusM`, `aspect`, `overlays`, `distortion` |
| `scene_object` | `sessionId`, `kind`, `assetId`, `name`, `x`, `y`, `z` (east, north, up in m), `qx`, `qy`, `qz`, `qw`, `scale`, `color`, `intensity`, `lightType`, `params`, `visible`, `lockedBy`, `updatedBy`, `updatedAt` |
| `scene_change` | `sessionId`, `objectId`, `action` (add, update, delete, undo, restore), `before`, `after`, `by`, `byName`, `at` |
| `preview_job` | `sessionId`, `photoId`, `instruction`, `f35`, `people`, `sunAzimuth`, `sunAltitude`, `state`, `imageUrl`, `error`, `worker`, `leaseUntil`, `attempts`, `kind` (preview or render), `requestId` |
| `message` | `sessionId`, `channel`, `threadId`, `externalId`, `parentExternalId`, `direction` (in or out), `author`, `text`, `imageUrl` |
| `agent_step` | `sessionId`, `tool`, `args`, `result`, `ms`, `at` (Nemotron's trace) |
| `presence` | `participantId`, `sessionId`, `name`, `color`, `status` (active or idle), `focusObjectId` |
| `channel_link` | `sessionId`, `participantId`, `identity`, `channel` (imessage, telegram, sms, whatsapp, email, voice), `address`, `verified`, `name` |
| `shot_version` | `sessionId`, `parentVersionId`, `label` (v3, v3.1), `externalMessageId`, `channel`, `sceneChangeId`, `imageUrl` |
| `checkin` | `sessionId`, `participantId`, `photoId`, `distanceM`, `headingErrDeg`, `verdict`, `x`, `y`, `heading`, `imageUrl`, `name` |
| `reminder` | `scheduledAt`, `sessionId`, `text` (schedule) |
| `outbox` | `sessionId`, `text`, `state` (pending, sent, failed) |
| `layer_snapshot` | `spotId`, `layer` (weather or alerts), `fetchedAt`, `summary` (JSON), `geojsonUrl`, `error` (public) |
| `layer_toggle` | `sessionId`, `layer`, `on`, `updatedBy`, `updatedAt` |
| `toast` (event) | `sessionId`, `kind`, `text`, `recipient` |
| `set_event` (event) | `recipient`, `sessionId`, `from`, `name`, `color`, `kind` (cursor, ping, view, follow, unfollow), `x`, `y`, `z`, `tx`, `ty`, `tz`, `objectId`, `target` |
| `activity` (event) | `recipient`, `sessionId`, `reducer`, `who`, `detail` |

Private tables: `config` (owner, crew identity, crew code), `last_change`, `library_link`, `publish_prop_outbox` and `publish_shot_outbox` (inter-database outboxes), `library_prop` and `public_shot` (the mirrors behind the library views), `voice_call`, and the schedule tables `sweep_timer`, `presence_timer`, `sun_clock`, `title_job` and `layer_timer`.

`Pose` is `lat`, `lon` (WGS84 degrees), `alt` (metres above the ground there), `heading` (degrees clockwise from true north), `pitch` (up positive), `roll` (clockwise positive as the camera sees it) and `f35` (35 mm equivalent on the diagonal).

## Reducers

| Reducer | Caller | Does |
|---|---|---|
| `createSession`, `joinSession` | anyone | Start a session (a random six-letter code), or join one by code as planner or scout |
| `setSessionSpot`, `setPlanTime` | member | Pick the spot; set the set's clock |
| `addPhoto`, `enqueueSolve` | member | Add a photo (queues a solve when the spot is set); re-run with an optional lens hint (8 to 1,200 mm) |
| `deletePhoto` | photo owner or crew | Withdraw a photo |
| `moveCamera`, `setShotSettings` | member | The shot camera's pose; body, lens, exposure, focus, aspect, overlays |
| `placePerson`, `setPersonPose`, `removePerson` | member | People |
| `addSceneObject`, `updateSceneObject`, `deleteSceneObject` | member | Set edits, each recorded as a `scene_change` |
| `lockSceneObject` | member | Take or release the gizmo lock |
| `undoSceneChange`, `restoreSceneTo` | member | Undo anyone's change; restore the set to a point |
| `pushDevicePose` | member | The scout's GPS and compass. Within 8 m of the camera it notifies "`name` reached the spot" |
| `requestPreview` | member | Queue a quick photo-edit preview |
| `postMessage` | member (`web` channel), crew (other channels and outbound) | A message row |
| `scheduleReminder`, `cancelReminder` | member | A one-shot reminder |
| `heartbeat`, `sendSetEvent` | member | Presence; cursors, pings, views and follows (rate-limited) |
| `setSunClock` | member | 0 off, 1 live, up to 3600x time-lapse |
| `shareShot` | member | Give a finished render a share code and publish it to the library |
| `setLayerToggle` | member | Which geodata layers the set shows |
| `addChannelLink`, `removeChannelLink` | member (crew may add invitees) | How a person is reached |
| `restoreToVersion` | member | Fork the set from a text-thread version (v3 becomes v3.1) |
| `deleteSession` | session owner, crew or database owner | Remove a session and its rows |
| `registerCrew` | holder of the crew code | Become the crew identity |
| `joinSessionAsCrew` | crew | Join any session as a participant ("Nemotron") |
| `claimJob`, `reportProgress`, `finishJob` | crew | The solve job lifecycle (60 s lease, renewed by progress) |
| `claimPreview`, `renewPreview`, `finishPreview`, `startRender` | crew | Preview and render jobs (180 s lease) |
| `logAgentStep` | crew | One step of Nemotron's trace |
| `markChannelVerified`, `recordShotVersion`, `updateShotVersion`, `recordCheckin`, `markOutbox` | crew | Photon bookkeeping |
| `upsertSpot` | crew or owner | A spot row from `spots/<id>/spot.json` |
| `setCrewCode`, `setLibrary`, `upgrade` | owner | Setup; `upgrade` re-runs the idempotent setup after a publish |
| `onPublishProp`, `onPublishShot` | the library's reply | Mirror a published prop; mark a shot published |

Lifecycle: `init` (first publish), `onConnect`, `onDisconnect` (marks people offline, drops presence, frees locks).

## Views

| View | Kind | Returns |
|---|---|---|
| `my_sessions` | per user | Sessions I'm in (the home page's list) |
| `my_scene_locks` | per user | Objects whose gizmo I hold |
| `session_card(code)` | anonymous, with an argument | Title, spot, people online and object count for one code |
| `live_sessions` | anonymous | Sessions with someone online, with counts and no codes or titles |
| `spot_library` | anonymous | Spots with a 3D model |
| `shot_library` | anonymous | Finished shots people chose to share |
| `prop_library` | anonymous | Generated props from every session |

## Schedules and procedures

| Name | Kind | Interval | Does |
|---|---|---|---|
| `sweep` | reducer | 10 s | Requeue jobs with an expired lease, up to 3 attempts; an expired render fails |
| `presenceSweep` | reducer | 10 s | Idle after 30 s, gone after 2 minutes, locks freed |
| `sunTick` | reducer | 1 s, per session | Move `session.planTime` at the clock's rate |
| `fireReminder` | reducer | one-shot | A toast plus an `outbox` row the crew sends |
| `titleSession` | procedure | one-shot | Calls NVIDIA Nemotron 3.5 Lightning over HTTP to title an untitled shoot (121 to 126 ms) |
| `refreshLayers` | procedure | 15 min | Open-Meteo weather and NWS alerts for active spots into `layer_snapshot` |

## HTTP routes

Served at `https://maincloud.spacetimedb.com/v1/database/shotmatch/route/...`:

| Route | Does |
|---|---|
| `GET /health` | Counts read in a transaction, for example `{ "ok": true, "sessions": 5, "sceneObjects": 41, "online": 5, "sceneChanges": 50, "libraryLinked": true, "sharedProps": 6 }` |
| `GET /shot?code=<share code>` | Public JSON for a shared shot: image, spot, camera position, heading and lens |
| `POST /hooks/elevenlabs` | The phone agent's post-call webhook. HMAC-SHA256 checked in the module, older than 30 minutes refused, retries ignored; the transcript lands in the session's `message` rows |

The `/health` example is a real response from the night of November 7 to 8, 2026.

## Submodule

The official Rate Limit module (`@spacetimedb/rate-limit`) caps each sender at 40 set events a second and 8 pings per 10 seconds.

## `shotmatch-library`

A second database that every session publishes into.

| Table | Holds |
|---|---|
| `trusted_db` | The database identities allowed to publish |
| `prop` (public) | Generated props, deduplicated by URL, with a count of sessions |
| `shot` (public) | Shared shots |

Reducers: `publishProp` and `publishShot` accept calls only from a database in `trusted_db` (the caller's identity is the calling database). `trustDatabase` and `purgeSource` are for the owner. Calls arrive through the `shotmatch` module's outbox tables: sent only if the sending transaction commits, exactly once and in order, with the result returned to `onPublishProp` or `onPublishShot`.

## Check it yourself

```sh
cd module
npm run check                               # SHA-256 and HMAC against node:crypto
node scripts/proof.ts shotmatch             # filters, views, presence, events, history, HTTP
node scripts/loadtest.ts shotmatch 3 10 30  # 3 clients, 10 Hz, 30 s
scripts/demo.sh shotmatch                   # live SQL over both databases and the HTTP routes
```

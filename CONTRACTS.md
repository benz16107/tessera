# Contracts between the pieces

Read this before touching any folder. Change it only with the lead's agreement, since every piece builds against it.

## Machines and ports (all on linuxbox until the GPU box exists)

| Piece | Where | Port |
|---|---|---|
| SpacetimeDB module `shotmatch` | Maincloud, `wss://maincloud.spacetimedb.com` | n/a |
| crew (Node) | linuxbox | `127.0.0.1:8790`, public at `https://linuxbox.<tailnet>.ts.net:10000` (Tailscale funnel) |
| solver (Python, FastAPI) | linuxbox | `127.0.0.1:8791`, never public |
| web dev server (Vite) | linuxbox | `5173`, proxies `/api`, `/photo`, `/preview` to `8790` |
| lens model (vLLM, later) | GPU box | `LENS_URL` env in crew, OpenAI-compatible |

The crew serves the built web app (`web/dist`) at `/`, so the public URL is one origin.

## Secrets

All in `~/.config/shotmatch/`, mode 600, read at runtime, never committed, never printed, never sent to the browser except `maps_key` through `/api/config` (it is restricted to the Map Tiles API).

`maps_key`, `openai_key`, `gemini_key`, `crew_code` exist now. `nvidia_key`, `photon_*`, `elevenlabs_key` land later; code must start without them and say clearly which feature is off.

## Conventions

- **f35** is the 35 mm-equivalent focal length on the diagonal: `f35 = fpx * 43.2666 / hypot(w, h)`, where `fpx` is the focal length in pixels for an image `w` by `h`. To draw in Cesium: `fpx = f35 * hypot(w, h) / 43.2666`, `hfov = 2 * atan(w / (2 * fpx))`, `vfov = 2 * atan(h / (2 * fpx))`, and `camera.frustum.fov = w >= h ? hfov : vfov` (Cesium's `fov` is the larger dimension's angle). `aspectRatio = w / h`.
- **Pose** (module type): `lat`, `lon` WGS84 degrees; `alt` = metres above the ground at that lat/lon (the client resolves the ground with Cesium `sampleHeightMostDetailed` and adds `alt`); `heading` degrees clockwise from true north; `pitch` degrees, up positive; `roll` degrees, clockwise positive as seen by the camera; `f35` as above.
- **sunAzimuth / sunAltitude** in `requestPreview`: absolute degrees, azimuth clockwise from true north (same frame as `heading`); the crew subtracts the camera heading.
- **Confidence**: `solid` | `check` | `none`, plus a human `reason` string ("1527 matches, 4 m from a mapped camera").
- **Spot ids**: snake_case, `nyc_dumbo` first, `utd_<name>` for the campus spot.

## Spot folders (`spots/<id>/`)

- `spot.json` (in git): `{ "id", "name", "lat", "lon", "radius_m", "cameras", "model_version", "credit_page": true }`
- `CREDITS.tsv` (in git): columns `file  role  title  author  license  page`
- `images/`, `model/`, `test/` (git-ignored): training images, the georegistered model, held-out test photos.

The crew reads every `spots/*/spot.json` at start and calls `upsertSpot`.

## Solver HTTP (`127.0.0.1:8791`)

`POST /solve` with JSON:

```json
{ "photo_path": "/abs/path.jpg", "spot_id": "nyc_dumbo", "f35_range": [20, 40], "exif_f35": 28.0 }
```

`f35_range` and `exif_f35` are optional. The response is NDJSON, one object per line: any number of `{"progress": "matching 20 nearby photos"}` lines, then exactly one final line:

```json
{ "result": { "ok": true, "error": "", "lat": 0, "lon": 0, "alt": 1.6, "heading": 0, "pitch": 0, "roll": 0,
  "f35": 28.7, "fpx": 1234.5, "width": 1280, "height": 960, "inliers": 1527, "confidence": "solid",
  "reason": "...", "nearest_camera_m": 3.2, "secs": 14.8 } }
```

`ok: false` means the solver could not run (missing spot, unreadable file); a photo it ran on but could not place is `ok: true, confidence: "none"`.

`GET /spots` returns the loaded spot ids. `GET /health` returns `ok`.

## Crew HTTP (`127.0.0.1:8790`)

- `GET /api/config` → `{ "spacetimeHost": "wss://maincloud.spacetimedb.com", "dbName": "shotmatch", "mapsKey": "...", "publicUrl": "https://linuxbox.<tailnet>.ts.net:10000" }`
- `POST /api/upload`, raw body, `Content-Type: image/*` (JPEG, PNG, HEIC), max 25 MB → `{ "url": "/photo/<id>.jpg", "path": "<abs path on crew box>", "width", "height", "thumb": "data:image/jpeg;base64,...", "exifF35": number|null, "gpsLat": number|null, "gpsLon": number|null, "nearestSpot": "nyc_dumbo"|null }`. The crew converts HEIC to JPEG, applies EXIF rotation, keeps EXIF GPS and focal (with the digital zoom ratio applied) in its response, and caps the long side at 2048 px. The thumb is at most 320 px, under 40 KB.
- `GET /photo/<file>`, `GET /preview/<file>`: stored images.
- `POST /api/tools/<name>` (voice agent tools, later), guarded by a shared secret header.

Photos live in `data/photos/`, previews in `data/previews/` at the repo root (git-ignored).

## SpacetimeDB module

Source: `module/src/index.ts`; full write-up with line references in `docs/SPACETIME.md`. Generated bindings: `web/src/module_bindings`, `crew/src/module_bindings`, `module/scripts/module_bindings` (`cd module && npm run generate` after any module change, then `npm run publish`; `npm run publish:env` also sets the database environment from `~/.config/shotmatch`). After any publish that appends a column, regenerate and redeploy the crew at once: older bindings fail to decode the changed table.

Row-level security: every session-scoped table reaches only the session's members and the crew identity (the `session_member` table, maintained by the module). Clients keep subscribing with `WHERE session_id = <id>`; they simply receive nothing for sessions they are not in. A page opened by code reads the `session_card(code)` view (`useSessionCard` in `web/src/spacetime`) to show the title, then calls `joinSession`. Event tables (`toast`, `set_event`, `activity`) carry a `recipient` column: the module writes one row per member.

Render results (nvidia): `preview_job` has `kind` ('preview' default, or 'render') and `requestId`. The crew calls `startRender({ sessionId, photoId, requestId, instruction, f35, people, sunAzimuth, sunAltitude })`, which creates the row already `running` with the crew as worker; it finds the row by `requestId`, renews with `renewPreview`, and ends with `finishPreview`. An expired render fails instead of requeueing. `joinSessionAsCrew({ sessionId, name })` makes the crew a participant of any session.

Photon: `channel_link` (`addChannelLink`, `removeChannelLink`, crew `markChannelVerified`; crew `participantId: 0` = invitee), `shot_version` (crew `recordShotVersion`, `updateShotVersion`; anyone `restoreToVersion`, which forks v3 into v3.1 over scene history), `checkin` (crew `recordCheckin`, with a toast).

Shared set extras: `heartbeat` (presence), `sendSetEvent` (cursor, ping, view, follow, unfollow; rate-limited), `setSunClock` (0 off, 1 live, up to 3600x time-lapse of `session.planTime`), `undoSceneChange`, `restoreSceneTo`, `shareShot`. Views: `my_sessions`, `my_scene_locks`, `session_card(code)`, `live_sessions`, `spot_library`, `shot_library`, `prop_library`. HTTP: `GET /health`, `GET /shot?code=`, `POST /hooks/elevenlabs` at `https://maincloud.spacetimedb.com/v1/database/shotmatch/route`.

The crew becomes the worker identity by calling `registerCrew(code)` with `~/.config/shotmatch/crew_code`. Only the crew may `claimJob`, `reportProgress`, `finishJob`, `claimPreview`, `renewPreview`, `finishPreview`, `logAgentStep`, and post `out` messages or non-web channels. Leases last 60 s (180 s for previews) and are renewed by `reportProgress`. The `sweep` schedule requeues expired jobs every 10 s, giving up after 3 attempts.

Web clients call `createSession`, `joinSession`, `addPhoto` (which also queues a solve when `spotId` is set), `enqueueSolve` (optional `lensHintF35`, which the crew turns into `f35_range` [0.75x, 1.33x]), `deletePhoto` (owner or crew), `moveCamera`, `placePerson`, `removePerson`, `setPlanTime`, `pushDevicePose`, `requestPreview`, `postMessage` (channel `web`).

Event table `toast` (`sessionId`, `kind`, `text`, `recipient`): kinds `solve_done`, `solve_failed`, `job_reclaimed`, `scout_arrived`, `preview_done`, `preview_failed`, `render_done`, `render_failed`, `lock_released`, `titled`, `shot_shared`, `share_failed`, `prop_shared`, `library_failed`, `voice_call`, `version_forked`, `checkin`.

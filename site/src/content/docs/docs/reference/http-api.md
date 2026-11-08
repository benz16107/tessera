---
title: HTTP API
description: Every HTTP route the crew serves on the app's public address, plus the solver's private API, with requests and responses.
---

The crew serves the web app and these routes at https://104-238-146-229.sslip.io (Caddy on the Vultr VM, to the crew on `127.0.0.1:8790`). The solver listens on `127.0.0.1:8791` and is never public. The SpacetimeDB module's own routes are in [SpacetimeDB reference](/docs/reference/spacetimedb/#http-routes).

Conventions:

- `sessionId` is the session's numeric id as a string, for example `"18"`. Photon routes name the session by its six-letter share code instead.
- Errors are `{ "error": "..." }` with a 4xx or 5xx status. An unknown `/api/` path is `404 { "error": "no such endpoint" }`.
- **Access.** Most routes have no login: they act on a session the caller already knows the id or code of, and the database's row-level security still decides who sees which rows. Two routes are guarded: `/api/tools/<name>` needs the `x-shotmatch-tool-secret` header, and `/api/voice/ended` needs a valid `ElevenLabs-Signature`. Photon writes name the session by its share code, the same capability the app joins with, so a numeric id alone can't make the crew message anyone.

## App and files

### `GET /api/config`

What the browser needs to connect.

```json
{ "spacetimeHost": "wss://maincloud.spacetimedb.com", "dbName": "shotmatch", "mapsKey": "...", "publicUrl": "https://104-238-146-229.sslip.io" }
```

`mapsKey` is the browser key for Google's Map Tiles API, restricted to that API. It is the only key ever sent to a browser.

### `POST /api/upload`

Raw image body with `Content-Type` `image/jpeg`, `image/png`, `image/heic`, `image/heif` or `image/webp`, at most 25 MB.

```json
{ "url": "/photo/<id>.jpg", "path": "<path on the crew box>", "width": 1280, "height": 1707,
  "thumb": "data:image/jpeg;base64,...", "exifF35": null, "gpsLat": null, "gpsLon": null, "nearestSpot": null }
```

The crew converts HEIC to JPEG, applies the EXIF rotation, caps the long side at 2048 px and makes a thumbnail of at most 320 px, under 40 KB. `exifF35` has the digital zoom ratio applied. `exifF35`, `gpsLat`, `gpsLon` and `nearestSpot` are `null` when missing. Errors: 405, 413 ("photo is larger than 25 MB"), 415 (wrong type), 400 (unreadable).

### Files

| Route | Serves |
|---|---|
| `GET /photo/<file>`, `GET /preview/<file>` | Uploaded photos and renders, from disk or Vultr Object Storage |
| `GET /spot-photo/<spot>/<file>` | A spot's training photo, for similar-photo results (credited on [the credits page](/credits/)) |
| `GET /asset/<id>.glb` | A generated prop (`<id>` is 16 hex characters) |
| `GET /sheet/<code>` | The designed call sheet page for a set, once one has been written |

## Set commands (NVIDIA)

### `POST /api/set/command`

The stable entry point for words: the studio's command bar, Simple's presets, the text threads and the phone call all use it.

```json
{ "sessionId": "18", "text": "move the bike to the left", "offline": false }
```

```json
{ "reply": "The red vintage bike is now at frame_x -0.6, 5 m from the camera.", "intent": "edit",
  "model": "nvidia/nemotron-3.5-lightning-30b-a3b", "offline": false, "ms": 2191, "routeMs": 303,
  "steps": [{ "tool": "move_object", "args": "{\"id\":9,\"frame_x\":-0.6}", "result": "{\"moved\":\"9\"}", "ms": 68 }], "data": null }
```

`intent` is `edit`, `question`, `rebuild`, `call_sheet`, `route`, `critique`, `refused` or `error`. `data` carries the call sheet or the cuOpt route for those intents. It takes 1 to 15 s (Nemotron Super with reasoning), up to about 90 s offline. `offline: true` runs Nemotron 3.5 Bolt on the VM's CPU.

### Other set routes

| Route | Body or query | Does |
|---|---|---|
| `POST /api/set/apply` | `{ sessionId, steps: [{ tool, args }] }` | Runs a list of set tool calls, such as an art director fix |
| `POST /api/set/read` | `{ sessionId, force }` | Reads the photo again: objects with boxes, and the light |
| `POST /api/set/rebuild` | `{ sessionId, replace }` | Places stand-ins for the people, vehicles and props found in the photo |
| `GET /api/set/light` | `?session=` | Nemotron's light read, the matching 3D sun (`sun.azimuth`, `sun.altitude`, `null` when overcast) and shadow softness |
| `POST /api/set/critique` | `{ sessionId, imageUrl }` | The art director: `{ summary, strengths, fixes: [{ title, why, steps: [{ tool, args }] }] }` |
| `POST /api/set/check` | `{ sessionId, imageUrl }` | The physics check alone |
| `POST /api/set/callsheet` | `{ sessionId }` | Writes the call sheet |
| `GET /api/route` | `?session=<id>&shots=<a,b>` | The cuOpt shoot-day walking route |
| `GET /api/nvidia/models` | | Every NVIDIA model in use, with its job and live median latency |

### `POST /api/props/generate`

```json
{ "sessionId": "18", "mode": "auto", "prompt": "a red vintage bicycle", "label": "my bike",
  "mount": "ground", "frame_x": -0.8, "distance_m": 6, "facing": "camera", "height_m": 1.0, "place": true }
```

Give a `prompt`, an `image` (data URL) or an `imageUrl`. `mode` is `auto`, `text3d`, `image3d`, `photo3d` or `flat`; `auto` picks `photo3d` for an image and `image3d` for words. `mount` is `ground`, `wall`, `stand` or `screen`. `facing` is `camera`, `away`, `left`, `right` or degrees. `name` works as an alias for `label`. `place: false` returns the asset without adding a row.

```json
{ "mode": "text3d", "name": "my bike", "asset": { "id": "...", "url": "/asset/<id>.glb", "bytes": 0, "cached": false },
  "dims": { "length_m": 0, "width_m": 0, "height_m": 0, "source": "..." }, "conceptUrl": "...", "description": "...",
  "object": { "id": "...", "name": "my bike" }, "fallback": "...", "ran": [], "ms": 0 }
```

From about 1 s (a flat image from a photo) to about 3 minutes (TRELLIS retrying).

### `POST /api/render`

Multipart. Fields: `beauty` (PNG RGBA, required), `shadow`, `depth`, `mask`, `sessionId`, `photoId`, `text`, `mode` (`depth`, `canny` or `composite`), `strength` (0.1 to 0.9, default 0.45), `iso`, and either `f35`, `aperture`, `focusM`, `sunAzimuth`, `sunAltitude` or a `settings` JSON holding them.

```json
{ "url": "/preview/...", "compositeUrl": "/preview/...", "model": "...", "fallback": "...", "prompt": "...",
  "label": "AI interpretation", "strength": 0.7, "rerendered": true,
  "checks": [{ "round": 1, "pass": false, "summary": "...", "objects": [{ "name": "...", "light": true, "shadow": true, "scale": false, "color": true, "note": "..." }] }],
  "sunFix": { "azimuth": 0, "altitude": 0, "why": "..." }, "jobId": "...", "ms": 29000 }
```

The result is also a `preview_job` row with `kind = 'render'`. See [The render pass](/docs/how-it-works/render/).

### Voice

| Route | Does |
|---|---|
| `POST /api/voice/transcribe` | Audio as the body. Parakeet transcribes it. `?session=<id>&run=1` runs the transcript as a set command; `&speak=1` adds Magpie audio as a data URL |
| `POST /api/voice/speak` | `{ text }`, returns `audio/wav` from Magpie |

## Search

| Route | Does |
|---|---|
| `GET /api/search?q=&session=` | Nemotron embeddings plus the VL reranker over the asset library, the session's messages and the spots |
| `GET /api/assets/search?q=` | The asset library only (up to 8 results) |
| `GET /api/similar?photo=/photo/<file>` or `?q=<words>` | Similar shots among a spot's photos (Llama Nemotron Embed VL). Optional `k` (1 to 24, default 6) and `spot` |

## Geodata

### `GET /api/layers`

`?session=<id>`, `?spot=<id>` or `?lat=&lon=`, with optional `&layers=weather,tides` and `&at=<ISO time>`. A session defaults to the set's shared clock.

```json
{ "place": { "id": "nyc_dumbo", "name": "...", "lat": 0, "lon": 0, "radiusM": 0, "zone": "..." }, "at": "...", "nyc": true,
  "layers": { "<layer>": { "type": "FeatureCollection", "features": [] } },
  "summary": { "<layer>": {} }, "sources": [{ "layer": "...", "name": "...", "url": "...", "license": "...", "fetchedAt": "...", "stale": false, "error": "" }],
  "errors": { "<layer>": "still loading; ask again in a minute" }, "conditions": { "text": "..." }, "ms": 348 }
```

Features are GeoJSON in WGS84. Layer ids are listed in [Live geodata](/docs/how-it-works/geodata/). An unknown layer is a 400 that lists the known ones.

### `GET /api/layers/conditions`

Same query. Returns the one-paragraph conditions summary alone.

## Photon

| Route | Body or query | Does |
|---|---|---|
| `GET /api/photon/status` | | `{ enabled, api, channels: [{ channel, label, handle }], note }` |
| `POST /api/photon/invite` | `{ code, name, channel, address, by }` | Invites a person on `imessage`, `telegram`, `sms`, `whatsapp`, `email` or `voice` |
| `POST /api/photon/claim` | `{ token, participantId }` | Links an invite to the participant who opened it (the scout page calls it) |
| `POST /api/photon/callsheet` | `{ code }` | Writes the call sheet and sends it to everyone: `{ url, shots, sent }` |
| `GET /api/photon/people` | `?code=` | People on channels and the version count |

## Phone call (guarded)

| Route | Guard | Does |
|---|---|---|
| `POST /api/tools/<name>` | `x-shotmatch-tool-secret` header | The voice agent's tools: `get_plan`, `guide_me`, `edit_set` (`scout_status` and `distance_to_mark` are aliases of `guide_me`). The body names the caller (`caller`), or a `session_code` or `session_id`. Returns `{ say, ... }` |
| `POST /api/voice/ended` | `ElevenLabs-Signature` | The older post-call path; the live webhook now goes to the module's `/hooks/elevenlabs` |

## Solver

Private, on `127.0.0.1:8791`. The crew is its only caller.

### `POST /solve`

```json
{ "photo_path": "/abs/path.jpg", "spot_id": "nyc_dumbo", "f35_range": [20, 40], "exif_f35": 28.0 }
```

`f35_range` and `exif_f35` are optional. The response is NDJSON: any number of progress lines, then one result line.

```json
{"progress": "matching 20 nearby photos"}
{"result": {"ok": true, "error": "", "lat": 0, "lon": 0, "alt": 1.6, "heading": 0, "pitch": 0, "roll": 0,
  "f35": 28.7, "fpx": 1234.5, "width": 1280, "height": 960, "inliers": 1527, "confidence": "solid",
  "reason": "...", "nearest_camera_m": 3.2, "secs": 14.8}}
```

`ok: false` means the solver could not run (a missing spot, an unreadable file). A photo it ran on but could not place is `ok: true, confidence: "none"`. Confidence rules: [Solve](/docs/how-it-works/solve/#confidence).

### `GET /spots`, `GET /health`

The loaded spot ids, and `ok`.

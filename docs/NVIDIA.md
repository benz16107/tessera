# NVIDIA in ShotMatch

ShotMatch turns a photo of a place into a shared virtual set: the spot as a 3D world, the user's people, props, lights and cameras as rows in SpacetimeDB, and an AI render that puts those objects into the user's own photo. NVIDIA models do the work between the words and the set: they read the photo, place objects from a sentence, generate props, render, check the render's physics, plan the shoot, listen and speak. This page lists every NVIDIA model and API we call, what it does, how fast it was, and what did not work.

All numbers here were measured on Saturday Nov 7, 2026 from our Vultr VM (Dallas) against the hosted APIs, unless a row says otherwise. Code: `crew/src/` (Node). Model ids live in one place, `crew/src/config.ts`.

## Why Nemotron

- **Open weights.** We can fine-tune and self-host. The lens reader is a LoRA fine-tune served with vLLM on our own GPU (`lens/`), and Nemotron 3.5 Bolt runs on the Vultr VM's CPU through Ollama. When a model runs on our box, the user's photo and words stay on our box.
- **One family from edge to datacenter.** Bolt E4B (our VM's CPU), Lightning 30B-A3B (the fast path), Super VL 120B-A12B (planning and vision). The tiers take the same messages and the same tool definitions, so moving a job between them is a one-line change, and so is falling back when one is down.
- **A reasoning switch per call.** `chat_template_kwargs.enable_thinking` turns reasoning on for planning a set, the art director, the call sheet and the render's physics check, and off for routing, reads and quick replies. Reasoning on costs about 4.5 s on a set plan (5.78 s against 1.27 s, table below).
- **Vision.** Super VL reads the user's photo (people, vehicles and props with boxes), reads its light, and critiques renders.
- **Tool calling.** OpenAI-style tool calls work on all three tiers (checked: Lightning, Super with and without reasoning, Bolt hosted).
- **License.** The Nemotron models are released under NVIDIA's open model license, which allows commercial use and derivative models such as our LoRA.
- **NVIDIA models on Vultr.** Vultr Serverless Inference hosts Nemotron 3.5 Content Safety (our primary safety path; the same id 404s on build.nvidia.com for our key) and Nemotron 3 Nano Omni. Our crew, solver and Ollama run on a Vultr VM.

## Every NVIDIA model and API we use

Median latency is from `crew/scripts/latency.ts` (5 runs each) where the job matches, otherwise from the crew's live ledger (`GET /api/nvidia/models`, the studio's "Powered by NVIDIA" list).

| Model | Where | What it does in ShotMatch | Measured | Status |
|---|---|---|---|---|
| Nemotron 3.5 Super VL 120B-A12B (`nvidia/nemotron-3.5-super-vl-120b-a12b`) | NVIDIA API Catalog | Plans set compositions with reasoning on and calls set tools; reads the photo (objects with boxes) and its light; art director; call sheet; render physics check; real-world sizes for generated props; the iMessage and Telegram agent; upload policy check | Set plan 1.27 s (reasoning off), 5.78 s (on). Light read 2.2 s, photo read 5 to 6 s, render check 3.9 to 5.5 s, art director 21.6 s | Works |
| Nemotron 3.5 Lightning 30B-A3B (`nvidia/nemotron-3.5-lightning-30b-a3b`) | NVIDIA API Catalog | Routes every command (intent, and whether to escalate to Super); quick replies; one-object edits; voice turns | Route 0.23 s; one-object edit plan 0.73 s; "what lens am I on?" answered end to end in 0.76 s | Works |
| Nemotron 3.5 Bolt E4B (`nemotron-3.5-bolt:e4b` on Ollama, `nvidia/nemotron-3.5-bolt-e4b` hosted) | Ollama on the Vultr VM CPU (12 vCPU), hosted copy as backup | Offline command parser: writes the same tool calls as JSON when the hosted API is slow or down | Route 1.67 s on CPU, 0.28 s hosted; a full offline set command 30.8 s on CPU (prompt processing runs about 44 tokens a second) | Works |
| Nemotron 3.5 Content Safety (`nemotron-3.5-content-safety`) | Vultr Serverless Inference (primary); build.nvidia.com id retried every 10 minutes | Screens every upload (image and text) and every typed or spoken command | 0.51 s on text, 1.9 s with an image | Works on Vultr; 404 on build.nvidia.com |
| Nemotron 3 Nano Omni 30B-A3B reasoning (`nemotron-3-nano-omni-30b-a3b-reasoning`) | Vultr Serverless Inference and NVIDIA API Catalog | Second physics checker while Cosmos Reason2 is unavailable; speech-to-text fallback for voice notes | 1.2 s on a render check with reasoning off (with it on, it once spent its budget and answered nothing) | Works |
| Nemotron 3.5 Embed 1B (`nvidia/nemotron-3.5-embed-1b`) | NVIDIA API Catalog | Semantic search over the asset library, the session's messages and the mapped spots | 58 ms a text | Works one text per request (batches of different texts return 500) |
| Llama Nemotron Rerank VL 1B v2 (`nvidia/llama-nemotron-rerank-vl-1b-v2`) | NVIDIA API Catalog | Reorders the top 12 search hits | 0.21 s | Works ("something to sit on in a park" puts Park bench first) |
| Llama Nemotron Embed VL 1B v2 (`nvidia/llama-nemotron-embed-vl-1b-v2`) | NVIDIA API Catalog | Similar-shot search over each spot's photos (image and text share one space) | | Works (from the first build) |
| TRELLIS (`microsoft/trellis`) | NVIDIA API Catalog | Words to a 3D prop (GLB) placed in the set | 10 s when it answers | Partial: text mode works but returned HTTP 500 on about half of tonight's calls; image mode accepts only TRELLIS's own example images (HTTP 422 "example_id") |
| FLUX.1-dev (`black-forest-labs/flux.1-dev`) | NVIDIA API Catalog | Concept images for 3D props and posters (base mode); the render pass (depth or canny mode) | | Blocked tonight: base mode returned HTTP 500 on every call; depth and canny accept only example images (HTTP 422). The fallbacks below ran instead |
| Parakeet CTC 1.1B (`nvidia/parakeet-ctc-1.1b-asr`, Riva ASR) | NVIDIA NVCF over gRPC, function id `1598d209-...` | Hold-to-talk set commands in the studio; Telegram and iMessage voice notes | 0.6 to 1.0 s for a 4 s clip; transcribed Magpie's own sentence word for word | Works |
| Magpie TTS Multilingual (`nvidia/magpie-tts-multilingual`, Riva TTS) | NVIDIA NVCF over gRPC, function id `877104f7-...` | Spoken replies in the studio voice mode | 0.8 to 1.1 s for one sentence | Works |
| cuOpt (`optimize.api.nvidia.com/v1/nvidia/cuopt`) | NVIDIA API Catalog | Shoot-day walking route with light time windows; a tool of the set agent and the text agent | 58 s on the first call (from the first build) | Works |
| Cosmos Reason2 8B (`nvidia/cosmos-reason2-8b`) | NVIDIA API Catalog | Physical plausibility of renders, when it answers | | Blocked: listed but 404 for our key; retried every 10 minutes, Nano Omni answers meanwhile |
| Nemotron Nano 12B v2 VL + our LoRA (`shotmatch-lens`) | vLLM on our GPU (Brev A100), `LENS_URL` in the crew through an ssh tunnel | Reads the lens of any photo. Reads of 70 mm or more narrow the solver's focal search (0.45x to 2.2x); shorter reads are advisory, because the model is strong on long lenses (67% telephoto recall on held-out landmarks) and weak on normal ones (9% recall for 35 to 70 mm) | 0.6 to 1.2 s a read | Works with its training prompt (55.6% bin accuracy, against 44.0% with our zero-shot prompt; long-lens recall 72% against 48% for OpenAI and 13% for the base Nano). Results in `lens/RESULTS.md` |

Fallbacks that are not NVIDIA models, named wherever they run: Qwen-Image 2.1 on Vultr (image edit and image generation when FLUX fails), OpenAI gpt-image-2 (last image-edit fallback), Whisper large v3 turbo on Vultr (last speech-to-text fallback), ElevenLabs (the phone call's voice agent).

## Beyond a chatbot: the workflows

Every step below writes an `agent_step` row in SpacetimeDB, so the studio shows Nemotron's trace live while it works.

### 1. Text to set
"two friends walking toward camera, a red vintage bike on the left wall, warm string lights" becomes scene objects:
1. Nemotron Content Safety (Vultr) screens the text while Lightning routes it (in parallel, 0.5 s and 0.3 s).
2. Lightning calls it a composition, so Super plans it with reasoning on and calls the set tools: `add_people {count 2, pose walk, frame_x 0, distance_m 5, facing camera}`, `add_prop {bike, frame_x -0.85, color red}`, `add_lights {point, 12, 2500 K, frame_x -1 to 1, 3 m high}`.
3. The tools turn "where in the frame, how far from the camera" into metres east, north and up through the shot camera (`crew/src/setgeo.ts`, tested), face people toward the camera, aim the lights at the subject, and write `scene_object` rows as the crew identity.

Measured: 6.6 s and 13.1 s for that sentence (two runs, 16 rows placed each time). "move the bike a little closer" stays on Lightning (2.2 s). The prompt includes where the ground enters the frame and the distance at which a person fills the frame, so people are not placed with their feet cut off.

### 2. Rebuild the scene from the photo
On every solve, Super VL lists the people, vehicles and props in the user's photo with image boxes. Each box's bottom edge is back-projected through the solved camera onto the ground plane, its height estimated from the box, and a stand-in placed there. On the DUMBO photo: 10 vehicles, a street lamp and a yellow umbrella placed in 5.8 s. It runs automatically when the set is empty, and on "rebuild the scene from the photo".

### 3. The render checks its own physics
The studio renders only the user's objects from the shot camera (beauty, depth, mask, and a shadow-only pass), with its 3D sun set from Nemotron's light read (`GET /api/set/light`). Then:
1. **Composite** (`crew/src/composite.ts`, tested): the shadow pass is multiplied into the photo, blurred and darkened to the photo's shadow hardness from the light read; the objects' exposure and white balance move part of the way toward the photo around them (each object keeps its own colour), and grain is added.
2. **Harmonize:** the generator's output is blended in only over the objects and their contact areas, at a strength (0.45 by default). Outside that mask the user's photo is untouched pixel for pixel, so the scene stays put.
3. **Verify:** Super VL, reasoning on, checks each placed object: light direction, shadow direction and softness, scale next to doors, cars and people, colour and grain. Nano Omni (standing in for Cosmos Reason2) checks physics alongside.
4. **Fix:** on a fail, the crew raises or lowers the strength, or adds words to the prompt, and renders once more. If the 3D sun is on the wrong side of the light read, the result carries a `sunFix` (azimuth and altitude) for the studio.

Measured on the public URL (test session, Qwen-Image as the generator because FLUX refused): composite 0.6 s; check 1 failed in 3.9 s ("lit from a low side angle while the real scene is flat overcast"); strength raised to 0.70 and re-rendered; check 2 in 5.5 s; Nano Omni's second opinion in 1.2 s (it called our crude test object "disproportionately large compared to the surrounding buildings"); 29 s in total.

Placeholders become real. Grey mannequins and low-poly stand-in props are placeholders. Each one gets its own mask from the studio's object-ID layer and a prompt built from its row ("the grey mannequin in the centre, about 7 m from the camera, becomes a real person, walking, about 1.72 m tall, casual clothes that suit a cloudy late autumn golden hour, lit by soft overcast light, facing the camera"). Its padded crop is edited on its own and tone-matched at the border. The user's photo is a clean backplate, because the mannequin was never in it, so wherever the mannequin stood the photo comes back first. Then only the new subject is pasted, fully opaque. Its silhouette comes from Nemotron's box around it plus a second edit that turns everything but the subject flat green, keyed out, with the contact shadow under its feet kept. No background the model redrew remains. When over 35% of a mannequin comes back unchanged, the crop is edited again. The physics check also asks whether any person still looks like a mannequin, a statue or a 3D model, or is see-through; a flagged object gets one more edit, and the render keeps whichever round scored better. Before and after on the A9TVAN photo, one and two people: `web/screenshots/render-people-*.png` (24 to 60 s each, Qwen-Image doing the edits).

### 4. Generation into the set
`POST /api/props/generate` ends every mode as a `scene_object` at real-world size:
- **words to 3D:** TRELLIS text mode;
- **words, concept image, 3D:** FLUX makes a product-style concept image, Super VL describes it for a modeller, TRELLIS builds from that description (TRELLIS's hosted image mode refuses user images, so images reach 3D through Nemotron's description). When FLUX fails, TRELLIS text mode runs and the step log says so;
- **photo to 3D:** Super VL finds the object's box in a photo (a texted bike, an outfit), crops to it, describes it and gives its real size, then TRELLIS;
- **flat image:** any image (generated or uploaded) becomes a textured plane GLB at real size: a poster on a wall, a sign on a stand, a screen;
- **voice:** Parakeet's transcript goes to the same agent, which calls `generate_prop` or `add_image`.

Real size: Super gives the object's height, length and width in metres (a sedan from a photo: 4.6 x 1.85 x 1.45 m); the row's `h` param carries the height, and the studio scales the GLB to it and stands it on the ground. When TRELLIS fails, a photo or concept image is placed as a flat cut-out at real size instead of failing. Steps logged: `concept_image`, `object_read`, `trellis`, `real_scale`, `place`.

### 5. Art director
After a render (or on the plain composite), Super VL critiques the composition (thirds, leading lines, subject placement and separation, horizon) and returns two or three fixes, each a list of set tool calls the studio applies with one click (`POST /api/set/apply`). Measured: 21.6 s with reasoning on.

### 6. Call sheet and route
Super writes a call sheet (shots, lenses, apertures, call and wrap times) with every time inside the real golden and blue hour windows at the spot; cuOpt orders the walk between viewpoints. On the test session: 5 shots from 6:20 to 7:10 AM, call 5:45 AM, inside Sunday's 6:06 to 7:15 AM windows. The call sheet and the art director both read the geo thread's live conditions (`crew/src/layers`): weather, sunrise and sunset colour chance, tide, NWS alerts, permits and scaffolding near the mark, and building shadow on the street. Shot notes then plan around them; on Sunday's sheet these were the poor sunrise colour chance (20 of 100), the 7:32 AM high tide, the street in shadow until 11:10 AM and the sidewalk shed at 30 Washington St. The set agent also has a `conditions` tool, and questions about weather, colour, tide, permits or shade answer from it.

### 7. Voice
Hold-to-talk in the studio records audio; Parakeet transcribes it (0.6 to 1 s); the transcript runs as a set command; Magpie speaks the reply when voice mode is on. Telegram and iMessage voice notes go through the same Parakeet path (Nano Omni and Whisper as fallbacks). The phone call keeps ElevenLabs. A LiveKit agent could swap in Parakeet and Magpie: LiveKit Agents takes pluggable speech-to-text and text-to-speech, so a plugin calling the same two Riva gRPC functions (the function ids in `crew/src/config.ts`) replaces ElevenLabs' recognition and voice, and the agent's tool calls `POST /api/set/command`.

### 8. Offline
With `offline: true`, or whenever the hosted router or planner fails, Bolt on the VM's CPU writes the edits as JSON and the same tools run them. "add a park bench on the right and one person sitting on it" placed the bench and a sitting person in 30.8 s with no hosted model in the loop.

### 9. Search and safety
Nemotron embeddings plus the VL reranker search the asset library (including props generated earlier in the session), the session's messages and the spots (`GET /api/search?q=&session=`). Every upload, command, prop prompt and render instruction passes Nemotron Content Safety first.

## HTTP contracts

The crew serves these on the public URL (`https://104-238-146-229.sslip.io`). `sessionId` is the session's numeric id as a string. Errors are `{ "error": "..." }` with a 4xx or 5xx status. The studio's panels in `web/src/nvidia/` and the Photon thread use them.

### `POST /api/set/command` (stable; the phone agent and text threads call it)
Request: `{ "sessionId": "18", "text": "move the bike to the left", "offline": false }`
Response:
```json
{ "reply": "The red vintage bike is now at frame_x -0.6, 5 m from the camera.", "intent": "edit", "model": "nvidia/nemotron-3.5-lightning-30b-a3b",
  "offline": false, "ms": 2191, "routeMs": 303,
  "steps": [{ "tool": "move_object", "args": "{\"id\":9,\"frame_x\":-0.6}", "result": "{\"moved\":\"9\",...}", "ms": 68 }], "data": null }
```
`intent` is `edit | question | rebuild | call_sheet | route | critique | refused | error`. `data` carries the call sheet or cuOpt route for those intents. The call can take 1 to 15 s (Super with reasoning), up to about 90 s offline.

### `POST /api/props/generate`
Request: `{ "sessionId": "18", "mode": "auto | text3d | image3d | photo3d | flat", "prompt": "a red vintage bicycle", "image": "data:image/jpeg;base64,...", "imageUrl": "/photo/<file>.jpg", "label": "my bike" (alias "name"), "mount": "ground | wall | stand | screen", "frame_x": -0.8, "distance_m": 6, "facing": "camera | away | left | right | <degrees>", "height_m": 1.0, "width_m": 0.6, "place": true }`.
Give a prompt, an image or an imageUrl. `auto` picks `photo3d` for an image and `image3d` for words. `place: false` returns the asset without adding a row (the studio places it itself).
Response: `{ "mode", "name", "asset": { "id", "url": "/asset/<id>.glb", "bytes", "cached" }, "dims": { "length_m", "width_m", "height_m", "source" }, "conceptUrl", "description", "object": { "id", "name" }, "fallback", "ran": [...], "ms" }`. It takes 1 s (flat from a photo) to about 3 minutes (TRELLIS retrying).

### `POST /api/render` (multipart, asynchronous)
Fields: `beauty` (PNG RGBA, required), `shadow` (PNG, alpha = shadow; or greyscale, black = shadow), `mask` (object-ID layer, flat colours) and `legend` (JSON `[{id, name, kind, color}]`, which turns placeholders into real subjects), `depth`, `sessionId`, `photoId`, `text`, `mode` (`depth | canny | composite`), `strength` (0.1 to 0.9), `iso`, and either flat `f35`, `aperture`, `focusM`, `sunAzimuth`, `sunAltitude` or a `settings` JSON holding them.
- `mode=composite` answers 200 at once with the result (under a second).
- Any other mode answers **202** at once: `{ "requestId": "<16 hex>", "state": "running", "poll": "/api/render/<requestId>" }`. The render runs in the background (about 20 s for one person, 35 to 45 s for two, up to about 2 minutes for a busy set), so no request stays open.
- `GET /api/render/<requestId>` returns `{ "state": "running" | "done" | "failed", "seconds", "result", "error" }` and keeps answering after a crew restart (the finished state is saved in `data/renders/`). `web/src/nvidia/RenderPanel.tsx` `postLayers()` polls every 2.5 s and resolves with `result`, so its callers (RenderPanel, ArtDirector, Simple mode) did not change.
- `result`: `{ "url", "compositeUrl", "model", "fallback", "prompt", "label": "AI interpretation", "strength", "rerendered", "placeholders", "checks": [{ "round", "pass", "summary", "placeholders", "objects": [{ "name", "light", "shadow", "scale", "color", "note" }] }], "sunFix": { "azimuth", "altitude", "why" }, "jobId", "ms" }`. The `preview_job` row (`kind = 'render'`) gets the image too, and every step is an agent_step row.
- The studio's physical camera is baked into the final image (`crew/src/lens.ts`, a port of `web/src/studio/post/LensEffects.ts`) when `settings.camera` is sent, in the viewport's order: centre crop when the lens is longer than the photo (`photoF35`), depth of field from `sceneDepth` (PNG, 8-bit inverse depth, white = `sceneNearM`, black = `sceneFarM`, rendered from the studio's own massing, never tiles) with the shot's `focalMm`, `aperture` and `focusM`, the same 48-tap aperture-shaped gather and Airy floor; handheld shake (`shakePx` along `shakeDir`); the aperture's blade polygon (`polyAmt`) and cat-eye (`catEye`) in the depth-of-field gather; lensfun distortion (`distortionPoly`, `unitMm`) and lateral chromatic aberration (`tca`); vignetting when `vignette` is on (the lensfun pa model from `vig` and `vigUnitMm`, else cos^4 times optical vignetting `optVig`); starbursts on the projected point `lights` (`spikes`, `starAmt`); exposure (`exposureStops`), white balance and tint (`wbGains`, linear light); sensor noise (`noiseSigma`). The checks judge the frame before the bake. About 5 to 9 s on the VM; logged as a "camera" step.
- At most 4 placeholders are edited per render (people first, then the largest); the edits run in parallel; a second round runs only for the objects the check flagged, and only when the first round took under 60 s.

### Others
- `GET /api/set/light?session=` returns Nemotron's light read, the 3D sun that matches it (`sun.azimuth`, `sun.altitude`, null for overcast) and shadow softness.
- Plan time words (`set_time`): "sunset", "dusk", "golden hour this evening" and "blue hour after sunset" pick the evening window; "sunrise", "dawn" and "morning" the morning one; a bare "golden hour" or "blue hour" the next one from now. The time set is the middle of that window.
- `POST /api/set/read {sessionId, force}` reads the photo again (objects and light); `POST /api/set/rebuild {sessionId, replace}` places stand-ins.
- `POST /api/set/critique {sessionId, imageUrl}` returns `{ summary, strengths, fixes: [{ title, why, steps: [{ tool, args }] }] }`; `POST /api/set/apply {sessionId, steps}` runs them.
- `POST /api/set/callsheet {sessionId}`; `POST /api/set/check {sessionId, imageUrl}` (physics only).
- `POST /api/voice/transcribe` with the audio as the body; `?session=<id>&run=1` runs the transcript as a set command, `&speak=1` adds Magpie audio as a data URL. `POST /api/voice/speak {text}` returns `audio/wav`.
- `GET /api/search?q=&session=`, `GET /api/assets/search?q=`.
- `GET /api/nvidia/models` returns this table's models and live latency.
- `GET /asset/<id>.glb` serves generated props; `GET /splat/<spot>.<ext>` serves Gaussian splats.

## Restarts

A deploy restarts the crew without dropping work. On SIGTERM it stops claiming jobs, answers new renders, generations and set commands with 503 and Retry-After: 30, waits up to 150 s for the ones in flight (systemd allows 180 s), then exits. `ops/deploy-vultr.sh` prints "waiting for N in-flight jobs" while it drains. Tested: a render started before a deploy finished with HTTP 200, and a new generation request during the drain got the 503.

## What did not work, and what we did instead

- **Content Safety on build.nvidia.com** 404s for our key. Vultr hosts the same model, so it is the primary path; the NVIDIA copy is retried every 10 minutes.
- **Cosmos Reason2** 404s ("function not found"). Nano Omni does the second physics check; Cosmos is retried every 10 minutes.
- **FLUX.1-dev** returned HTTP 500 on every base-mode call tonight, and its depth and canny modes (like FLUX.1 Kontext, FLUX.2 klein and TRELLIS image mode) accept only the endpoint's own example images (HTTP 422 "Expected: example_id"). The render pass blends Qwen-Image 2.1 on Vultr instead, through the same mask; concept images fall back to TRELLIS text mode; posters use Qwen-Image. Each result names the model that ran.
- **TRELLIS text mode** answers in about 10 s, but about half of tonight's calls returned HTTP 500 after 60 to 90 s. Calls retry once; then a photo or concept image becomes a flat cut-out, and a words-only request in the agent gets the closest library prop. All of this is logged.
- **Nemotron Embed 1B** returns HTTP 500 for a batch of texts of different lengths, so the crew sends one text per request, six at a time.
- **Bolt on CPU** reasons by default and processes prompts at about 44 tokens a second, so the offline path sends a short prompt with thinking off.

# ShotMatch build plan (HackUTD 2026 "Zero Day")

Written Sat Nov 7, 2026, updated 5 PM CT with the option 1 test. Scope source: `~/Code/scratch/shotmatch-test/PLAN.md` on linuxbox. Evidence:
- Google tiles test: `~/Code/scratch/shotmatch-test/FEASIBILITY.md` and `results/evidence_reviewed.jpg`
- Open SfM test (option 1): `~/Code/scratch/shotmatch-sfm/REPORT.md` and `heldout_topdown.png`

Every line of code in this repo is written in this repo. The scratch scripts are reference only, and nothing is copied from them. Downloaded Commons images and `ATTRIBUTION.tsv` are data, not code, so `spots/nyc_dumbo` reuses them and rebuilds the model with this repo's scripts. `lens/` re-pulls its own dataset with a fresh script.

ShotMatch is still one of two candidates. The other is the iMessage coding agent.

## Decided: option 1

Google's 3D tiles are display only, with the logo and credits on screen. The solver localizes against an open structure-from-motion model of each spot and never sees a tile. Previews edit the user's own photo. This keeps us inside the Map Tiles policy, which bans image analysis of tiles and content derived from them.

The scope thread tested it on NYC DUMBO (Manhattan Bridge from Washington St):
- **Model:** 155 Creative Commons training photos, 128 registered, 16,362 points, 1.30 px mean reprojection error. Georegistered with EXIF GPS: 35 of 68 GPS photos fit within 15 m, median residual 7.3 m.
- **Held-out photos:** 10 of 11 landed within 24 m of their EXIF GPS (median 13 m, mostly phone GPS noise). Re-localizing registered photos against their own poses gave 0.09, 0.42 and 1.2 m, plus one 17 m slide along the line of sight.
- **Lens:** median focal error 3%, within 6% on 8 of 10.
- **Heading:** median 14.5 degrees from noisy phone compasses.
- **The one failure** (500 m off) had 78 inliers. Every good result had 336 or more.
- **Time on linuxbox CPU:** about 23 minutes to build a spot (LightGlue matching 903 s, mapping 259 s) and about 15 s to localize a photo. The 7-minute tile solve is gone. GPU speedup is unmeasured.
- **Localization used no pin.** Retrieval searches the whole spot model. A pin, EXIF GPS or a spot name only has to pick which spot.

## What the demo must prove

1. A photo of a modeled spot returns where the photographer stood, the heading and the lens, with an honest confidence state, shown side by side with the original.
2. The user changes the lens, places people, picks the light and gets a preview made from their own photo.
3. Friends plan in one live scene while a scout at the real spot walks to the mark.
4. All of it works from an iMessage thread, and a phone call guides you to the spot.

## Lessons carried into the new code

These are findings from both tests. Each one becomes a rule in the new code.

- **Inlier gate.** Results under 200 inliers are "Couldn't place". 78 was the failure and 336 the weakest good result, so 200 is a guess between them, labelled uncalibrated until our own spots confirm it.
- **Match count alone is not confidence.** In the tiles test, wrong no-pin answers had 161 inliers and 4.9 px error. Confidence also checks that the pose sits near the model's registered cameras and that the lens reader roughly agrees with the solved focal length. Three states: "Solid", "Check this", "Couldn't place".
- **Mirror registrations.** 7 DUMBO photos registered about 180 degrees flipped because the bridge tower is symmetric. The spot build drops training photos whose SfM heading disagrees with EXIF by more than 90 degrees, then remaps.
- **EXIF is a noisy reference.** Apply the digital zoom ratio to EXIF focal length (one photo read 33 mm for a 75 mm shot). Compasses can be wrong. GPS is off by meters.
- **Lens distortion in PnP.** Solve with a radial distortion term, so wide phone lenses don't bend the pose.
- **Line-of-sight slide.** Far, flat scenes let the camera slide toward the scene while focal length compensates (the 17 m case, and the tiles telephoto failures). The lens reader's range limits the focal search.
- **A spot is required.** Pin, EXIF GPS or a named spot picks the model. Photos of unmodeled places get the lens read and an honest "we haven't mapped this spot".
- **Original capture time is out.** Reading time from lighting missed by 52 to 123 degrees. The "light" answer is forward planning only.
- **Lens means field of view.** The answer is the 35 mm equivalent of the final image. It does not identify the camera body, and a crop changes it.
- **No 5-tap manual match.** Picking 3D points on Google tiles is geodata extraction, which the Map Tiles policy bans. "Check this" offers a re-run with a lens hint ("it was about 85 mm") instead.
- **Cesium's `fov` is horizontal only when width >= height.** The browser and solver share one conversion.
- **Google credits stay visible** on every screen that shows tiles.

## Architecture

```
 iPhone (iMessage)  Telegram group  phone call (SMS number)
        \               |               /
         Photon 2.0 beta (Socket.IO events in, HTTP API out; SIP to ElevenLabs agent)
                        |
 browser (planner)      |        phone browser (scout)
 Cesium + Google tiles  |        camera feed + ghost of original
 SpacetimeDB TS SDK     |        GPS + compass at 5 Hz
        \               |               /
          SpacetimeDB module (TypeScript, Maincloud)
          all shared state lives in rows
                        |
             crew service (Node, TS SDK client, worker identity)
             agent loop · job claims · Photon bridge · NVIDIA calls · photo files
                 |                                   |
       solver (Python, FastAPI)               NVIDIA hosted APIs
       spot models · localize · verify        Nemotron 3.5 Super VL, image edit,
       lens reader on vLLM (LoRA)             safety, embeddings, Cosmos Reason
```

### Repo layout

| Folder | What | Language |
|---|---|---|
| `module/` | SpacetimeDB module: tables, reducers, schedules, views | TypeScript |
| `web/` | Planner app, scout page and credits page, one Vite app | TypeScript, React, CesiumJS |
| `crew/` | Long-running client: claims jobs, runs the agent, bridges Photon, stores photos | TypeScript (Node) |
| `solver/` | Spot build, localize, confidence | Python |
| `lens/` | Commons pull, LoRA fine-tune, eval, vLLM serve config | Python |
| `spots/` | One folder per spot: manifest and `CREDITS.tsv` in git; images and model ignored | data |

### SpacetimeDB module (`module/`)

Spacetime powers the primary function: every piece of shared state is a row, and every client (planner, scout, crew, the iMessage thread) reads and writes the same rows.

Tables:
- `session` (share code, spot, owner), `participant` (identity, role planner / scout / crew, online)
- `spot` (id, name, center, model version, registered camera count)
- `photo` (inline thumbnail bytes, original URL on the crew box, pin, EXIF focal with zoom applied)
- `solve_job` (state, progress text, worker identity, lease expiry), `solve_result` (pose, 35 mm focal, inliers, confidence state, reason)
- `camera` and `person` (shared `Pose` struct: lat, lon, alt, heading, pitch, roll, fov)
- `device_pose` (scout GPS, accuracy, compass heading)
- `preview_job` (instruction, state, image URL)
- `message` (channel imessage / telegram / voice / web, thread id, parent message id, text, image URL, direction)
- `agent_step` (the tool trace the UI shows: tool, args, result summary)

Reducers: `create_session`, `join_session`, `add_photo`, `enqueue_solve`, `claim_job`, `report_progress`, `finish_job`, `move_camera`, `place_person`, `set_time`, `push_device_pose`, `request_preview`, `post_message`, `log_agent_step`. Each checks `ctx.sender`. `claim_job`, `finish_job` and the outbound side of `post_message` accept only the crew identity, stored at `init`.

Schedules:
- reclaim jobs whose lease ran out (the kill-the-worker demo)
- mark participants offline after silence
- the golden-hour countdown every client sees

Lifecycle reducers drive presence dots. A view limits each client to its own session.

Procedures and HTTP handlers stay out of the critical path. A procedure is a synchronous HTTP call, the agent loop makes several calls with images, and Photon delivers over Socket.IO, which a procedure cannot hold open. One stretch use, after the booth confirms procedures work in TS on Maincloud free tier: a scheduled procedure sends the golden-hour reminder into the open thread.

### Crew service (`crew/`)

One Node process on the GPU box, connected to Spacetime with the TS SDK under its own identity. It replaces the archived Python SDK: Python never talks to Spacetime.

- Subscribes to queued `solve_job` and `preview_job` rows, claims them, calls the solver over localhost HTTP, writes progress and results back.
- Runs the agent loop: Nemotron 3.5 Super VL (`nvidia/nemotron-3.5-super-vl-120b-a12b`, OpenAI-compatible at integrate.api.nvidia.com) with our own tool loop. Tools: `pick_spot`, `read_lens`, `solve`, `sun_windows`, `make_preview`, `safety_check`, `find_similar_spots`, `scout_status`. Each step is logged to `agent_step`, so the UI shows the trace. No NeMo Agent Toolkit (deprecated).
- Photon bridge: Socket.IO subscription in, HTTP API out. An inbound message becomes a `message` row, and the agent's reply goes out through Photon and is mirrored as a row.
- Stores uploaded originals on disk and serves them at `/photo/:id` behind the same Caddy as the web app.
- Exposes the tool endpoints the ElevenLabs voice agent calls during a phone call.

### Solver (`solver/`)

Python with pycolmap 4.2 and hloc 1.5 in its own venv. hloc's SuperPoint needs the SuperGluePretrainedNetwork repo cloned into the venv's `site-packages/third_party`; the setup script does it. SuperPoint's weights carry a non-commercial license, which is fine for a hackathon and worth a line in the README.

**Spot build** (`solver/build_spot.py <spot>`), once per spot, offline:
1. Images: Commons pull (DUMBO) or our own phone photos.
2. MegaLoc global features, top-20 retrieval pairs.
3. SuperPoint (2048 keypoints) and LightGlue matching.
4. pycolmap mapping.
5. Georegister with EXIF GPS, robustly (residual under 15 m counts).
6. Drop photos whose SfM heading disagrees with EXIF by more than 90 degrees, remap, and log what was dropped.
7. Write `spots/<spot>/model/`, a stats file, and a spot row (center, radius, camera count).

**Localize** (`POST /solve`): MegaLoc retrieval over the spot's images, SuperPoint and LightGlue to each retrieved image, 2D-3D through the model's tracks, then pose, focal and one radial distortion term with RANSAC, then the confidence check. The lens reader's range limits the focal search when it is available.

**Confidence**, in order: under 200 inliers is "Couldn't place". A pose far from every registered camera, or a solved focal outside the lens reader's range, is "Check this". Otherwise "Solid". The reason string goes into `solve_result` so the UI can say why.

**Self-check:** a synthetic test that projects known model points from a known camera, adds noise and outliers, and recovers the pose. Plus a held-out run on each spot that writes the same table as the scope report.

The side-by-side is the user's photo over the Cesium view at the solved pose, drawn live in the browser for display only. Georegistration error (median 7.3 m at DUMBO) shows as an offset against Google's tiles; the photo overlay slider makes it visible rather than hiding it.

### Lens reader (`lens/`)

The solver already reads focal length to 3% at modeled spots, so the lens reader's job changed: it works on any photo, including spots we haven't modeled, and it is the independent check the confidence step needs.

- Fresh pull of Commons photos with GPS and `FocalLengthIn35mmFilm`, target 1,000+, with an extra pull for long lenses. Apply the digital zoom ratio to labels. Commons returns 429s with long Retry-After waits, so the pull runs in the background from the start.
- Labels: 35 mm focal plus bin (ultrawide <24, wide 24-35, normal 35-70, tele 70-200, super-tele >200). Bin accuracy is the headline number.
- Split by landmark, 2 or 3 held out whole. DUMBO is held out, so its solver results can grade the lens reader too.
- LoRA (rank 16, lr about 1e-4, 2-3 epochs, stop on held-out loss) on `NVIDIA-Nemotron-Nano-12B-v2-VL`, or Bolt E4B if NeMo AutoModel supports it. Served with vLLM's LoRA support on the same GPU.
- Eval table: base model, fine-tuned, a closed model (OpenAI key), and "typical focal at this landmark". Only the last comparison is the honest bar.

### Answer card and "make it yours" (`web/`)

- **Answer card:** spot name, a compass with the heading, the 35 mm lens and the phone equivalent ("about 3x on an iPhone 15 Pro"), the walk to the mark, and the next good light for this heading from `suncalc` (sun behind the camera, sun in frame, golden hour, blue hour).
- **Lens:** a longer lens is an exact crop of the user's photo from the same spot. A wider lens shows in the Cesium view, and its preview is a generative outpaint labelled "AI interpretation".
- **People:** drag glTF figures in the Cesium scene. Their pixel box at the solved pose goes to the image edit as placement.
- **Light:** a time slider moves the sun in Cesium, and the preview edit gets the sun direction relative to the camera.
- **Preview:** NVIDIA-hosted image edit (FLUX.1 Kontext, `qwen-image-edit` or `flux.2-klein-4b`, whichever is a free endpoint) applied to the user's photo. Fallback: OpenAI image edit. Every preview carries the "AI interpretation" label.
- **Uncertain:** "Check this" and "Couldn't place" show the reason and offer a re-run with a lens hint or another spot.
- **Credits page** (`/credits`): every Commons photo in a spot model or the lens dataset, with author, license and link, from the spots' `CREDITS.tsv`. The DUMBO model alone has 166 images from 53 authors under CC BY, CC BY-SA and CC0. Share-alike may reach the point cloud, so the model files stay out of git and off the public repo.

### Scout page (`web/` route `/s/:code`)

Opened on a phone from the session QR code or a text link. Camera feed with the original photo as a ghost overlay, distance and arrow to the mark from GPS and compass, `push_device_pose` at 5 Hz. iOS needs HTTPS and a tap to allow motion sensors, hence the domain.

### Photon flows

- **iMessage 1:1:** text a photo. The spot comes from EXIF GPS, else the agent asks "where is this?" and matches the answer against the spot list. Reply: spot, heading, lens, light in a few lines, the preview image, and a link to the live session. No map screenshot is sent, which keeps Google content out of texts.
- **Threaded follow-ups** (`parentMessageId`): "make it 85mm", "add two people", "what about sunset?" Each one regenerates the preview. One thread is one session.
- **Telegram group:** the same handler. Group planning, an album of 24/50/85 mm options, one message edited in place with solve progress.
- **Voice:** call the SMS number. Photon's documented path is SIP to an ElevenLabs agent. The agent calls crew tools for the plan and the caller's position (from the scout page they opened from the text). After the call, crew texts the final framing into the same thread. NVIDIA Parakeet and Magpie through Photon's LiveKit cookbook is a stretch.

### Safety

`nvidia/nemotron-3.5-content-safety` screens every upload and text. Refuse private homes and photos aimed at a person, and keep no exact location for refused uploads. Spot models only exist for public places we chose, which is the strongest answer to the stalking question: ShotMatch cannot locate a photo anywhere we haven't mapped.

## Which machine runs what

| Piece | Runs on | Why |
|---|---|---|
| SpacetimeDB module | Maincloud (free tier) | The track, and no box to keep up |
| Spot builds | linuxbox CPU now (about 23 min each); Vultr GPU once it exists | Builds are offline, so the GPU is not on the critical path |
| Solver service, lens fine-tune, vLLM | Vultr GPU (L40S class) or Brev | CUDA for the fine-tune and vLLM; localizing runs on CPU in about 15 s if the GPU is late |
| Crew service, web app, Caddy | Same Vultr box | One public IP for Photon, HTTPS for the scout page, counts for MLH Vultr |
| Domain | GoDaddy (MLH) pointed at the Vultr box | HTTPS on the scout phone |
| Development, Commons pull | linuxbox | Always on |
| Demo laptop, offline lens guess via Ollama (stretch) | benmac | Ben's laptop at the venue |
| Photo shoots, scout phone | teammates' iPhones | Live at the campus spot |

## Demo spots

Commons is too thin for Dallas: Reunion Tower photos are mostly shot from the tower, Dealey Plaza has 35 GPS photos, and Pegasus and the Margaret Hunt Hill Bridge have almost none. So:

1. **NYC DUMBO** from Commons. Already proven, and the "photo you saw online" hook. Rebuilt in this repo, with the credits page.
2. **A UTD campus spot we shoot ourselves.** About 150 GPS-tagged phone photos, which also removes the license question. The scout stands there during judging.
3. **Optional second shot spot** on campus or one Dallas landmark, if someone has the time to go.

**How to shoot a spot** (any teammate, 10 to 15 minutes):
- Camera location on (Settings, Privacy, Location Services, Camera: While Using).
- About 150 photos at 1x, walking a wide arc and several distances, shot in overlapping steps of a few meters. Include the views a person would actually frame, plus closer detail shots.
- Daylight that matches judging. Night photos won't match daytime ones. Sunset in Richardson is about 5:25 PM CT today, so either shoot right now or at first light Sunday (about 6:50 AM) before the 9 AM freeze.
- Transfer originals (AirDrop with "All Photos Data" or a cable). A plain iMessage or a screenshot can strip GPS.
- Keep 10 photos per spot from a different phone aside as the held-out test.

Every demo photo has a precomputed result in the database, so the demo never waits on a cold solve. One photo solves live with progress on screen.

## Order of work

Each step ends with something you can show. Later steps never block earlier ones.

0. **Now, before features:** shoot the campus spot if there is light. Start the DUMBO rebuild and the lens dataset pull in the background on linuxbox.
1. **Skeleton live.** Module on Maincloud with `session`, `spot`, `photo`, `solve_job`, `solve_result`. Web app connects, creates a session, uploads a photo and picks a spot on Cesium with Google credits visible. Crew connects with its identity. *Done when* a photo row appears in `spacetime sql`.
2. **Solve and side-by-side.** `build_spot.py` rebuilds DUMBO with the mirror filter. `/solve` localizes with distortion and the inlier gate. Crew claims, reports progress, finishes. Web shows the photo over the Cesium view at the solved pose with a slider and the confidence state. *Done when* the 11 DUMBO held-out photos reproduce the scope table (10 Solid or Check this, T3 Couldn't place).
3. **Answer card.** Spot, heading compass, lens and phone equivalent, walk to the mark, next good light.
4. **Make it yours.** Lens crop and wider view, people placement, time slider, preview from the user's photo with the label. Credits page.
5. **Live session and the campus spot.** Build the campus model. Share QR, presence dots, camera moves on every screen, scout page with ghost overlay and live dot, job reclaim after killing crew. *Done when* the four Spacetime judge moments in PLAN.md all work at the campus spot.
6. **iMessage.** Photo in, answer and preview out, threaded follow-ups, messages mirrored into the session. Then the Telegram group.
7. **Fine-tune.** Train, eval table, vLLM serving, lens range wired into the solver and the confidence check.
8. **Voice call.** ElevenLabs agent over Photon SIP with crew tools, text after hang-up.
9. **Stretch, in this order:** golden-hour reminder via scheduled procedure, Cosmos Reason sanity check, spot search with Nemotron embeddings, cuOpt shoot-day route, Ollama offline lens guess, Cosmos Transfer video.

The Devpost draft goes in by 11 PM Saturday whatever step we are on. Freeze features at 9 AM Sunday. The rest is the demo video, the write-up, and making the repo public after the gitleaks scan.

## Team split (up to 4)

| Person | Owns | First deliverable |
|---|---|---|
| A: solver and spots | `solver/`, spot builds, the Vultr box | Step 2 on DUMBO |
| B: live set | `module/`, `crew/` job lifecycle and agent loop, NVIDIA calls | Step 1 rows and job claim/reclaim |
| C: design and planner | `web/` planner, answer card, make it yours, scout page, credits, Best Design polish | Step 1 upload and spot pick, then steps 3-5 UI |
| D: texts, shoots and story | campus photo shoot, Photon iMessage, Telegram, voice; `lens/` pull and fine-tune; Devpost, demo video, booth questions | Campus shoot now, Devpost draft by 11 PM, then step 6 |

With 3 people, D's Photon work goes to B and the fine-tune goes to A. With 2, drop Telegram, voice and the fine-tune, which drops the NVIDIA story to "Nemotron agent on NVIDIA APIs and GPU".

## What Ben must do

Now:
- **Shoot the campus spot** before about 5:25 PM CT, or plan it for first light Sunday (steps above). Pick the spot.

Accounts and keys (I collect each with `request_secret`; never paste them in chat):
1. NVIDIA API key from build.nvidia.com.
2. Photon beta account at app.beta.photon.codes, an iMessage agent on the shared line, a Telegram bot token from @BotFather, and an SMS number for voice (buying a number does not complete messaging compliance, so ask the booth).
3. ElevenLabs account and key for the voice agent (Photon's documented SIP path).
4. SpacetimeDB Maincloud login (`spacetime login` opens a browser on the machine that runs it).
5. Vultr GPU instance (MLH credits if offered) or Brev ($200 NVIDIA credit), Ubuntu with CUDA, and the SSH key.
6. A domain from the MLH GoDaddy offer.

Decisions:
- Go on this plan (option 1 is now tested).
- Team names for the Devpost draft by 11 PM.
- Making the repo public before submission (Spacetime requires it). I run gitleaks over every ref first.

Booth questions:
- **NVIDIA:** Credits or GPUs at the event? Is FLUX.1 Kontext a free endpoint on build.nvidia.com? Does Cosmos Transfer take a single image? Is Nano 12B v2 VL or Bolt E4B the better LoRA base in NeMo AutoModel?
- **Spacetime:** Do procedures and HTTP handlers work in a TS module on Maincloud free tier? Is 5 Hz from each scout phone a sane write rate? Does a Node client as a job worker count as "Spacetime powers the primary function"?
- **Photon:** Can a beta iMessage agent receive HEIC images and send images? Do received images keep EXIF GPS? Can it reply later inside an open thread (golden-hour reminder)? Which number type counts for the voice prize, and can we bring our own ASR/TTS through LiveKit?

## Demo script (about 3 minutes)

1. **Hook (planner laptop).** "You saw this shot of the Manhattan Bridge online. Where do you stand, and what lens?" Drop the photo. The agent trace shows each step: safety, spot, lens read, solve. The photo snaps onto the 3D scene with a slider and "Solid".
2. **Answer card.** Spot, heading, lens, "about 2x on your phone", sun behind you at a named time.
3. **Honesty.** Drop the photo from the water (the T3 case). "Couldn't place, 78 matches", not a confident wrong pin.
4. **Make it yours.** Switch to 50 mm, drag two people in, slide to golden hour, get the preview labelled "AI interpretation".
5. **Live set, at UTD.** A judge scans the QR. Their dot appears. Our scout, live at the campus spot, walks. Their dot moves and the ghost overlay lines up on their phone. Kill the crew process mid-solve, and the job comes back and finishes. `spacetime sql` on screen.
6. **Texts.** Text a campus photo to the iMessage number from a judge's phone. The answer and preview come back, and "make it sunset" in the thread regenerates it. The texts appear in the live session.
7. **NVIDIA.** The eval table: fine-tuned Nemotron vs base vs closed model on held-out landmarks.
8. **Voice (if built).** Call the number. It guides the scout to the mark and texts the framing after hang-up.

Limits said out loud: only mapped spots, outdoor places, no original-time recovery, previews are interpretations.

## Devpost draft

Numbers in brackets get filled from this repo's own runs, not the scratch tests.

**ShotMatch: find the spot, then make the shot yours**

Send ShotMatch a photo of a place you love. It finds where the photographer stood, which way they pointed and what lens they used, and shows the photo snapped onto a 3D view of the place so you can check it yourself. Then you plan your version: switch lenses, place your friends, pick the light, and get a preview. Your crew plans in one live scene while a scout at the real spot walks to the mark. You can do all of it by iMessage, Telegram or a phone call.

**How it works.** For each spot we build an open 3D model with structure-from-motion: [128] Creative Commons photos of Brooklyn's Manhattan Bridge view, and [150] photos we shot ourselves at UTD. A new photo is matched against that model, which recovers position, heading and focal length in about [15] seconds. On held-out photos, [10 of 11] landed within [24] m of their phone GPS, and focal length was within [6]% on [8 of 10]. When the match is weak it says "Couldn't place" instead of guessing. Google's Photorealistic 3D Tiles are the planning view only; nothing is computed from them.

**Tracks**
- **NVIDIA: an open model that learned to read cameras.** Nemotron 3.5 Super VL runs the agent and its tools. A LoRA fine-tune of Nemotron Nano VL reads the lens of any photo, mapped spot or not, and cross-checks the solver; we report base vs fine-tuned vs a closed model on held-out landmarks. NVIDIA-hosted models make the previews, screen uploads for safety and power search. The fine-tuned model runs on an NVIDIA GPU on Vultr.
- **SpacetimeDB: the live set.** Sessions, the crew, the scout's phone position, solve jobs with worker leases, previews and the whole text conversation are rows in one TypeScript module. Kill the worker mid-solve and a schedule reclaims the job.
- **Photon: the shot in your texts.** Text a photo over iMessage and get the spot, lens, light and preview back, then follow up in threads. Plan as a group on Telegram. Call the number and a voice agent guides you to the spot, then texts you the framing.
- **HackUTD Best Design.**
- **MLH: Best Use of Vultr, Best Domain Name from GoDaddy Registry.**

**Built with:** NVIDIA Nemotron, NVIDIA API Catalog, vLLM, COLMAP (pycolmap), hloc, MegaLoc, SuperPoint, LightGlue, PyTorch, SpacetimeDB, Photon, ElevenLabs, CesiumJS, Google Photorealistic 3D Tiles (display only), React, Vultr, GoDaddy.

**What's next.** More spots, a calibrated confidence score, and an offline lens reader on the phone.

Photo credits: every Creative Commons photo used for a 3D model or training is on the app's credits page and in `spots/*/CREDITS.tsv` and `lens/CREDITS.tsv`.

## Direction change, Sat ~9:00 PM CT: the virtual set

Ben's call: entering a location builds a virtual world of the spot, and you work in it like Blender. You place 3D models, people, characters, props, lights and cameras, then render the image with AI on top. VR comes later. The sponsors stay: NVIDIA for the AI, SpacetimeDB for the shared set, Photon for iMessage.

- **Engine:** three.js with @react-three/fiber, `postprocessing` and @react-three/xr (WebXR), replacing Cesium for the editor. Google Photorealistic 3D Tiles render inside three.js through `3d-tiles-renderer`, for display and editing only, with Google's attribution on screen.
- **Shared set:** every object is a `scene_object` row (position in metres east/north/up from the spot, quaternion, scale, light settings, gizmo lock), edited live by everyone in the session.
- **Render:** the shot camera renders only the user's objects and lights (beauty, depth, object mask). The crew composites them over the user's original photo from the same camera and runs an AI render pass. Map tile pixels and depth never enter a render, an export or an AI step, which keeps us inside Google's Map Tiles policy.
- **NVIDIA:** Nemotron 3.5 Super VL turns "two friends walking toward camera, a red bike on the left" into scene edits. TRELLIS (hosted, checked: a GLB in 11 s) generates props from words or a photo. FLUX.1-dev (hosted, with depth and canny modes) is the candidate render pass; its first test call returned a 500. The lens fine-tune still waits on a GPU.
- **Photoreal set (needs a GPU):** a Gaussian-splat world trained from the spot's photos would make the set our own data, renderable and VR-ready. It needs CUDA, so it waits on Vultr's limit or Brev.
- **Design:** round 3 in the same Figma file draws the set editor in the B (dark) and A (light) languages.

## Build log

Ben said go at 5:20 PM CT Saturday ("just build everything"). Status as of 6:50 PM CT:

- **Module** live on Maincloud as `shotmatch`. Data cleared at 6:48 PM CT to drop test rows.
- **Solver** runs on linuxbox as `shotmatch-solver.service`. DUMBO rebuilt in this repo: 127 of 155 images registered, 11 dropped by the mirror filter. Held-out: 10 of 11 placed, 9 within 25 m (T2, a telephoto, at 32 m), T3 flagged "Couldn't place" at 75 inliers, median focal error 3%, 11 to 18 s a photo. Table in `spots/nyc_dumbo/eval.md`.
- **Crew** runs as `shotmatch-crew.service`. Safety, lens read, solve, sun and preview steps work. Killing it mid-solve requeues the job and a restart finishes it.
- **Web** served by the crew at https://linuxbox.<tailnet>.ts.net:10000 (Tailscale funnel, port 10000).
- **Lens dataset:** 4,500 Commons photos from 37 landmarks. Test landmarks held out whole: DUMBO, Big Ben, Gooderham. Baselines: always "wide" 57.5% bin accuracy, OpenAI zero-shot 68.3%.

What the NVIDIA key showed:
- `nvidia/nemotron-3.5-content-safety` is listed but returns 404, so safety screening runs on Nemotron 3.5 Super VL with a strict JSON prompt.
- Nemotron 3.5 Super VL reasons by default and can spend its whole token budget on it; quick calls send `enable_thinking=false`.
- No hosted NVIDIA image-edit model accepts a user's photo (FLUX.1 Kontext and flux.2-klein want an `example_id`, qwen-image-edit is 404). Previews use OpenAI `gpt-image-2` until that changes. Booth question.
- The base VL lens read is poor on telephoto (read a 287 mm photo as 28 mm), so only the fine-tuned model or a user hint narrows the solver's focal search.

Update, 7:15 PM CT:
- **Steps 1 to 5 done and checked on the public URL.** Demo session `A9TVAN` (https://linuxbox.<tailnet>.ts.net:10000/p/A9TVAN): d0481 Solid, 1690 matches, 53 mm, facing 4 degrees N, preview made, scout walked to the mark in a phone-sized browser. d0473 correctly "Couldn't place" (73 matches), also after a lens-hint re-run.
- **Step 6 (Photon)** built from the docs, off until `photon_api_key` and `photon_project_id` exist. Steps for Ben in `crew/PHOTON.md`.
- **Step 7 (fine-tune)** blocked: Vultr refused the instance for lack of credit. Hosted Nemotron 3.5 Super VL zero-shot scored 54.8% bin accuracy, below always-wide (57.5%) and OpenAI (68.3%).
- **Step 8 (voice):** ElevenLabs agent "ShotMatch guide" (`agent_9201m6wab2eje2eb6x2gg17mnbz8`) with three tools behind a secret; needs a Photon SMS or dedicated number to dial.
- **Step 9:** golden-hour reminders (module schedule plus outbox) work, delivery waits on Photon. Similar-photo search with `llama-nemotron-embed-vl-1b-v2` works. cuOpt shoot-day route works (hosted cuOpt, one call took 58 s). Cosmos Reason is wired but returns 404 on our key. Cosmos Transfer is end of life (410). The Ollama offline lens guess is dropped: the small Nemotron is text-only.

## GPU cost log

Cap: $50 total for the hackathon. One instance at most, deleted after judging Sunday. Details in `lens/COST.md`.

| When (CT) | Event | Plan | $/h | Running total |
|---|---|---|---|---|
| Sat evening | Create refused: no account credit | A40 lax | 1.71 | $0 |
| Sat ~8:25 PM | Create refused: monthly fee limit. Support ticket filed for a limit increase; `ops/gpu-create-retry.sh` retries every 10 min | A40 lax | 1.71 | $0 spent |
| Sat ~8:30 PM | Account cap is $250/month per instance, so even the A16 ($344/month) is refused. Filed Vultr's Request Limit Increase form for $1,500; its team works weekdays 9 AM to 6 PM ET | n/a | n/a | $0 spent |
| Sat ~8:20 PM | Added $25 credit on a card; MLH $100 code registered, email pending | n/a | n/a | $0 spent, $25 credit |
| Sat 9:27 PM | Brev: created `shotmatch-gpu`, A100 80 GB (hyperstack), from the $60 HackUTD NVIDIA credit. Cap $55 | hyperstack_A100_80G | 1.62 | $0 |
| Sat 10:56 PM | Brev: fine-tune and splat done, vLLM serving the lens model. Kept up until Sunday noon CT (projected $23.60 total), then `brev delete shotmatch-gpu` | hyperstack_A100_80G | 1.62 | $2.41 |
| Sun 12:55 AM | Brev: Difix3D splat pass stopped (splat off the demo); only vLLM serving the lens model remains. Projected $23.57 at noon CT | hyperstack_A100_80G | 1.62 | $5.62 |

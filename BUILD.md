# ShotMatch build plan (HackUTD 2026 "Zero Day")

Written Sat Nov 7, 2026, 3:30 PM CT. Scope source: `~/Code/scratch/shotmatch-test/PLAN.md` on linuxbox. Evidence: `FEASIBILITY.md` and `results/evidence_reviewed.jpg` in the same folder.

Every line of code in this repo is written after noon CT Saturday. The scratch test code is reference only. Nothing is copied from it, and that includes the Commons dataset pull: `lens/` re-pulls it with a fresh script.

ShotMatch is still one of two candidates. The other is the iMessage coding agent.

## What the demo must prove

1. A photo plus a rough pin returns where the photographer stood, the heading and the lens, with an honest confidence state, shown side by side with the original.
2. The user changes the lens, places people, picks the light and gets a preview made from their own photo.
3. Friends plan in one live scene while a scout at the real spot walks to the mark.
4. All of it works from an iMessage thread, and a phone call guides you to the spot.

## Lessons carried over from the scratch tests

These are findings, not code. Each one becomes a rule in the new solver.

- **Verify the final view.** Inliers from an earlier iteration do not prove the final camera sees the scene (the obstructed Brooklyn Bridge frame). Confidence comes from matches at the solved pose only.
- **Match count and low error are not confidence.** All three no-pin runs were wrong with 161 inliers and 4.9 px error. Ship three states: "Solid", "Check this" and "Couldn't place". Thresholds come from runs on our own demo spots and are labelled uncalibrated.
- **A pin is required.** No-pin mode failed. The app always asks for a pin, EXIF GPS or a named spot from the library.
- **Telephoto and far scenes need a lens prior.** Distance and focal length trade off in flat, far scenes, and a soft pin prior did not fix it. The fine-tuned lens reader gives the solver its field-of-view range. Until it exists, the solver searches a field-of-view grid.
- **Snap the pin to street level.** A pin on a roof or under a bridge breaks the search.
- **Original capture time is out.** Reading time from lighting missed by 52 to 123 degrees. The "light" answer is forward planning only: when the sun sits well for this view.
- **Lens answer means field of view.** It is the 35 mm equivalent of the final image. It does not identify the camera body, and a crop changes it.
- **Five taps rescue normal lenses, not telephoto.** The manual fallback is for "Check this" on normal lenses.
- **Cesium's `fov` is horizontal only when width >= height.** The browser and solver share one conversion function.
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
         \              |              /
          SpacetimeDB module (TypeScript, Maincloud)
          all shared state lives in rows
                        |
             crew service (Node, TS SDK client, worker identity)
             agent loop · job claims · Photon bridge · NVIDIA calls · photo files
                 |                                   |
       solver (Python, FastAPI, CUDA)        NVIDIA hosted APIs
       localize · pose + focal · verify      Nemotron 3.5 Super VL, image edit,
       lens reader on vLLM (LoRA)            safety, embeddings, Cosmos Reason
```

### Repo layout

| Folder | What | Language |
|---|---|---|
| `module/` | SpacetimeDB module: tables, reducers, schedules, views | TypeScript |
| `web/` | Planner app and scout page, one Vite app with two routes | TypeScript, React, CesiumJS |
| `crew/` | Long-running client: claims jobs, runs the agent, bridges Photon, stores photos | TypeScript (Node) |
| `solver/` | Localize, pose and focal solve, final-view check, SfM build scripts | Python |
| `lens/` | Commons pull, LoRA fine-tune, eval, vLLM serve config | Python |
| `spots/` | One folder per demo spot: manifest, photo credits; images and SfM model ignored by git | data |

### SpacetimeDB module (`module/`)

Spacetime powers the primary function: every piece of shared state is a row, and every client (planner, scout, crew, the iMessage thread) reads and writes the same rows.

Tables:
- `session` (share code, spot, owner), `participant` (identity, role planner / scout / crew, online)
- `photo` (inline thumbnail bytes, original URL on the crew box, pin, EXIF focal if any)
- `solve_job` (state, progress text, worker identity, lease expiry), `solve_result` (pose, 35 mm focal, confidence state, final-view inliers, side-by-side URL)
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

Procedures and HTTP handlers stay out of the critical path. A procedure is a synchronous HTTP call; the agent loop makes several calls with images, and Photon delivers over Socket.IO, which a procedure cannot hold open. One stretch use, after the booth confirms procedures work in TS on Maincloud free tier: a scheduled procedure sends the golden-hour reminder into the open thread.

### Crew service (`crew/`)

One Node process on the GPU box, connected to Spacetime with the TS SDK under its own identity. It replaces the archived Python SDK: Python never talks to Spacetime.

- Subscribes to queued `solve_job` and `preview_job` rows, claims them, calls the solver over localhost HTTP, writes progress and results back.
- Runs the agent loop: Nemotron 3.5 Super VL (`nvidia/nemotron-3.5-super-vl-120b-a12b`, OpenAI-compatible at integrate.api.nvidia.com) with our own tool loop. Tools: `read_lens`, `solve`, `sun_windows`, `make_preview`, `safety_check`, `find_similar_spots`, `scout_status`. Each step is logged to `agent_step`, so the UI shows the trace. No NeMo Agent Toolkit (deprecated).
- Photon bridge: Socket.IO subscription in, HTTP API out. An inbound message becomes a `message` row; the agent's reply goes out through Photon and is mirrored as a row.
- Stores uploaded originals on disk and serves them at `/photo/:id` behind the same Caddy as the web app.
- Exposes the tool endpoints the ElevenLabs voice agent calls during a phone call.

### Solver (`solver/`) and the swappable 3D source

The 3D source is one interface, so the scope thread's result decides which implementation runs without touching the rest:

```python
class SceneSource(Protocol):
    def correspondences(self, photo, pin, fov_range) -> tuple[x2d, X3d_ecef, debug]: ...
    def verify(self, photo, pose) -> FinalViewCheck: ...
```

Everything after `correspondences` is shared: pose plus focal from 2D-3D matches (RANSAC over a focal grid limited by `fov_range`, then joint refinement with a soft pin prior), then `verify`, then the confidence state.

- **`SfmSource` (option 1, default).** Each demo spot has a georegistered COLMAP or GLOMAP model built on the GPU from CC photos (and our own phone photos of the campus spot), aligned with EXIF GPS. Localizing needs no rendering: pick database images near the pin, match with LightGlue on CUDA, look up their triangulated 3D points, solve. `verify` reprojects model points at the solved pose and matches against the nearest database images. Absolute accuracy is limited by EXIF GPS in the alignment (meters), which shows as an offset on Google's tiles.
- **`TilesSource` (option 2 only).** Render the Google tiles in headless Chrome, match, lift picked depths, solve. Used only if Ben picks option 2, and labelled a research prototype.

The side-by-side in option 1 is the user's photo over the Cesium view at the solved pose, drawn live in the browser for display. The solver never sees a tile.

### Lens reader (`lens/`)

- Fresh pull of Commons photos with GPS and `FocalLengthIn35mmFilm`, target 1,000+, with an extra pull for long lenses (only 102 of today's were over 70 mm). Credits kept per photo.
- Labels: 35 mm focal plus bin (ultrawide <24, wide 24-35, normal 35-70, tele 70-200, super-tele >200). Bin accuracy is the headline number.
- Split by landmark, 2 or 3 held out whole.
- LoRA (rank 16, lr about 1e-4, 2-3 epochs, stop on held-out loss) on `NVIDIA-Nemotron-Nano-12B-v2-VL`, or Bolt E4B if NeMo AutoModel supports it. Served with vLLM's LoRA support on the same GPU.
- Eval table: base model, fine-tuned, a closed model (OpenAI key), and "typical focal at this landmark". Only the last comparison is the honest bar.
- Output feeds `fov_range` in the solver. A held-out telephoto that solves with the prior and fails without it is the NVIDIA demo moment.

### Answer card and "make it yours" (`web/`)

- **Answer card:** spot name, a compass with the heading, the 35 mm lens and the phone equivalent ("about 3x on an iPhone 15 Pro"), the walk to the mark, and the next good light for this heading from `suncalc` (sun behind the camera, sun in frame, golden hour, blue hour).
- **Lens:** a longer lens is an exact crop of the user's photo from the same spot. A wider lens shows in the Cesium view, and its preview is a generative outpaint labelled "AI interpretation".
- **People:** drag glTF figures in the Cesium scene. Their pixel box at the solved pose goes to the image edit as placement.
- **Light:** a time slider moves the sun in Cesium; the preview edit gets the sun direction relative to the camera.
- **Preview:** NVIDIA-hosted image edit (FLUX.1 Kontext, `qwen-image-edit` or `flux.2-klein-4b`, whichever is a free endpoint) applied to the user's photo. Fallback: OpenAI image edit. Every preview carries the "AI interpretation" label.
- **Uncertain:** "Check this" opens the 5-tap match view.

### Scout page (`web/` route `/s/:code`)

Opened on a phone from the session QR code or a text link. Camera feed with the original photo as a ghost overlay, distance and arrow to the mark from GPS and compass, `push_device_pose` at 5 Hz. iOS needs HTTPS and a tap to allow motion sensors, hence the domain.

### Photon flows

- **iMessage 1:1:** text a photo. The pin comes from EXIF GPS, else the agent asks "where is this?" and matches the answer against the spot library. Reply: spot, heading, lens, light in a few lines, the preview image, and a link to the live session. No map screenshot is sent, which keeps Google content out of texts.
- **Threaded follow-ups** (`parentMessageId`): "make it 85mm", "add two people", "what about sunset?" Each one regenerates the preview. One thread is one session.
- **Telegram group:** the same handler. Group planning, an album of 24/50/85 mm options, one message edited in place with solve progress.
- **Voice:** call the SMS number. Photon's documented path is SIP to an ElevenLabs agent. The agent calls crew tools for the plan and the caller's position (from the scout page they opened from the text). After the call, crew texts the final framing into the same thread. NVIDIA Parakeet and Magpie through Photon's LiveKit cookbook is a stretch.

### Safety

`nvidia/nemotron-3.5-content-safety` screens every upload and text. Refuse private homes and photos aimed at a person; keep no exact location for refused uploads. This answers the stalking question at the booth.

## Which machine runs what

| Piece | Runs on | Why |
|---|---|---|
| SpacetimeDB module | Maincloud (free tier) | The track; no box to keep up |
| Solver, SfM builds, lens fine-tune, vLLM | Vultr GPU (L40S class) or Brev | CUDA; linuxbox has no NVIDIA GPU |
| Crew service, web app, Caddy | Same Vultr box | One public IP for Photon, HTTPS for the scout page, counts for MLH Vultr |
| Domain | GoDaddy (MLH) pointed at the Vultr box | HTTPS on the scout phone |
| Development, Commons pull, CPU fallback solver | linuxbox | Always on; `--use-angle=vulkan` works for headless Chrome if option 2 |
| Demo laptop, offline lens guess via Ollama (stretch) | benmac | Ben's laptop at the venue |
| Scout phone | a teammate's iPhone | Live at a UTD campus spot |

If the GPU is late, the spine runs on linuxbox CPU with precomputed results for the demo photos. CPU solve speed on the SfM path is unmeasured.

## Demo spots

Two or three, chosen with the scope thread:
1. **A UTD campus spot** we photograph ourselves on Saturday night. Our own photos build the SfM model, so there is no license question, and the scout can stand there during judging.
2. **One or two Dallas landmarks** with Commons coverage (candidates: Reunion Tower, Margaret Hunt Hill Bridge, Pegasus on Magnolia, Dealey Plaza), including one long-lens shot for the fine-tune moment.

Every demo photo has a precomputed result in the database, so the demo never waits on a cold solve. One photo solves live with progress on screen.

## Order of work

Each step ends with something you can show. Later steps never block earlier ones.

1. **Skeleton live.** Module on Maincloud with `session`, `photo`, `solve_job`, `solve_result`. Web app connects, creates a session, uploads a photo and drops a pin on Cesium with Google credits visible. Crew connects with its identity. *Done when* a photo row appears in `spacetime sql`.
2. **Solve and side-by-side.** Solver with the shared pose code and a synthetic self-check. `SfmSource` for the first spot as soon as the scope thread's model exists (`TilesSource` instead if option 2). Crew claims, reports progress, finishes. Web shows the photo over the Cesium view at the solved pose with a slider and the confidence state. *Done when* a real photo of a demo spot lands "Solid" and a bad one lands "Check this" or "Couldn't place".
3. **Answer card.** Spot, heading compass, lens and phone equivalent, walk to the mark, next good light.
4. **Make it yours.** Lens crop and wider view, people placement, time slider, preview from the user's photo with the label.
5. **Live session.** Share QR, presence dots, camera moves on every screen, scout page with ghost overlay and live dot, job reclaim after killing crew. *Done when* the four Spacetime judge moments in PLAN.md all work.
6. **iMessage.** Photo in, answer and preview out, threaded follow-ups, messages mirrored into the session. Then the Telegram group.
7. **Fine-tune.** Pull, train, eval table, vLLM serving, prior wired into the solver. The Commons pull and SfM builds start in the background at step 1, since they only need a GPU and a script.
8. **Voice call.** ElevenLabs agent over Photon SIP with crew tools, text after hang-up.
9. **Stretch, in this order:** golden-hour reminder via scheduled procedure, Cosmos Reason sanity check, spot search with Nemotron embeddings, cuOpt shoot-day route, Ollama offline lens guess, Cosmos Transfer video.

Devpost draft goes in by 11 PM Saturday whatever step we are on. Freeze features at 9 AM Sunday; the rest is demo video, write-up, and making the repo public after the gitleaks scan.

## Team split (up to 4)

| Person | Owns | First deliverable |
|---|---|---|
| A: solver and GPU | `solver/`, SfM builds, Vultr box, final-view check | Step 2 solve on the first spot |
| B: live set | `module/`, `crew/` job lifecycle and agent loop, NVIDIA calls | Step 1 rows and job claim/reclaim |
| C: design and planner | `web/` planner, answer card, make it yours, scout page, Best Design polish | Step 1 upload and pin, then steps 3-5 UI |
| D: texts and story | Photon iMessage, Telegram, voice; `lens/` pull and fine-tune; Devpost, demo video, booth questions | Draft by 11 PM, then step 6 |

With 3 people, D's Photon work goes to B and the fine-tune goes to A. With 2, drop Telegram, voice and the fine-tune, which drops the NVIDIA story to "Nemotron agent on NVIDIA APIs and GPU".

## What Ben must do

Accounts and keys (I will collect each with `request_secret`; never paste them in chat):
1. NVIDIA API key from build.nvidia.com.
2. Photon beta account at app.beta.photon.codes; an iMessage agent on the shared line; a Telegram bot token from @BotFather; an SMS number for voice (buying a number does not complete messaging compliance, so ask the booth).
3. ElevenLabs account and key for the voice agent (Photon's documented SIP path).
4. SpacetimeDB Maincloud login (`spacetime login` opens a browser on the machine that runs it).
5. Vultr GPU instance (MLH credits if offered) or Brev ($200 NVIDIA credit), Ubuntu with CUDA, and the SSH key.
6. A domain from the MLH GoDaddy offer.

Decisions:
- Option 1 or option 2 for Google tiles (below).
- Team names for the Devpost draft by 11 PM.
- Making the repo public before submission (Spacetime requires it). I run gitleaks over every ref first.
- Which campus spot the scout stands at.

Booth questions:
- **NVIDIA:** Credits or GPUs at the event? Is FLUX.1 Kontext a free endpoint on build.nvidia.com? Does Cosmos Transfer take a single image? Is Nano 12B v2 VL or Bolt E4B the better LoRA base in NeMo AutoModel?
- **Spacetime:** Do procedures and HTTP handlers work in a TS module on Maincloud free tier? Is 5 Hz from each scout phone a sane write rate? Does a Node client as a job worker count as "Spacetime powers the primary function"?
- **Photon:** Can a beta iMessage agent receive HEIC images and send images? Can it reply later inside an open thread (golden-hour reminder)? Which number type counts for the voice prize, and can we bring our own ASR/TTS through LiveKit?

## Demo script (about 3 minutes)

1. **Hook (planner laptop).** "You saw this shot online. Where do you stand, and what lens?" Drop the photo, tap the pin. The agent trace shows each step: safety, lens read, solve. The photo snaps onto the 3D scene with a slider and "Solid".
2. **Answer card.** Spot, heading, 85 mm, "about 3x on your phone", sun behind you at 5:12 PM.
3. **Make it yours.** Switch to 50 mm, drag two people in, slide to golden hour, get the preview labelled "AI interpretation".
4. **Live set.** A judge scans the QR. Their dot appears. Our scout, live at the campus spot, walks; their dot moves and the ghost overlay lines up on their phone. Kill the crew process mid-solve; the job comes back and finishes. `spacetime sql` on screen.
5. **Texts.** Text a photo to the iMessage number from a judge's phone. The answer and preview come back; "make it sunset" in the thread regenerates it. The texts appear in the live session.
6. **NVIDIA.** The eval table: fine-tuned Nemotron vs base vs closed model on held-out landmarks, and the telephoto that only solves with the fine-tuned prior.
7. **Voice (if built).** Call the number; it guides the scout to the mark and texts the framing after hang-up.

Honest limits said out loud: needs a rough pin, outdoor landmarks only, no original-time recovery, previews are interpretations.

## Devpost draft

**ShotMatch: find the spot, then make the shot yours**

Send ShotMatch a photo of a place you love. It finds where the photographer stood, which way they pointed and what lens they used, and shows the photo snapped onto a 3D model of the place so you can check it yourself. Then you plan your version: switch lenses, place your friends, pick the light, and get a preview. Your crew plans in one live scene while a scout at the real spot walks to the mark. You can do all of it by iMessage, Telegram or a phone call.

**How it works.** A rough pin narrows the search. A Nemotron vision model we fine-tuned on 1,000+ Creative Commons photos with lens metadata reads the lens. The solver matches the photo against an open 3D model of the spot, which we built with structure-from-motion from Creative Commons photos and our own, and recovers position, heading and focal length on an NVIDIA GPU. It then checks the answer at the final camera and says "Solid", "Check this" or "Couldn't place" instead of guessing.

**Tracks**
- **NVIDIA: an open model that learned to read cameras.** Nemotron 3.5 Super VL runs the agent and its tools. A LoRA fine-tune of Nemotron Nano VL predicts the lens and feeds the solver; we report base vs fine-tuned vs a closed model on held-out landmarks. NVIDIA-hosted models make the previews, screen uploads for safety and power search. The solver and the fine-tuned model run on an NVIDIA GPU on Vultr.
- **SpacetimeDB: the live set.** Sessions, the crew, the scout's phone position, solve jobs with worker leases, previews and the whole text conversation are rows in one TypeScript module. Kill the worker mid-solve and a schedule reclaims the job.
- **Photon: the shot in your texts.** Text a photo over iMessage and get the spot, lens, light and preview back; follow up in threads. Plan as a group on Telegram. Call the number and a voice agent guides you to the spot, then texts you the framing.
- **HackUTD Best Design.**
- **MLH: Best Use of Vultr, Best Domain Name from GoDaddy Registry.**

**Built with:** NVIDIA Nemotron, NVIDIA API Catalog, vLLM, COLMAP/GLOMAP, LightGlue, PyTorch, SpacetimeDB, Photon, ElevenLabs, CesiumJS, Google Photorealistic 3D Tiles (display only), React, Vultr, GoDaddy.

**What's next.** More spots, a calibrated confidence score, and an offline lens reader on the phone.

Photo credits: every Creative Commons photo used for training or 3D models is listed in `spots/*/CREDITS.md` and `lens/CREDITS.md`.

## Open decision: Google tiles

- **Option 1 (recommended).** Google tiles for the planning view only, logo and credits on screen. The solver localizes against open SfM models; previews edit the user's photo. Within the Map Tiles policy. Risk: SfM model quality per spot, being tested now by the scope thread.
- **Option 2.** Solve against Google tiles as a research prototype, said in the write-up. Already tested (7 of 12). Breaks the policy's bans on image analysis and derived content, and a judge may call it out.

Until the scope thread reports, the solver is built against `SceneSource` with a synthetic test, so either option drops in.

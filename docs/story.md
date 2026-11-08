# The ShotMatch story bible

How every track is told, in one place. The site (`site/`), the Devpost text (`DEVPOST.md`) and the track videos follow
this file. When a principle changes, it changes for every track. Every number here comes from a file in this repo or a
worker report; where nothing was measured, the text says "not measured".

**Headline:** Stand where the photo was taken. Then make the shot yours.

**Under it:** Drop a photo of a place. ShotMatch finds where the photographer stood, which way they faced and what lens
they used, rebuilds the place as a 3D set, and your group plans its own version there together, from a browser, a text
thread or a phone call.

**Pitch line (from the research in `PROBLEM.md`):** Google Lens tells you what's in the photo. ShotMatch tells you where
to stand.

## Principles for every track

1. **Problem first: you saw a shot and want your own.** A photo shows you a place but not where to stand. Google Lens
   names the landmark; the standing spot, the direction and the zoom stay guesswork. People ask strangers online, message
   photographers who often won't say, or walk around until it lines up, and a phone on 1x still gets a different picture
   when the original used a longer lens. Evidence in `PROBLEM.md`: an r/AskPhotography couple whose photographer "just
   couldn't get the focal length/settings right" (1,215 upvotes), a wedding photographer who couldn't find her sister's
   elopement spot, guides to our own demo shot that disagree on the block. The tools that exist each do one side of the
   gap: Lens names the place, Locationscout lists known spots, PhotoPills plans the sun once you know where you stand,
   ghost-overlay apps help once you're there. ShotMatch does the step between them.
2. **The virtual set is the environment everything runs in.** Entering a spot builds the place as a 3D set you work in
   like a film set: people, props, lights and cameras with real lenses. Every object is a row in SpacetimeDB, so every
   feature (Nemotron's edits, a texted photo, a phone call, a geodata layer) acts on the same set and everyone sees it.
   Lead with the set, then the sponsor feature that runs on it.
3. **Real optics, not filters.** The answer is a position, a heading and a 35 mm-equivalent focal length solved from
   the photo's geometry. The studio's camera has real bodies and lenses (19 bodies and 67 lenses typed from maker
   specs, with 59 of the lenses matched to measured distortion and vignetting in the lensfun database), thin-lens depth of field, an exposure meter and
   the real sun position (suncalc). A render puts your objects into your own photo with shadows cast from that sun;
   the AI generator is blended only around the objects, so the rest of the photo stays pixel for pixel.
4. **The place is rebuilt from our own photos. Map tiles are for display only.** The solver matches against an open
   structure-from-motion model built from 155 Creative Commons photos (127 registered). The 3D world is Earth (Google
   Photorealistic 3D Tiles, with Google's credits on screen) plus Clay + photo: clay massing from NYC building footprints
   with the user's photo projected from where it was taken. Tiles never enter a render, an export or an AI step, which
   keeps us inside the Map Tiles policy. No splat imagery anywhere (Ben, Nov 8): it was not clear enough at street level.
5. **Live together.** A photographer in Studio, a friend in Simple, a scout on the street and Nemotron edit one set at
   the same moment, with cursors, laser pings and presence. Nothing between them but SpacetimeDB.
6. **Reachable by text and call.** Most people on a shoot will never open a 3D editor. The set reaches them on
   iMessage, Telegram, SMS, WhatsApp Business and email through Photon, and by phone call, each in that app's form.
7. **Honest answers.** Under 200 matches is "Couldn't place", not a confident wrong pin. Every render says "AI
   interpretation". Every page names what failed and what ran instead.
8. **Real numbers only.** Quote measured numbers with where they came from. If it wasn't measured, say "not measured".
   Never round up.
9. **Label what is core and what is the track.** Core is what every track stands on: the solver and spot model, the set
   (Studio and Simple), the optics, the render compositing, the geodata layers. The track part is what the sponsor's
   product adds. Every feature says why it is there and which criterion it serves.
10. **ShotMatch is a suite, not one screen:** Simple (phone-first, for anyone), Studio (the pro set editor), the scout
    page with the ghost overlay, the text threads and the phone line, the public library of shots and props, live
    geodata, and the docs at the site.
11. **Safe by design.** ShotMatch can only place a photo at a spot we mapped, and we map public, already-famous places.
    Nemotron Content Safety screens every upload and command. Position is shared only while the camera page is open.

### Two views, one set

- **Simple** (`/` and `/p/<code>`): light, phone-first. Drop a photo; "Found it" shows the photo over the 3D view with
  a blend slider, the confidence in plain words, the facing (4 degrees N on the demo), the lens as "2.2x on your
  iPhone's main camera" with the 53 mm equivalent in small type, the mark and the next good light; "Make it yours" has
  one-tap presets (golden hour, add a friend, portrait look, wider) and "Describe a change"; "Take me there" is the
  ghost overlay over the live camera.
- **Studio** (`/studio/<code>`): the "Darkroom" set editor. Outliner, asset library, gizmos, Through Cam A with real
  lens, depth of field and overlays, the camera inspector, render layers, the Nemotron command bar, the timeline with
  golden and blue hour, the Live data inspector, Conditions.
- Both read and write the same rows, so a friend on Simple and a photographer on Studio edit one shot together. One
  toggle switches between them.

### The four-step flow (landing page, every video's spine)

1. **Drop a photo.** Safety check, spot pick, lens read, solve, with each step shown.
2. **Found it.** Where to stand, which way to face, which lens, how sure, next good light.
3. **Make it yours.** Place friends and props, change the lens and the light, describe a change, render.
4. **Take me there.** Walk to the mark with the original as a ghost over your camera; friends watch your dot move.

### Core numbers (quote these, with their source)

| Claim | Number | Source |
|---|---|---|
| DUMBO spot model | 155 Commons photos, 127 registered, 11 dropped by the mirror filter | `BUILD.md` build log, `spots/nyc_dumbo/spot.json` |
| Held-out photos placed | 10 of 11; 9 within 25 m of their phone GPS; median 14 m | `spots/nyc_dumbo/eval.md` |
| Focal length | median error 3% on held-out photos | `spots/nyc_dumbo/eval.md` |
| Solve time | 11.0 to 18.5 s a photo, median 15.8 s (linuxbox CPU) | `spots/nyc_dumbo/eval.md` |
| The honest miss | T3: 75 matches, "Couldn't place" | `spots/nyc_dumbo/eval.md` |
| Demo shot (session A9TVAN) | Solid, 1,690 matches, 52.9 mm, facing 4 degrees N, camera 1.0 m up | Simple screenshot, `lens/RESULTS.md` |
| Georegistration | median residual 7.3 m | `BUILD.md` |
| Lens dataset | 4,500 Commons photos, 37 landmarks, 3 landmarks held out whole (480 test photos) | `lens/RESULTS.md` |

## Videos

Ben does not film himself. Every track video is a screen recording of the live app (https://104-238-146-229.sslip.io,
session A9TVAN and the test session ZJNNGP), recorded after the build, with narration added later (typed captions or
a voice track). Each track page carries its shot list: timestamps, what is on screen, the narration line, and the
sponsor criterion each beat shows. Videos run 1 to 3 minutes. Photon lines that need Ben's dashboard steps (SMS,
voice, email, WhatsApp, iMessage) are recorded only once they are live; until then the Photon video uses the
end-to-end run against the stand-in, and says so on screen.

## Per-track stories

### NVIDIA: Nemotron, beyond a chatbot

**Best shown in:** Studio, with Simple's "Describe a change" and the text threads.

**Story.** Nemotron does the work between your words and the set. It is a set of workflows, not a chat box: each step
writes an `agent_step` row, so the studio shows the trace while it works.
- Text to set: "two friends walking toward camera, a red vintage bike on the left wall, warm string lights" became 16
  rows in 6.6 s and 13.1 s (two runs). Lightning routes in 0.23 s; Super plans with reasoning on and calls set tools
  that turn "left third, 5 m away" into metres through the shot camera.
- Rebuild the scene from the photo: Super VL found 10 vehicles, a street lamp and a yellow umbrella in the DUMBO photo
  and placed stand-ins where they stood, in 5.8 s.
- The render checks its own physics: composite 0.6 s, Super VL check 3.9 s (failed: "lit from a low side angle while
  the real scene is flat overcast"), strength raised to 0.70, re-render, check 5.5 s, Nano Omni second opinion 1.2 s,
  29 s in total.
- Generation into the set at real size (TRELLIS; a sedan from a photo came out 4.6 x 1.85 x 1.45 m), art director
  (21.6 s, one-click fixes), call sheet inside the real golden-hour windows plus a cuOpt walking route (58 s first call),
  voice with Parakeet (0.6 to 1.0 s) and Magpie (0.8 to 1.1 s), offline with Bolt on the Vultr CPU (30.8 s), search with
  Nemotron embeddings and the VL reranker, Content Safety on every input (0.51 s text, 1.9 s with an image).
- Our own model: a LoRA fine-tune of Nemotron Nano 12B v2 VL that reads the lens of any photo, served by vLLM on an
  A100. On 480 photos from landmarks it never saw: 72.4% long-lens recall (OpenAI zero-shot 48.3%, the base Nano 12.6%),
  balanced bin accuracy 36.8% (base 27.1%), median error 16.7% (base 22.6%). It does not beat "always wide" on plain bin
  accuracy (55.6% against 57.5%) and reads normal lenses as wide (7 of 82 right), so only reads of 70 mm or more narrow
  the solver; shorter reads are advisory. 44 minutes of training, first attempt.

**Why NVIDIA:** open weights we fine-tuned and self-host; one family from CPU to datacenter (Bolt, Lightning, Super)
with the same tools; a reasoning switch per call; vision; speech.

**Core vs track.** Core: the solver, the set, the optics, the compositing. Track: every model above and the workflows
that call them.

**Known limits.** FLUX.1-dev returned HTTP 500 on every base call and accepts only example images in depth and canny
modes, so the render pass blends Qwen-Image 2.1 on Vultr and names it. TRELLIS text mode failed on about half of the
calls (HTTP 500); a failed prop becomes a flat cut-out. Cosmos Reason2 and NVIDIA's Content Safety id return 404 for
our key (Nano Omni and Vultr's copy stand in). The lens model's limits are above. Also tried, one line only: We trained a Gaussian splat of the spot on an NVIDIA A100 and cleaned it with NVIDIA Difix3D; at street level it wasn't clear enough to ship, so the 3D world uses Google's tiles and our clay model with the user's photo projected onto it.

### SpacetimeDB: the set is the database

**Best shown in:** Studio with the People and live data drawer open (the People button), plus a second browser and the scout phone.

**Story.** SpacetimeDB is the whole backend of the shared set: one TypeScript module on Maincloud, with no server,
websocket layer, queue or cron of ours. The browser, the scout's phone, the GPU worker (the crew), the phone agent and
the iMessage bridge all read and write the same rows. It powers the primary function: without it there is no set.
- Row-level security: an outsider subscribed to every table receives 0 rows of a session until they join by code.
- Scene history: undo anyone's change, scrub the set back in time and restore it; a text thread is a version tree over
  that history (reply to v1, get v1.1).
- Job leases: kill the crew mid-solve and the 10 s sweep requeues the job.
- Event tables for cursors, laser pings and camera follow (never stored), capped by the official Rate Limit module (a
  12-ping burst: 7 through, 5 refused).
- Schedules: presence, a live sun (600x moved the set 30.0 minutes in 3.2 s), golden-hour reminders, a 15-minute
  weather and NWS refresh fetched by the database itself.
- A procedure calls Nemotron 3.5 Lightning from inside the database to title a shoot (121 to 126 ms).
- HTTP routes: health, a public share link, the ElevenLabs post-call webhook with the HMAC checked in the module.
- A second database, `shotmatch-library`, receives props and shots through inter-database outboxes; real TRELLIS props
  went through it in production.
- Load test: 3 clients dragging at 10 Hz for 30 s, 900 of 900 committed, median round trip 42 to 50 ms.

**Core vs track.** The whole live layer is the track. The solver and the renders are core work the crew does through
SpacetimeDB job rows.

**Known limits.** Row-level security is marked experimental; `session_member` is public (numeric ids and anonymous
identities, no names or content); clients with old bindings crash on appended columns, so every such publish is
followed by a crew redeploy. The repo must be public for this track: Ben makes it public after a gitleaks scan.

### Photon: the set in your texts

**Best shown in:** the text threads, with the studio on screen beside them.

**Story.** Most people on a shoot won't install anything, and the scout's hands are full. Photon brings the set to
them. Five mechanisms:
1. One live set, everyone on their own channel: a render arrives on iMessage as the image and one line, on Telegram as
   an album of 35, 50 and 85 mm crops with a progress message edited in place, by email with the image attached, on SMS
   as a link. Invites by text ("add Maya +1 469 555 0144 on SMS").
2. Call the set: a voice agent on a Photon number guides you ("Turn left 26 degrees, then walk 12 m north.") and edits
   the set by voice while planners watch, then texts the framing after you hang up.
3. Check in by photo: "You're 3.2 m east of the mark and facing 14 degrees too far left."
4. The thread is the version tree: reply to v1 in any app and the set forks to v1.1.
5. Golden-hour alerts with your walking time, falling back to the next channel when iMessage refuses a late send.
Plus a photo of one object becomes a 3D prop in the set.

**Evidence.** The production crew went live on Photon's API and event stream at 12:30 AM CT Sunday and connected a managed Telegram bot
over the API. Live on Telegram: Between 12:42 and 1:24 AM CT on Nov 8, through Photon's live API and the managed Telegram bot @ShotMatchSetBot, a photo was located ("Solid ... 1600 matches ... 54 mm"), a set edit came back as v1 with its render, a native reply to v1 forked the set to v1.1, "versions" listed the tree, a street photo was solved as a check-in ("You're 9.3 m south of the mark. Step forward 12 paces, then 4 paces to your left."), a texted lamp became a prop (a flat cut-out: the hosted photo-to-3D model returned an error), and a render started in the studio arrived in Telegram on its own as an album of lens options. A golden-hour alert fired by the SpacetimeDB schedule (a test scheduled a minute out) reached Telegram at 1:24 AM CT with the conditions at the mark: "Clear sky, poor colour chance (20/100), wind 9 mph; low tide 1:47 PM (0.2 ft)" and the scaffolding nearby. Screenshots: `web/screenshots/photon-live-*.png`.
The other lines need numbers, DNS and testers set up by hand in Photon's dashboard, so all five mechanisms were proven
end to end against a stand-in for Photon's Beta API (real crew, real SpacetimeDB module, real NVIDIA models): 29 of 29
checks. Say this plainly on every Photon surface.

**Voice-call prize.** Call the set: `guide_me` and `edit_set`, framing after `call.ended`, transcript into SpacetimeDB.
Waits on a Photon number with a SIP profile pointed at ElevenLabs (Ben's dashboard step 5).

### HackUTD Best Design

**Story.** The design was done before the code: three directions in Figma for the answer (A Viewfinder, light; B
Darkroom, dark instruments; C Call sheet, editorial), then a round 3 for the virtual set. B became Studio and A became
Simple, so a pro and a casual user each get their own interface over the same live set. Signature controls explain the
answer: a compass cone draws the lens's field of view, a lens ring shows where 53 mm sits, the photo blends over the 3D
view. Honesty is designed in: "Couldn't place", "AI interpretation", Google's credits on every tile view, the photo
credit on every frame. Text contrast passes AA in the Figma frames. Figma file QrpLuCwKGGFFBSDRMd7VqS.

### MLH Best Use of Vultr

**Story.** Production runs on Vultr: one VM in Dallas (12 vCPU, 24 GB, Ubuntu 24.04) runs Caddy with automatic HTTPS,
the crew, the solver and Ollama with Nemotron 3.5 Bolt for the offline path; Vultr Object Storage keeps photos, previews
and generated props; Vultr Serverless Inference runs Nemotron Content Safety (our primary safety path), Nemotron 3 Nano
Omni, Qwen-Image 2.1 (the render generator while FLUX is down) and Whisper. This site is served from the same VM.
Limit: Vultr refused the GPU instance (no credit, then the monthly fee limit), so the lens fine-tune ran on a Brev
A100 from the HackUTD NVIDIA credit.

### MLH Best Domain Name from GoDaddy Registry

Only if Ben buys a domain. Steps in `ops/DOMAIN.md`. Until then the app and site run on sslip.io names.

### Overall (automatic)

Lead with the problem and the honest solver, then the set, then one live moment that crosses tracks: a judge's phone
joins, the scout walks, Nemotron edits from a sentence, the render lands in the text thread.

## Status

| Track | Story | Waits on |
|---|---|---|
| NVIDIA | decided | nothing |
| SpacetimeDB | decided | repo made public (Ben) |
| Photon | decided | Photon dashboard lines (Ben, `crew/PHOTON.md`) |
| HackUTD Best Design | decided | nothing |
| MLH Vultr | decided | nothing |
| MLH GoDaddy | not entered | a domain (Ben) |

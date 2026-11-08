# Devpost submission, ready to paste

Everything for the Devpost page, field by field, in the format we used for GurtOS at Cal Hacks. The text follows
`docs/story.md`; when a track changes, change the story, the site page and this file together. The current Devpost
entry named "bean" is a placeholder: replace its fields with these. Final deadline Sunday Nov 8, 12:00 PM CT.

Placeholders still open are marked **TODO** and listed at the end.

## Project name

ShotMatch

## Elevator pitch (200 characters max)

Drop a photo of a place. ShotMatch finds where the photographer stood, the heading and the lens, then your group plans its own version in a live 3D set, even by text.

(169 characters.)

## Video

**TODO:** the main video link (2 to 3 min screen recording). The shot list for each track's video is on its site page
under "Video": https://site.104-238-146-229.sslip.io/tracks/

## Image gallery (upload in this order)

All in `site/public/devpost/` and served at https://site.104-238-146-229.sslip.io/devpost/. The first is the thumbnail. Images 1, 5 and 6 were retaken from production on Nov 8 at about 1:45 AM ET, after the horizon-label and geo-dots fixes, and 3 at about 2:02 AM ET from a fresh render of the current set; regenerate with `node site/scripts/devpost-images.mjs`.

1. `1-studio-camera.jpg`. Caption: "Studio, looking through Cam A: your photo as the backplate, two placed people, focus on a person, the horizon marked in the margin".
2. `2-simple-found.jpg`. Caption: "Simple: where to stand, which way to face, and the lens as 2.2x on your iPhone".
3. `3-render.jpg`. Caption: "Through Cam A beside a fresh AI render of the same two people, labelled AI interpretation, with Nemotron's physics check on the right".
4. `4-phones.jpg`. Caption: "The four steps on a phone: drop, found it, make it yours, take me there".
5. `5-live-data.jpg`. Caption: "Two people on one set: the People panel and the live SpacetimeDB feed of every edit".
6. `6-conditions.jpg`. Caption: "Conditions: sunset colour, tide, street shadow, scaffolding and where photographers stood, on one map".

## Try it out (links)

- https://site.104-238-146-229.sslip.io (the site: what it is, one page per track, the docs)
- https://104-238-146-229.sslip.io/p/A9TVAN (the app, opened on the Manhattan Bridge demo shoot)
- https://104-238-146-229.sslip.io/studio/A9TVAN (the same shoot in Studio)
- **TODO:** the GitHub repo once Ben makes it public (SpacetimeDB requires a public repo)
- https://www.figma.com/design/QrpLuCwKGGFFBSDRMd7VqS (the design file; private: **TODO** Ben, share it as "anyone with the link can view" before pasting, or leave it out)

## Built with

nvidia-nemotron, nvidia-nim, vllm, cuopt, riva, spacetimedb, photon, elevenlabs, vultr, typescript, react, three.js, react-three-fiber, node.js, python, fastapi, colmap, pycolmap, lightglue, google-3d-tiles, maplibre, astro, caddy, figma

## Prizes to select on the submission form

Match the exact names in Devpost's list: the NVIDIA Nemotron track, the Spacetime track, the Photon track (and the
Photon voice-call prize if it is a separate category), HackUTD Best Design, [MLH] Best Use of Vultr. Add [MLH] Best
Domain Name from GoDaddy Registry only if Ben registers a domain (`ops/DOMAIN.md`). Overall is automatic.

---

## About the project (PASTE THIS)

<!-- DEVPOST START -->

**Start here: https://site.104-238-146-229.sslip.io**, with a page per sponsor track and the docs.

- Try it: https://104-238-146-229.sslip.io/p/A9TVAN (the Manhattan Bridge demo shoot; Studio at `/studio/A9TVAN`)
- Video: **TODO**

## Stand where the photo was taken. Then make the shot yours.

Drop a photo of a place. ShotMatch finds where the photographer stood, which way they faced and what lens they used,
rebuilds the place as a 3D set, and your group plans its own version there together, from a browser, a text thread or
a phone call.

![Studio, looking through the shot camera](https://site.104-238-146-229.sslip.io/devpost/1-studio-camera.jpg)

## Inspiration

You see a great photo of a place and want your own. Google Lens names the landmark in a second, but the standing spot,
the direction and the zoom are guesswork. People ask strangers online, message photographers who often won't say, or
walk around until it lines up. A couple on r/AskPhotography (1,215 upvotes) wrote that their photographer "just
couldn't get the focal length/settings right". Guides to our own demo shot, the Manhattan Bridge from Washington St in
DUMBO, disagree on which block to stand on. The tools that exist each cover one side: Lens names the place, spot
directories list known spots, PhotoPills plans the sun once you know where you stand, ghost overlay apps help once
you're there. Nothing does the step between them.

## What it does

1. **Drop a photo.** Nemotron Content Safety screens it, the spot is picked from its GPS or a name, our fine-tuned
   Nemotron reads the lens, and the solver matches it against our 3D model of the spot. Each step shows as it runs.
2. **Found it.** Where to stand, which way to face (4 degrees N on the demo), the lens as "2.2x on your iPhone's main
   camera" with the 53 mm equivalent, how sure it is (Solid, Check this, Couldn't place), and the next good light. The
   photo blends over the 3D view so you can check the answer yourself.
3. **Make it yours.** The place becomes a 3D set you work in like a film set: people, props, lights and cameras with
   real bodies and lenses. Say "two friends walking toward camera, a red vintage bike on the left wall" and Nemotron
   places them. Move the sun to golden hour. Render, and your objects land in your own photo, labelled AI
   interpretation.
4. **Take me there.** Walk to the mark with the original as a ghost over your camera while friends watch your dot.

**Two views over one live set.** Simple is light and phone first, for anyone. Studio is the "Darkroom" set editor for
photographers. A friend on Simple and a photographer on Studio edit one shot together.

**Off the laptop.** The set reaches people on iMessage, Telegram, SMS, WhatsApp and email through Photon, and you can
call it: a voice agent guides you to the mark and edits the set as you talk.

![Simple: the answer](https://site.104-238-146-229.sslip.io/devpost/2-simple-found.jpg)

## How we built it

- **Locating the camera (core).** For each spot we build an open structure-from-motion model: 155 Creative Commons
  photos of the DUMBO view, 127 registered (MegaLoc retrieval, SuperPoint and LightGlue, COLMAP mapping, georegistered
  with photo GPS, a mirror filter for the symmetric bridge tower). A new photo is matched against it and solved for
  position, heading, focal length and lens distortion. On 11 held-out photos from other photographers, 10 were placed,
  9 within 25 m of their phone GPS, with a median focal error of 3% and a median solve of 15.8 s on a CPU. The 11th had
  75 matches, and ShotMatch said "Couldn't place" instead of guessing.
- **The virtual set (core).** three.js with React Three Fiber. The 3D world is Google Photorealistic 3D Tiles (the
  Earth view, with Google's credits on screen) and our clay model of the block from NYC building footprints with the
  user's photo projected onto it from where it was taken. Tiles never enter a render, an export or an AI step. The camera
  has 19 real bodies and 67 lenses, 59 with measured distortion and vignetting from lensfun, and thin-lens depth of
  field.
- **The render (core).** The studio renders beauty, shadow, depth and mask layers of your objects only. The crew
  multiplies their shadows into your photo at its shadow softness, matches exposure, colour and grain, and blends a
  generator in only around the objects, so the rest of your photo stays pixel for pixel.
- **Live geodata (core).** Weather and sunset colour chance, haze, NWS alerts, tides, NYC film permits, closures and
  scaffolding, real building shadows on the street, and where Commons photographers stood, in the set, on a 2D map and
  in the AI's context.
- **NVIDIA, SpacetimeDB, Photon, Vultr:** below.

## NVIDIA: Nemotron, beyond a chatbot

Nemotron does the work between your words and the set, as workflows, and every step writes a row the studio shows
live.

- **Text to set.** Content Safety (on Vultr) screens the sentence while Nemotron 3.5 Lightning routes it in 0.23 s;
  Nemotron 3.5 Super plans with reasoning on and calls our set tools, which turn "left third, 5 m away" into metres
  through the shot camera. Two friends, a red bike and warm string lights: 16 objects in 6.6 s and 13.1 s.
- **Rebuild the scene from the photo.** Super VL found 10 vehicles, a street lamp and a yellow umbrella in the DUMBO
  photo and placed stand-ins where they stood, in 5.8 s.
- **A render that checks its own physics.** Super VL checks each placed object's light, shadow, scale and colour
  against the photo. On a fail the crew changes the blend strength and renders again (29 s in total on our test, with
  Nemotron 3 Nano Omni as a second opinion in 1.2 s).
- **Generation at real size.** Words or a photo of your own bike become a 3D prop through TRELLIS, at the size Super
  gives (a sedan from a photo: 4.6 x 1.85 x 1.45 m). Any image becomes a poster, sign or screen.
- **Art director, call sheet, route.** Super critiques the composition with one-click fixes, writes a call sheet inside
  the real golden-hour windows, and cuOpt orders the walk.
- **Voice and offline.** Parakeet transcribes hold-to-talk in 0.6 to 1.0 s, Magpie speaks the reply in 0.8 to 1.1 s.
  With the hosted API down, Nemotron 3.5 Bolt runs on our Vultr VM's CPU through Ollama and places the same edits
  (30.8 s).
- **Our own model.** We fine-tuned Nemotron Nano 12B v2 VL with LoRA to read the lens of any photo and serve it with
  vLLM on an A100. On 480 photos from three landmarks it never saw, it flags 72.4% of long-lens photos (OpenAI zero
  shot 48.3%, the base model 12.6%). It does not beat "always wide" on plain bin accuracy (55.6% against 57.5%) and
  reads normal lenses as wide, so only its long-lens reads narrow the solver.

What failed: FLUX.1-dev returned HTTP 500 on every base call, so the render generator is Qwen-Image on Vultr, and every
result names the model that ran. Also tried: We trained a Gaussian splat of the spot on an NVIDIA A100 and cleaned it with NVIDIA Difix3D; at street level it wasn't clear enough to ship, so the 3D world uses Google's tiles and our clay model with the user's photo projected onto it. Details: https://site.104-238-146-229.sslip.io/tracks/nvidia/

## SpacetimeDB: the set is the database

SpacetimeDB is the whole backend of the shared set: one TypeScript module on Maincloud, with no server, websocket
layer, queue or cron of ours. Every person, prop, light and camera is a row that the browsers, the scout's phone, our
GPU worker, the phone agent and the messaging bridge all share.

- **Row-level security:** an outsider subscribed to every table receives nothing of a session until they join by code.
- **Time travel:** undo anyone's change, scrub the set back and restore it. A text thread is a version tree over that
  history: reply to v1 and the set forks to v1.1.
- **Job leases:** kill the worker mid-solve and a 10 s sweep in the database requeues the job.
- **Ephemeral events** for cursors, laser pings and camera follow, never stored, rate-limited by the official Rate
  Limit module (a 12-ping burst: 7 through, 5 refused).
- **Schedules:** presence, a live sun every client shares (600x moved the set 30 minutes in 3.2 s), golden-hour
  reminders, and a 15-minute weather refresh the database fetches itself.
- **A procedure** calls Nemotron 3.5 Lightning from inside the database to title a shoot (121 to 126 ms).
- **HTTP routes** in the module: health, a public share link, and the phone agent's post-call webhook with its HMAC
  checked in the module.
- **A second database**, `shotmatch-library`, receives generated props and shared shots through inter-database
  outboxes, so a prop made in one shoot shows up in every shoot's library.
- **Load test:** 3 clients dragging objects at 10 Hz for 30 s, 900 of 900 edits committed, median round trip 42 to
  50 ms.

Details: https://site.104-238-146-229.sslip.io/tracks/spacetime/

## Photon: the set in your texts

Most people on a shoot won't install anything, and the scout's hands are full. Photon brings the set to them.

1. **One live set, everyone on their own channel.** A render arrives on iMessage as the image and one line, on
   Telegram as an album of 35, 50 and 85 mm crops with a progress message edited in place, by email with the image
   attached, on SMS as a link. Invite by text: "add Maya +1 469 555 0144 on SMS".
2. **Call the set.** A voice agent on a Photon number guides you from your phone's live position ("Turn left 26
   degrees, then walk 12 m north.") and edits the set as you talk while planners watch, then texts the framing after
   you hang up.
3. **Check in by photo.** Text a photo from where you stand: "You're 3.2 m east of the mark and facing 14 degrees too
   far left."
4. **The thread is the version tree.** Reply to v1 in any chat app and the set forks to v1.1.
5. **Golden-hour alerts** with your walking time, sent on the next channel when the shared iMessage line refuses.

A photo of one object becomes a 3D prop in the set. Status, plainly: live on Telegram. Between 12:42 and 1:24 AM CT on Nov 8, through Photon's live API and the managed Telegram bot @ShotMatchSetBot, a photo was located ("Solid ... 1600 matches ... 54 mm"), a set edit came back as v1 with its render, a native reply to v1 forked the set to v1.1, "versions" listed the tree, a street photo was solved as a check-in ("You're 9.3 m south of the mark. Step forward 12 paces, then 4 paces to your left."), a texted lamp became a prop (a flat cut-out: the hosted photo-to-3D model returned an error), and a render started in the studio arrived in Telegram on its own as an album of lens options. A golden-hour alert fired by the SpacetimeDB schedule (a test scheduled a minute out) reached Telegram at 1:24 AM CT with the conditions at the mark: "Clear sky, poor colour chance (20/100), wind 9 mph; low tide 1:47 PM (0.2 ft)" and the scaffolding nearby. Screenshots are on the Photon page. iMessage, SMS, voice calls, email and
WhatsApp Business need a number, DNS or Meta signup, so the call, the fallback between channels and those channels were proven end to end against a stand-in for Photon's Beta API with
the real crew, the real SpacetimeDB module and real NVIDIA models: 29 of 29 checks.

Details: https://site.104-238-146-229.sslip.io/tracks/photon/

## HackUTD Best Design

We designed before we coded: three directions in Figma for the answer (A Viewfinder, light; B Darkroom, camera
instruments on near-black; C Call sheet, editorial), then a round for the virtual set. Darkroom became Studio, where
the scene, the photo and the render are the brightest things on screen. Viewfinder became Simple, phone first, the
answer in large type. The controls explain the answer: a compass cone draws the lens's field of view, a lens ring shows
where 53 mm sits, the photo blends over the 3D view. Honesty is designed in: "Couldn't place", "AI interpretation",
Google's credits on every tile view, the photographer's credit on every frame.

Details: https://site.104-238-146-229.sslip.io/tracks/design/

## MLH: Best Use of Vultr

Production runs on Vultr: a VM in Dallas (12 vCPU, 24 GB) runs Caddy with automatic HTTPS, the crew, the solver and
Ollama with Nemotron 3.5 Bolt for the offline path. Vultr Object Storage keeps photos, renders and generated props.
Vultr Serverless Inference runs Nemotron Content Safety (our primary safety path), Nemotron 3 Nano Omni, Qwen-Image and
Whisper. The site is served from the same VM. Vultr refused our GPU instance (no credit, then the monthly fee limit),
so the lens fine-tune ran on a Brev A100 from the HackUTD NVIDIA credit.

Details: https://site.104-238-146-229.sslip.io/tracks/vultr/

## Challenges we ran into

- Google's Map Tiles terms ban image analysis of their tiles, so we rebuilt the solver to match against our own open
  3D model and use Google only for display.
- A symmetric bridge tower registered 11 training photos facing the wrong way; the spot build drops photos whose solved
  heading disagrees with their compass by more than 90 degrees.
- Far, flat scenes let the camera slide along its line of sight while the focal length compensates. A lens read
  narrows the search, but only where our lens model is good (long lenses).
- Several hosted models failed on the night (FLUX 500s, TRELLIS failing about half its calls, Cosmos Reason2 404).
  Every step has a named fallback, and the result says which model ran.

## Accomplishments that we're proud of

- An honest solver: 10 of 11 held-out photos placed with a 3% median focal error, and a clear "Couldn't place" on the
  one it couldn't.
- A real lens model of our own: 72.4% long-lens recall on landmarks it never saw, trained in 44 minutes on the first
  attempt.
- One live set shared by a laptop, a phone, a GPU worker, a text thread and a phone call, with nothing between them but
  SpacetimeDB.

## What we learned

The honest answer is often "Couldn't place". We measured everything on held-out data, and we report the misses: the
lens model's weakness on normal lenses, and which hosted models did not answer.

## What's next

More spots, starting with a UTD campus spot shot by us. A calibrated confidence score. The lens reader on the phone.
VR: the set already enters WebXR on a headset that supports it, untested so far.

## Built with

NVIDIA Nemotron (Super VL, Lightning, Bolt, Nano Omni, Content Safety, Embed, Rerank VL, Nano 12B v2 VL with our LoRA),
NVIDIA Parakeet and Magpie (Riva), cuOpt, TRELLIS, vLLM, SpacetimeDB, Photon, ElevenLabs, Vultr (VM, Object Storage,
Serverless Inference), Brev, COLMAP, hloc, MegaLoc, SuperPoint, LightGlue, three.js, React Three Fiber,
Google Photorealistic 3D Tiles (display only), MapLibre, React, Vite, Astro, Caddy, Figma.

Photo credits: every Creative Commons photo in the spot model and the lens dataset is listed with its author
and license at https://site.104-238-146-229.sslip.io/credits/

<!-- DEVPOST END -->

## Open TODOs (Ben)

- Team members (up to 4) on the Devpost form.
- The main video link, and each track video (shot lists on the track pages).
- Make the repo public after the gitleaks scan, then add the GitHub link here, in `site/src/site.ts` (`REPO`) and on
  Devpost.
- Photon dashboard lines (`crew/PHOTON.md`), so the iMessage, SMS, voice, email and WhatsApp beats can be recorded live.
- A domain, if entering GoDaddy (`ops/DOMAIN.md`).

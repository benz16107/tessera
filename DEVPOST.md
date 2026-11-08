# Devpost draft (submit by Sat 11 PM CT; final by Sun 12:00 PM CT)

Ben fills in: team members (max 4), and confirms the tracks. Numbers marked "so far" get updated Sunday morning from `spots/*/eval.md` and `lens/RESULTS.md`.

**Project name:** ShotMatch

**Tagline:** Find where a photo was taken from, then plan your own version of the shot.

**Tracks:** NVIDIA (Nemotron), SpacetimeDB, Photon (plus the voice-call prize), HackUTD Best Design, MLH Best Use of Vultr, MLH Best Domain Name from GoDaddy Registry.

## Inspiration

You see a great photo of a place and want to take your own. Nothing tells you where the photographer stood, which way they pointed or what lens they used, and planning it with friends means a group chat full of screenshots.

## What it does

Send ShotMatch a photo of a place. It finds where the photographer stood, which way they pointed and what lens they used, and lays the photo over a 3D view of the place so you can check it yourself. Then you plan your version: switch lenses, place your friends, pick the light, and get a preview. Your crew plans in one live scene while a scout at the real spot walks to the mark, with the original photo as a ghost over their camera. You can do it from the web, by iMessage, in a Telegram group, or by phone call.

## How we built it

- **Locating the camera.** For each spot we build an open 3D model with structure-from-motion. Our first spot, the Manhattan Bridge view in Brooklyn, comes from 155 Creative Commons photos, of which 127 registered (MegaLoc retrieval, SuperPoint and LightGlue features, COLMAP mapping, aligned with photo GPS). A new photo is matched against the model, which gives position, heading and focal length with lens distortion in 11 to 18 seconds. On 11 held-out photos from other photographers, 10 were placed, 9 of them within 25 m of their phone GPS, with a median focal-length error of 3%. The eleventh had too few matches, and ShotMatch said "Couldn't place" instead of guessing.
- **NVIDIA.** Nemotron does the work between your words and the set, as workflows rather than a chatbot, and every step shows live in the studio. Say "two friends walking toward camera, a red vintage bike on the left wall, warm string lights": Nemotron Content Safety (on Vultr) screens it while Nemotron 3.5 Lightning routes it in 0.23 s, and Nemotron 3.5 Super plans it with reasoning on, calling our set tools that turn "left third, 5 m away" into metres through the shot camera (16 objects placed in about 7 s). One-object edits stay on Lightning (2 s). When the hosted API is down, Nemotron 3.5 Bolt runs on our Vultr VM's CPU through Ollama and places the same edits offline (31 s). Super VL reads your photo, finds the people, cars and props with boxes and rebuilds them in the set where they stood (12 stand-ins in 6 s), and reads its light. The render puts your objects into your own photo: their shadows are multiplied into the real ground at the photo's softness, their colour and grain matched, and a generator blended in only around them, so the street never moves. Then Nemotron checks the render's physics object by object (light direction, shadow direction, scale, colour), changes the strength and renders once more on a fail, and tells the studio which sun angle to fix. Generation lands at real size: words become a 3D prop with TRELLIS, a photo of your own bike becomes a prop after Super VL crops and describes it, and any image becomes a poster, sign or screen; Super gives the real dimensions (a sedan from a photo: 4.6 by 1.85 by 1.45 m). Super is also the art director (a composition critique with one-click fixes) and writes a call sheet timed to the real golden hour; cuOpt orders the walk. Hold to talk and Parakeet transcribes in under a second; Magpie speaks the reply. Nemotron embeddings and the Nemotron VL reranker search the asset library and the chat. We fine-tuned Nemotron Nano 12B v2 VL with LoRA to read the lens of any photo, served with vLLM on our own GPU. Every model, its job and its measured latency: `docs/NVIDIA.md`.
- **SpacetimeDB.** SpacetimeDB is the whole backend for the shared set: one TypeScript module on Maincloud, with no server, websocket layer, queue or cron of ours. Every object, person, light and camera in the 3D set is a row; the browser, the scout's phone, our GPU worker, the phone agent and the iMessage bridge all subscribe to the same rows. Row-level security delivers a session's rows only to its members and the worker (checked with two identities: an outsider receives nothing until they join by code). Ephemeral event tables carry cursors, laser-pointer pings ("Maya is pointing here") and camera-follow requests that are never stored, rate-limited by SpacetimeDB's official Rate Limit module. Every edit is recorded, so anyone can undo anyone's change or scrub the set back in time and restore it, and an iMessage thread becomes a version tree over that history ("go back to v1" forks a branch). Schedules inside the database requeue jobs from a killed worker, free gizmo locks held by frozen tabs, and run a live sun that moves every client's light together. A procedure calls NVIDIA Nemotron 3.5 Lightning from inside the database to title a shoot (about 120 ms). HTTP routes in the module serve a health check, a public JSON share link, and the ElevenLabs post-call webhook, whose HMAC signature the module verifies itself. A second database, shotmatch-library, holds the public library: a 3D prop generated in one session reaches every session through an inter-database outbox. Load test: 3 clients dragging objects at 10 Hz for 30 s, 900 of 900 edits committed, median round trip 42 to 50 ms (one network round trip). Details and line references: `docs/SPACETIME.md`.
- **Photon.** The set reaches everyone on the app they already have, and each one gets it in that app's form: a render arrives on iMessage as the image and one line, on Telegram as an album of 35, 50 and 85 mm options with one progress message edited in place, by email from our own domain with the image attached, and on SMS as text and a link. Five things a chat app can't do on its own: (1) one live set fanned out to iMessage, Telegram, SMS, WhatsApp Business and email, with invites by channel ("add Maya +1 469 555 0144 on SMS"); (2) call the set: a voice agent on a Photon number guides you turn by turn from your phone's live position ("Turn left 26 degrees, then walk 12 m north") and edits the scene by voice while planners watch, then texts the framing after you hang up; (3) text a photo from where you stand and get the correction back ("You're 3.2 m east of the mark and facing 14 degrees too far left"), with a marker in the 3D set; (4) the thread is the version tree: reply to v1 in any chat app and the set forks to v1.1; (5) golden-hour alerts with your walking time, sent on the channel that will deliver when the shared iMessage line can't. A photo of a single object becomes a 3D prop in the set. The production crew runs on Photon's live API and event stream; because the numbers, DNS and testers for each line are set up by hand, all five were also proven end to end against a stand-in for Photon's Beta API with the real crew, the real SpacetimeDB module and real NVIDIA models (29 of 29 checks). Details: `docs/PHOTON.md`.
- **Web.** React and CesiumJS with Google Photorealistic 3D Tiles for the planning view, with Google's attribution on screen. Nothing is computed from the tiles.

## Challenges

- Google's Map Tiles terms ban image analysis of their tiles, so we rebuilt the solver to match against our own open 3D models and use Google only for display.
- Far, flat scenes let the camera slide along its line of sight while the focal length compensates. A lens estimate narrows the search.
- A symmetric bridge tower made some photos register facing the wrong way; we drop photos whose solved heading disagrees with their compass by more than 90 degrees.
- High match counts can still be wrong, so confidence needs more than one signal.

## What we learned

The honest answer is often "Couldn't place". We measured everything on held-out photos and report the misses.

## What's next

More spots, a calibrated confidence score, and an offline lens reader on the phone.

## Built with

NVIDIA Nemotron 3.5 Super VL, Nemotron 3.5 Lightning, Nemotron 3.5 Bolt (Ollama), Nemotron 3.5 Content Safety, Nemotron 3 Nano Omni, Nemotron 3.5 Embed, Llama Nemotron Rerank VL, Nemotron Nano 12B v2 VL, NVIDIA Riva Parakeet and Magpie, TRELLIS, FLUX.1-dev, NVIDIA cuOpt, NVIDIA API Catalog, Vultr Serverless Inference, Ollama, vLLM, PyTorch, COLMAP (pycolmap), hloc, MegaLoc, SuperPoint, LightGlue, SpacetimeDB, Photon (iMessage, Telegram, SMS, WhatsApp Business, email, voice), ElevenLabs, CesiumJS, Google Photorealistic 3D Tiles (display only), React, Vite, Node.js, FastAPI, OpenAI gpt-image-2 (preview images), Vultr, Tailscale.

## Credits

Every Creative Commons photo used in a 3D model or the training set is listed on the app's credits page and in `spots/*/CREDITS.tsv` and `lens/CREDITS.tsv`.

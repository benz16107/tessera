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
- **NVIDIA.** Nemotron 3.5 Super VL runs the agent: it screens uploads, reads the lens, calls the solver and the sun tools, and writes the answer. Every tool call shows on screen. We fine-tuned Nemotron Nano 12B v2 VL with LoRA on 4,500 Creative Commons photos with lens metadata from 37 landmarks, holding out whole landmarks for the test, and it runs on an NVIDIA GPU on Vultr. (Results table goes here.)
- **SpacetimeDB.** Sessions, the crew, the scout's GPS and compass, solve and preview jobs with worker leases, and every text message are rows in one TypeScript module on Maincloud. The browser, the scout's phone and our worker all subscribe to the same rows. Kill the worker mid-solve and a scheduled reducer requeues the job.
- **Photon.** Text a photo over iMessage and get back the spot, the lens, the best light and a preview, then follow up in the thread ("make it 85mm"). A Telegram group plans together. Call the number and a voice agent guides you to the mark, then texts you the framing.
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

NVIDIA Nemotron 3.5 Super VL, Nemotron Nano 12B v2 VL, NVIDIA API Catalog, vLLM, PyTorch, COLMAP (pycolmap), hloc, MegaLoc, SuperPoint, LightGlue, SpacetimeDB, Photon, ElevenLabs, CesiumJS, Google Photorealistic 3D Tiles (display only), React, Vite, Node.js, FastAPI, OpenAI gpt-image-2 (preview images), Vultr, Tailscale.

## Credits

Every Creative Commons photo used in a 3D model or the training set is listed on the app's credits page and in `spots/*/CREDITS.tsv` and `lens/CREDITS.tsv`.

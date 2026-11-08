# Devpost submission, ready to paste

Everything for the Devpost page, field by field, in the structure of the final GurtOS Devpost (Cal Hacks 13). The text
follows `docs/story.md`; when a track changes, change the story, the site page and this file together. The entry named
"bean" is a placeholder: replace its fields with these. Final deadline Sunday Nov 8, 12:00 PM CT.

Placeholders still open are marked **TODO** and listed at the end.

## Project name

Tessera

## Elevator pitch (200 characters max)

Drop a photo of a place. Tessera finds where the photographer stood, the heading and the lens, then your group plans its own version in a live 3D set, even by text.

(164 characters.)

## Video

**TODO:** the main video link (2 to 3 min screen recording). The shot list for each track's video is on its site page
under "Video": https://tesseraphoto.com/tracks/

## Image gallery (upload in this order)

All in `site/public/devpost/` and served at https://tesseraphoto.com/devpost/. The first is the thumbnail.
Regenerate with `node site/scripts/devpost-images.mjs`.

1. `1-studio-camera.jpg`. Caption: "Studio's World view over Google's 3D city in DUMBO: Cam A on Washington St under the Manhattan Bridge, with the photo in the corner".
2. `2-simple-found.jpg`. Caption: "Simple: where to stand, which way to face, and the lens as 2.2x on your iPhone".
3. `3-render.jpg`. Caption: "Through Cam A beside a fresh AI render of the same two people, labelled AI interpretation, with Nemotron's physics check on the right".
4. `4-phones.jpg`. Caption: "The four steps on a phone: drop, found it, make it yours, take me there".
5. `5-live-data.jpg`. Caption: "Two people on one set: the People panel and the live SpacetimeDB feed of every edit".
6. `6-conditions.jpg`. Caption: "Conditions: sunset colour, tide, street shadow, scaffolding and where photographers stood, on one map".

## Try it out (links)

In this order, so the app is first:

- https://app.tesseraphoto.com/p/A9TVAN (the app, opened on the Manhattan Bridge demo shoot)
- https://tesseraphoto.com (the product, every track and the docs)
- https://tesseraphoto.com/tracks/ (every track in detail)
- https://github.com/benz16107/tessera (the code, public, with the full commit history of the build)
- https://www.figma.com/design/QrpLuCwKGGFFBSDRMd7VqS (the design file; private: **TODO** Ben, share it as "anyone with the link can view" before pasting, or leave it out)

## Built with

Devpost allows at most 25 tags. These 24 (comma-separated):

nvidia-nemotron, nvidia-nim, vllm, cuopt, riva, spacetimedb, photon, elevenlabs, vultr, typescript, react, three.js, react-three-fiber, node.js, python, fastapi, colmap, pycolmap, lightglue, google-3d-tiles, maplibre, astro, caddy, figma

## Prizes to select on the submission form

By their exact names in HackUTD's prize list (read through the Devpost API on Nov 8, 3:06 AM CT):

Nvidia Track, Spacetime Track, Photon Track (its Voice Call Winner prize is part of the same track), Design Track -- HackUTD Track, [MLH] Best Use of Vultr.

General Track is automatic.

---

## About the project (PASTE THIS)

<!-- DEVPOST SHORT START -->

**Try it live: https://app.tesseraphoto.com/p/A9TVAN**

- Try it live: the Manhattan Bridge demo shoot in [Simple](https://app.tesseraphoto.com/p/A9TVAN) or [Studio](https://app.tesseraphoto.com/studio/A9TVAN); drop your own photo of that view, or text one to @ShotMatchSetBot on Telegram
- Product and docs: https://tesseraphoto.com
- Every track in detail: https://tesseraphoto.com/tracks/
- Code: https://github.com/benz16107/tessera
- Video: https://www.youtube.com/watch?v=TBKutDiVhSI

## A film set for the photo you want to take

Drop a photo of a place. Tessera finds where the photographer stood, which way they faced and what lens they used, then rebuilds the place as a live 3D set your group plans in.

### Sponsor tracks: a detailed page for each

**Every sponsor track has its own page: what we built for it, where it runs in the product, the proof and the limits.** All of them: https://tesseraphoto.com/tracks/

| Track | What we built | Strongest proof | Page |
|---|---|---|---|
| NVIDIA | Nemotron runs the set: words to objects, the photo rebuilt as stand-ins, a render that checks its own physics, props at real size, call sheet, voice, offline on CPU; plus our LoRA lens reader | 16 objects from one sentence in 6.6 s; 72.4% long-lens recall on unseen landmarks | [Detailed page](https://tesseraphoto.com/tracks/nvidia/) |
| SpacetimeDB | The whole shared set is one module: every object, job, version and message is a row; no other backend | 900 of 900 edits at 10 Hz, median 42 to 50 ms; an outsider sees 0 rows until they join | [Detailed page](https://tesseraphoto.com/tracks/spacetime/) |
| Photon | The set on the apps people already use: a photo located by text, versions as reply threads, check-ins, props, alerts; a phone call that guides you | 9 live round trips on Telegram; the other channels 29 of 29 against a stand-in | [Detailed page](https://tesseraphoto.com/tracks/photon/) |
| HackUTD Virality | Built on what people already post: "where was this photo taken?" threads and recreate-the-photo posts. Every shoot is a share link that opens on a phone, and the set answers in Telegram, so a recreation spreads the way the original photo did | 103 of 1,949 Reddit posts asked where a photo was taken from, which lens, or how to recreate it; the top one has 858 points | [Research page](https://tesseraphoto.com/docs/research/) |
| MLH Vultr | Production on a Vultr VM in Dallas, Object Storage for photos and props, Serverless Inference for safety, speech and the render | Content Safety on Vultr in 0.51 s per text; the app and the site on one VM with automatic HTTPS | [Detailed page](https://tesseraphoto.com/tracks/vultr/) · [Video](https://youtu.be/fsq3ry87EZ8) |

### The problem

You see a great photo of a place and want your own version. **Google Lens names the place, but not where the photographer stood, which way they faced or which lens they used.** So people post the photo and ask strangers: a student recreating a late grandmother's graduation photo in New York had been **searching for a year** before someone recognized the corner. Even at the right corner, **a phone on 1x gets a different picture** when the original was shot from farther back with a longer lens.

### What people ask, in their own words

**We read 1,949 Reddit posts across 15 subreddits. 103 asked where a photo was taken from, which lens made it, or how to recreate it; 79 of them asked for the exact spot.**

- **"I really want to find this spot so I can return to it, sit exactly there"**, a grieving husband with a 1998 photo. r/whereisthis, 858 points: https://www.reddit.com/r/whereisthis/comments/1wx1wae/
- **"We would like to re-create it as adults."** A family photo from early-90s Manhattan. r/whereisthis, 590 points: https://www.reddit.com/r/whereisthis/comments/1wbtjkw/
- **"I can't nail the cross streets"**, the student with the grandmother's photo. r/AskNYC, 37 points: https://www.reddit.com/r/AskNYC/comments/18mo1uc/
- **"I don't think so because the compression won't be the same."** A parent asking whether a wide-angle shot can match a Rockefeller Center photo. r/AskNYC, 6 points: https://www.reddit.com/r/AskNYC/comments/qdh8gc/
- **"Golden hour is ideal but will the sun even hit this spot at that time?"** A photographer at Jay St in DUMBO, a few blocks from our demo spot. r/AskPhotography, 4 points: https://www.reddit.com/r/AskPhotography/comments/1u386p6/

![r/whereisthis: a grieving husband asks for the exact spot of a 1998 photo](https://tesseraphoto.com/research/1-whereisthis.png)

![r/AskPhotography: will the sun hit this spot in DUMBO at golden hour?](https://tesseraphoto.com/research/8-askphotography.png)

The tools in these threads (Google Earth, Street View, spot guides, sun apps) each help once you know where to stand. **Tessera starts from the photo itself: it solves the standing spot, the heading and the lens, then plans the light and the people.** Method, counts and all eight posts: https://tesseraphoto.com/docs/research/

![Studio, looking through the solved camera at the Manhattan Bridge](https://tesseraphoto.com/devpost/1-studio-camera.jpg)

### How it works: think of a film set

- **The location scout.** The solver matches your photo against our own 3D model of the spot and finds where the photographer stood, the heading and the lens. On 11 held-out photos, 10 were placed, 9 within 25 m of their phone GPS, with a median focal error of 3% in a median 15.8 s on a CPU.
- **The set.** The place rebuilt in 3D: Google Photorealistic 3D Tiles for the view (display only, never in a render), and our clay model of the block from NYC building footprints with your photo projected from where it was taken.
- **The camera.** A physical camera with 19 real bodies and 67 lenses, 59 with measured distortion and vignetting from lensfun, plus depth of field, shutter and ISO. The final render is baked through the same camera.
- **The crew.** Say "two friends walking toward camera, a red bike on the left" and Nemotron places 16 objects in 6.6 s. The AI render puts them into your own photo (about 20 s for one person, 35 to 45 s for two), and Nemotron checks each object's light, shadow and scale, then renders again on a fail.
- **The call sheet.** Date, sun, golden hour, tide and conditions on one plan. For the demo spot: golden hour 6:35 to 7:15 AM, sunrise colour chance 20 out of 100, low tide 1:47 PM (0.2 ft), a scaffold 41 m from the mark. cuOpt orders the walk between shots.
- **The walkie-talkie.** Every person, prop, light and camera is a SpacetimeDB row that every screen shares live (900 of 900 edits committed at 10 Hz, median round trip 42 to 50 ms). Texts, photo check-ins and alerts arrive through Photon, live on Telegram.

![Through Cam A beside the AI render, with Nemotron's physics check](https://tesseraphoto.com/devpost/3-render.jpg)

### Why it is better

| | Scouting today | Tessera |
|---|---|---|
| Where to stand | Guessed from Maps and Street View | Solved from the photo: position, heading, lens |
| The lens | A lens calculator and a guess | The 35 mm equivalent, and "2.2x on your iPhone" |
| The light | A separate sun app | Golden hour, tide and conditions on the plan |
| The shot | Imagined | Your people in a 3D set, rendered into your photo |
| The group | Screenshots in a group chat | One live set on a laptop, a phone or a text thread |
| When it is unsure | A confident wrong pin | "Couldn't place", and every render labelled AI interpretation |

### Proof

- **Solve:** 10 of 11 held-out photos placed, 9 within 25 m of their phone GPS (median 14 m), median focal error 3%, median 15.8 s on a CPU. The 11th had 75 matches and got "Couldn't place". One spot is mapped so far (DUMBO).
- **Render:** about 20 s for one person and 35 to 45 s for two, with a Nemotron physics check per object and one re-render on a fail. The generator is Qwen-Image 2.1 on Vultr, because FLUX.1-dev returned HTTP 500 on every base call; each result names the model that ran.
- **Live texts:** 9 round trips through Photon's live API and the Telegram bot, 12:42 to 1:24 AM CT: hello, a photo located, an edit returned as v1, a reply that forked v1.1, the version list, a photo check-in, a texted prop, a studio render fanned out as an album, and a golden-hour alert with conditions. iMessage, SMS, voice, email and WhatsApp are proven against a stand-in (29 of 29 checks), not live.
- **Live set:** the SpacetimeDB proof script passes 38 of 38 on a scratch database and 19 of 19 on production; an outsider receives 0 rows of a shoot until they join by code; the load test committed 900 of 900 edits.
- **Our own model:** a LoRA on Nemotron Nano 12B v2 VL, trained in 44 minutes on an A100, flags 72.4% of long-lens photos on landmarks it never saw (OpenAI zero-shot 48.3%, the base model 12.6%). It does not beat "always wide" on plain bin accuracy (55.6% against 57.5%), so only its long-lens reads narrow the solver.
- **Cost:** one Vultr VM runs the app; the GPU was a Brev A100 at $1.62 an hour from the HackUTD NVIDIA credit, projected at $23.60 through judging. Vultr refused a GPU instance, so Vultr GPU spend was $0.

![Two people on one set, with the live SpacetimeDB feed](https://tesseraphoto.com/devpost/5-live-data.jpg)

![Conditions at the mark on one map](https://tesseraphoto.com/devpost/6-conditions.jpg)

### Questions judges ask

- **Why not Google Earth or Street View?** They show the place, not where a given photo was taken from or with which lens. Tessera solves that from the photo against our own 3D model, built from 155 Creative Commons photos, and never analyzes Google's tiles.
- **Is the render real?** No. Every render is labelled "AI interpretation". Your photo stays as it was outside the placed objects, and Nemotron checks each object's light, shadow and scale.
- **Does it work outside DUMBO?** One spot is mapped today, the Manhattan Bridge from Washington St. A new spot takes about 150 photos and about 23 minutes on a CPU; anywhere else, Tessera says it hasn't mapped the spot instead of guessing.
- **What is core and what is per track?** The solver, the set, the camera, the render and the live geodata are core. Each sponsor's product does one job inside them: Nemotron the AI work, SpacetimeDB the live set, Photon the texts and calls, Vultr production.
- **What is next?** More spots, starting with one we shoot ourselves at UTD; a calibrated confidence score; the lens reader on the phone; the other Photon lines.

![The four steps on a phone](https://tesseraphoto.com/devpost/4-phones.jpg)

<!-- DEVPOST SHORT END -->

## Open TODOs (Ben)

- Team members (up to 4) on the Devpost form.
- The main video link, and each track video (shot lists on the track pages).
- A licence for the code (the README says none is chosen yet).
- Photon dashboard lines (`crew/PHOTON.md`), so the iMessage, SMS, voice, email and WhatsApp beats can go live.

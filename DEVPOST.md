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

- Demo shoot in [Simple](https://app.tesseraphoto.com/p/A9TVAN) or [Studio](https://app.tesseraphoto.com/studio/A9TVAN). Drop your own photo of that view, or text one to @ShotMatchSetBot on Telegram.
- Product and docs: https://tesseraphoto.com
- Code: https://github.com/benz16107/tessera
- Video: https://www.youtube.com/watch?v=TBKutDiVhSI
- Ten vertical reels for the Virality track: https://tesseraphoto.com/reels/

## A film set for the photo you want to take

Drop a photo of a place. Tessera finds where the photographer stood, which way they faced and the lens, then rebuilds the place as a live 3D set your crew plans in. It is for photographers planning a shot, location scouts and film crews, and anyone recreating a photo they love.

### Sponsor tracks: a detailed page for each

**Every sponsor track has its own page: what we built for it, where it runs in the product, the proof and the limits.** All of them: https://tesseraphoto.com/tracks/

| Track | What we built | Strongest proof | Page | Video |
|---|---|---|---|---|
| NVIDIA | Nemotron runs the set: words to objects, the photo rebuilt as stand-ins, a render that checks its own physics, props at real size, call sheet, voice, offline on CPU; plus our LoRA lens reader | 16 objects from one sentence in 6.6 s; 72.4% long-lens recall on unseen landmarks | [Detailed page](https://tesseraphoto.com/tracks/nvidia/) | [Video](https://youtu.be/-thSL8iYLlU) |
| SpacetimeDB | The whole shared set is one module: every object, job, version and message is a row; no other backend | 900 of 900 edits at 10 Hz, median 42 to 50 ms; an outsider sees 0 rows until they join | [Detailed page](https://tesseraphoto.com/tracks/spacetime/) | [Video](https://youtu.be/CyivsP2lXpc) |
| Photon | The set on the apps people already use: a photo located by text, versions as reply threads, check-ins, props, alerts; a phone call that guides you | 9 live round trips on Telegram; the other channels 29 of 29 against a stand-in | [Detailed page](https://tesseraphoto.com/tracks/photon/) | [Video](https://tesseraphoto.com/videos/tessera-photon.mp4) |
| HackUTD Virality | Built on what people already post: "where was this photo taken?" threads and recreate-the-photo posts. Every shoot is a share link that opens on a phone, and the set answers in Telegram, so a recreation spreads the way the original photo did | 103 of 1,949 Reddit posts asked where a photo was taken from, which lens, or how to recreate it; the top one has 858 points | [Research page](https://tesseraphoto.com/docs/research/) | [10 reels](https://tesseraphoto.com/reels/) |
| MLH Vultr | Production on a Vultr VM in Dallas, Object Storage for photos and props, Serverless Inference for safety, speech and the render | Content Safety on Vultr in 0.51 s per text; the app and the site on one VM with automatic HTTPS | [Detailed page](https://tesseraphoto.com/tracks/vultr/) | [Video](https://youtu.be/fsq3ry87EZ8) |

### The problem

Google Lens names the place in a photo. It doesn't say where the photographer stood, which way they faced or which lens they used, so people post the photo and ask strangers. **We read 1,949 Reddit posts: 103 asked exactly that, and 79 wanted the exact spot.** [Method and posts](https://tesseraphoto.com/docs/research/)

![r/AskPhotography: will the sun hit this spot in DUMBO at golden hour?](https://tesseraphoto.com/research/8-askphotography.png)

### How it works

- **Find the spot.** Our solver matches the photo against our own 3D model of the place, built from 155 Creative Commons photos, and returns where the photographer stood, the heading and the lens. It answers "2.2x on your iPhone", not just a focal length. If it isn't sure, it says "Couldn't place" instead of guessing.
- **Build the set.** The place in 3D: Google Photorealistic 3D Tiles for the view (display only, never in a render), plus our clay model of the block with your photo projected from where it was taken.
- **Plan the shot.** A physical camera with 19 real bodies and 67 lenses, with depth of field, distortion and exposure. Scrub the sun to any hour and the city's light changes with it. Say "two friends walking toward camera" and Nemotron places them in metres through the shot camera.
- **Preview it.** An AI render puts your people and props into your own photo. Nemotron checks each object's light, shadow and scale and renders again on a fail. Every render is labelled "AI interpretation".
- **Plan together.** Every person, prop, light and camera is a SpacetimeDB row that every screen shares live, so the director's drag shows up in the scout's window. Texts, photo check-ins, renders and golden-hour alerts arrive in the chat through Photon.
- **Go shoot.** The call sheet puts golden hour, conditions and the walk between shots on one plan. On the day, the scout screen walks you to the mark: "You're there. Facing the right way. Take it."

![Studio's World view: the 3D city, Cam A at its mark, and the photo](https://tesseraphoto.com/devpost/1-studio-camera.jpg)

### Proof

- **Solve:** 10 of 11 held-out photos placed, 9 within 25 m of their GPS, median focal error 3%.
- **Words to objects:** 16 objects from one sentence in 6.6 s.
- **Live set:** 900 of 900 edits at 10 Hz, median round trip 42 to 50 ms.
- **Our own model:** a LoRA on Nemotron Nano 12B v2 VL, trained in 44 minutes, catches 72.4% of long-lens photos on landmarks it never saw (the base model: 12.6%).
- **Live texts:** 9 round trips through Photon on Telegram.

![Through Cam A beside the AI render, with Nemotron's check](https://tesseraphoto.com/devpost/3-render.jpg)

### Limits

- One spot is mapped exactly today (DUMBO). A new spot takes about 150 photos and 23 minutes on a CPU. Anywhere else, Nemotron names the place, OpenStreetMap pins it, and Tessera marks it approximate.
- Renders are AI interpretations, not photos.
- iMessage, SMS, voice, email and WhatsApp are tested against a stand-in, not live.

![Two people on one set, with the live SpacetimeDB feed](https://tesseraphoto.com/devpost/5-live-data.jpg)

### What's next

More mapped spots, starting with one we shoot ourselves at UTD; a side-by-side export of the original photo and your recreation; the lens reader on the phone; and the other Photon lines live.

<!-- DEVPOST SHORT END -->

## Open TODOs (Ben)

- Team members (up to 4) on the Devpost form.
- The main video link, and each track video (shot lists on the track pages).
- A licence for the code (the README says none is chosen yet).
- Photon dashboard lines (`crew/PHOTON.md`), so the iMessage, SMS, voice, email and WhatsApp beats can go live.

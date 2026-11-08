---
title: Why ShotMatch
description: The problem ShotMatch solves, what people already ask for, the numbers we measured, and common questions.
---

## A photo shows you the place, not where to stand

Google Lens names a landmark in a second. The standing spot, the direction and the zoom are still guesswork, so people ask strangers online, message photographers who often won't say, or walk around until it lines up. A phone on 1x still gets a different picture when the original was shot from farther back with a longer lens.

What people ask for, in their own words:

- A couple's photographer "just couldn't get the focal length/settings right" ([r/AskPhotography](https://reddit.com/r/AskPhotography/comments/1wpvtk0/), 1,215 upvotes).
- A wedding photographer with 10 years of experience can't find the spot in her sister's elopement photos ([r/WeddingPhotography](https://reddit.com/r/WeddingPhotography/comments/1hr7i2c/)).
- Guides to our own demo shot, the Manhattan Bridge from Washington St, disagree on which block to stand on ([triptins.com](https://triptins.com/manhattan-bridge-view-spot-dumbo/)).

The tools that exist each cover one side of the gap. Lens and similar tools name the place. Spot directories list spots someone already posted. PhotoPills plans the sun once you know where you stand. Ghost-overlay apps help once you are already there. ShotMatch does the step between them: photo to standing spot, heading and lens. Then the scout page's ghost overlay covers the last metres, and the timeline picks the light.

## Measured

| Number | What it means | Source |
|---|---|---|
| 10 of 11 | Held-out photos from other photographers placed at the DUMBO spot. The 11th had 75 matches and ShotMatch said "Couldn't place" instead of guessing. | `spots/nyc_dumbo/eval.md`, [Solve against the open 3D model](/docs/how-it-works/solve/) |
| 9 of 11 | Of those, placed within 25 m of the photo's own phone GPS (median 14 m; phone GPS is off by metres). | `spots/nyc_dumbo/eval.md` |
| 3% | Median focal length error on the held-out photos. | `spots/nyc_dumbo/eval.md` |
| 15.8 s | Median time to solve a photo on a CPU (11.0 to 18.5 s). | `spots/nyc_dumbo/eval.md` |
| 900 of 900 | Set edits committed when three clients dragged objects at 10 Hz for 30 s; median round trip 42 to 50 ms. | [SpacetimeDB track](/tracks/spacetime/) |
| 72.4% | Long-lens photos (70 mm or more) flagged by our fine-tuned Nemotron Nano VL on landmarks it never saw. OpenAI zero-shot: 48.3%. It does not beat "always wide" on plain bin accuracy (55.6% against 57.5%). | `lens/RESULTS.md`, [NVIDIA track](/tracks/nvidia/) |

## Questions

### Where does it work today?

At one mapped spot: the Manhattan Bridge view from Washington St in DUMBO, Brooklyn. A photo from a place we have not mapped gets an honest "we haven't mapped this spot". Mapping a spot takes about 150 photos and about 23 minutes on a CPU.

### Does it find the spot from Google's 3D map?

No. The solver matches your photo against our own 3D model, built from 155 Creative Commons photos. Google Photorealistic 3D Tiles only draw the planning view, with Google's credits on screen, and never enter a render, an export or an AI step.

### Are the renders real photos?

No. Every render is labelled "AI interpretation". Your people and props are composited into your own photo with shadows from the real sun position, and the AI generator is blended only around them, so the rest of your photo stays as it was.

### Do my friends need the app?

No. Anyone with the link joins in a browser. The set can also reach people by text and by phone call through Photon; the crew is connected to Photon, and the numbers to text and call are being set up.

### What happens to my photo?

It is stored so everyone in your shoot can see it, and NVIDIA hosted models read it to place objects and make renders. Your position is shared only while the camera page is open. The [privacy page](/privacy/) lists every service that touches it.

### Can someone use it to find where a person lives?

ShotMatch can only place a photo at a spot we mapped, and we map public places that are already famous. Nemotron Content Safety screens every upload.

---
title: Solve against the open 3D model
description: How ShotMatch recovers where a photo was taken from, which way it faced and its lens, and how it decides how sure it is.
---

The solver answers one question: where did the photographer stand? It returns a position, a heading, pitch and roll, and the 35 mm-equivalent focal length. It matches the photo against our own 3D model of the spot. It never looks at Google's map tiles.

Code: `solver/` (Python, pycolmap 4.2.1 and hloc 1.5). Served on `127.0.0.1:8791`, reachable only from the crew. The request and response are in [HTTP API](/docs/reference/http-api/#solver).

## The spot model

Each spot is a structure-from-motion model built once, offline, from photos of the place (`solver/build_spot.py`):

1. Normalize each photo: EXIF rotation, long side 1600 px.
2. MegaLoc global features, and the 20 most similar photos as matching pairs for each one.
3. SuperPoint (2,048 keypoints) and LightGlue matches for every pair.
4. COLMAP mapping, with the EXIF focal length (times the digital zoom ratio) as a prior.
5. Georegistration with EXIF GPS: a RANSAC similarity fit with a 15 m inlier threshold. GPS altitude is not used.
6. Mirror filter: a photo whose solved heading disagrees with its compass by more than 90 degrees is dropped and the spot is remapped, up to 3 rounds. The Manhattan Bridge tower is symmetric, so some photos registered facing the wrong way.
7. Write the model, a stats file and `spot.json`, the row the crew upserts into the `spot` table.

**The DUMBO spot** (Manhattan Bridge from Washington St): 155 Creative Commons photos from Wikimedia Commons, 127 registered, 11 dropped by the mirror filter. The first build's GPS fit had a median residual of 7.3 m. The build took about 23 minutes on a CPU, most of it LightGlue (903 s) and mapping (259 s). Every photographer is credited on the [credits page](/credits/).

## Localize a photo

`POST /solve` runs these steps and streams a progress line after each:

1. MegaLoc retrieval of the 20 most similar mapped photos.
2. SuperPoint and LightGlue matches to each of them.
3. 2D to 3D correspondences through the model's tracks.
4. RANSAC PnP over a grid of focal lengths: the given `f35_range`, or 10 to 300 mm, plus the EXIF focal length when the photo has one.
5. Joint refinement of the pose, the focal length and one radial distortion term, so a wide phone lens does not bend the pose.
6. The confidence check below.

No pin is needed. The spot only has to be picked (from the photo's GPS or from the person), then retrieval searches the whole model.

## Confidence

In order (`solver/server.py`):

| Result | Rule | Reason string |
|---|---|---|
| Couldn't place (`none`) | Fewer than 200 matches | "only `n` matches, 200 needed" (T3 read "only 75 matches") |
| Check this (`check`) | The camera is more than 40 m from every registered camera in the model | "`n` matches, but `d` m from any mapped camera" |
| Check this (`check`) | A lens range was given and the solved focal length falls outside it | "`n` matches, but the 51 mm lens is outside 14-38 mm" (a real case, before the 70 mm rule below) |
| Solid (`solid`) | Otherwise | "1690 matches, 1 m from a mapped camera" |

The 200-match cut-off is a guess between the one wrong answer in our first test (78 matches, 500 m off) and the weakest right one (336 matches). It is labelled uncalibrated in the code. Match count alone is not enough, which is why the distance and lens checks exist.

## Held-out results

Eleven DUMBO photos from other photographers, never used in the model, run on November 7, 2026 (`spots/nyc_dumbo/eval.md`):

| Measure | Result |
|---|---|
| Placed (Solid or Check this) | 10 of 11 |
| Within 25 m of the photo's own GPS | 9 of 11 |
| Median distance to the photo's GPS | 14 m |
| Median focal length error | 3% |
| Solve time | 11.0 to 18.5 s, median 15.8 s (CPU) |
| The miss | T3: 75 matches, "Couldn't place", instead of a wrong pin 177 m away |

Phone GPS is off by metres, so "distance to GPS" mixes our error with the phone's. Re-localizing photos that are in the model against their own poses gave 0.09, 0.42 and 1.2 m, plus one 17 m slide along the line of sight. The demo photo in session A9TVAN solves as Solid with 1,690 matches at 52.9 mm.

## The lens reader

A second, independent read of the lens comes from our fine-tune of Nemotron Nano 12B v2 VL (a LoRA, served with vLLM). On 480 photos from three landmarks it never saw, it catches 72.4% of long-lens photos (70 mm or more) but reads most normal lenses (35 to 70 mm) as wide: only 7 of 82 land in the right bin. Full table: `lens/RESULTS.md` and the [NVIDIA track page](/tracks/nvidia/).

So the crew uses a read only where it is strong (`solverRange` in `crew/src/models.ts`):

- A lens hint from you ("it was about 85 mm") becomes a range of 0.75x to 1.33x.
- A fine-tuned read of 70 mm or more becomes a range of 0.45x to 2.2x.
- Any shorter read is advisory only and does not limit the search.

This matters for far, flat scenes, where the camera can slide toward the scene while the focal length compensates.

## The f35 convention

Every focal length in ShotMatch is the 35 mm equivalent on the diagonal of the final image:

```
f35 = fpx * 43.2666 / hypot(w, h)
```

`fpx` is the focal length in pixels for an image `w` by `h`. It describes the field of view, not the camera body, and a crop changes it. Simple turns it into your phone's zoom: 53 mm is "2.2x on your iPhone's main camera".

## Map tiles stay out

Google's Map Tiles policy bans image analysis of their tiles and content derived from them. So the solver matches only against our own model, and the tiles are a planning view with Google's credits on screen. Tile pixels and tile depth never enter a solve, a render, an export or an AI step.

## Known limits

- Only mapped spots. A photo from anywhere else gets "Couldn't place" or "we haven't mapped this spot".
- Outdoor places with enough photos. Commons is thin for Dallas landmarks, which is why DUMBO came first.
- Night photos against a daytime model have not been tested. Not measured.
- The original capture time cannot be recovered: reading the time from the lighting missed by 52 to 123 degrees in our tests. Light is forward planning only.
- SuperPoint's weights carry a non-commercial license (Magic Leap). A product would swap in another detector.

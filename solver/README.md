# Solver

Finds where a photo was taken from at a mapped spot: position, heading, pitch, roll and lens. It localizes against a structure-from-motion model built from photos of the spot and never sees Google tiles. The HTTP contract is in [../CONTRACTS.md](../CONTRACTS.md).

Files:
- `geometry.py`: pose with unknown focal and one radial term, georegistration, angle and lens conventions.
- `matching.py`: EXIF, image normalization, MegaLoc, SuperPoint and LightGlue (through hloc).
- `server.py`: FastAPI on `127.0.0.1:8791` and the solve pipeline.
- `build_spot.py`, `eval_spot.py`, `test_geometry.py`: build a spot, score its held-out photos, check the math.

SuperPoint's weights carry a non-commercial license (Magic Leap). That is fine for the hackathon and would need replacing (for example with ALIKED or DISK) in a product.

## Setup

```sh
cd ~/Code/hackathons/shotmatch/solver
./setup.sh                          # .venv with CPU torch, pycolmap 4.2.1, hloc 1.5, SuperGluePretrainedNetwork
.venv/bin/python test_geometry.py   # prints "geometry ok"
```

MegaLoc comes from torch hub (`gmberton/MegaLoc`) and Hugging Face on first use, cached in `~/.cache/torch/hub`.

## Build a spot

```sh
setsid nohup .venv/bin/python build_spot.py nyc_dumbo > ../spots/nyc_dumbo/build.log 2>&1 &
grep -a '^[0-9][0-9]:' ../spots/nyc_dumbo/build.log   # stage lines only
```

About 25 minutes on linuxbox's CPU for 155 photos. Most of it is LightGlue on 20 retrieval pairs per photo. Features, pairs and matches are cached in `spots/<id>/sfm/`, so a re-run only redoes mapping (about 4 minutes per round) and new photos.

Steps: normalize each photo (EXIF rotation, long side 1600 px), MegaLoc top-20 pairs, SuperPoint 2048 and LightGlue, COLMAP mapping with the EXIF focal length (times digital zoom) as a prior, then georegistration with EXIF GPS. Gravity comes from the cameras being held upright, then a RANSAC 2D similarity fits GPS east/north with a 15 m inlier threshold. GPS altitude is not used. Photos whose SfM heading disagrees with their EXIF compass by more than 90 degrees are mirror registrations (the bridge tower is symmetric); they are dropped and the spot is remapped, up to 3 rounds. Magnetic-north headings are skipped rather than corrected.

Output:
- `spots/<id>/model/`: COLMAP model, `georef.json` (model to local ENU), `global.h5` and `local.h5` features.
- `spots/<id>/stats.json`: registration, georegistration residuals, heading check, dropped photos, stage timings.
- `spots/<id>/spot.json`: the row the crew upserts. Center is the median registered camera, radius covers every camera. `name` is kept from an existing `spot.json`.

## Add a spot (campus photos)

1. `mkdir -p spots/utd_<name>/images` and copy in the original phone photos (JPEG or HEIC, with location on). AirDrop with "All Photos Data" or a cable keeps GPS; iMessage and screenshots can strip it.
2. Put the held-out photos from a different phone in `spots/utd_<name>/test/`.
3. Write `spots/utd_<name>/spot.json` as `{"id": "utd_<name>", "name": "..."}` so the build keeps the name.
4. Run `build_spot.py utd_<name>`, then `eval_spot.py utd_<name>`, then restart the server.

GPS, compass heading and focal length (with the digital zoom ratio) are read from each photo's EXIF. `train_meta.json` and `test_meta.json` in the spot folder are optional per-file overrides, a JSON list of `{file, lat, lon, heading, heading_ref, f35, zoom}`. DUMBO needs them because the Commons thumbnails lost their EXIF. The build needs at least 3 registered photos with GPS; aim for 30 or more.

## Serve

```sh
.venv/bin/python server.py      # or: systemctl --user restart shotmatch-solver
curl 127.0.0.1:8791/health
curl 127.0.0.1:8791/spots
curl -N 127.0.0.1:8791/solve -H 'content-type: application/json' \
  -d '{"photo_path": "'$PWD'/../spots/nyc_dumbo/test/d0118.jpg", "spot_id": "nyc_dumbo", "exif_f35": 28}'
```

The server loads every `spots/*/model/` at start and keeps it in memory, so a rebuilt spot needs a restart. Solves run one at a time. The unit is `../ops/shotmatch-solver.service`; logs are in `journalctl --user -u shotmatch-solver`.

Solve: MegaLoc retrieval of the 20 most similar mapped photos, SuperPoint and LightGlue to each, 2D-3D through the model's tracks, RANSAC PnP over a focal grid (`f35_range` when given, else 10 to 300 mm, plus `exif_f35`), then joint refinement of pose, focal and one radial term.

Confidence:
- `none`: under 200 inliers. The threshold is a guess between DUMBO's failure (78) and its weakest good result (336), not yet calibrated on our own spots.
- `check`: the camera is more than 40 m from every mapped camera, or the solved lens is outside `f35_range`.
- `solid`: otherwise.

`alt` is metres above local ground, taken as the median height of mapped cameras within 30 m minus 1.5 m.

## Eval

```sh
.venv/bin/python eval_spot.py nyc_dumbo    # writes spots/nyc_dumbo/eval.md and eval.json
```

Every photo in `spots/<id>/test/` goes through the same `solve()` the server uses.

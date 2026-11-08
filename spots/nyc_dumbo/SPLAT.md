# NYC DUMBO photoreal set: a 3D Gaussian splat

A Gaussian splat of the Manhattan Bridge view up Washington St, trained on 55 of the Creative Commons photos in this spot's solver model, with the camera poses that model already solved. It is our own data, so the studio can render it, export it and feed it to AI steps, unlike Google's tiles.

## Files and URLs

Served by the crew's `/splat/<spot>.<ext>` route from `data/splats/<spot>/` on the Vultr box (git-ignored):

| URL | Size | Gaussians | Colour |
|---|---|---|---|
| https://104-238-146-229.sslip.io/splat/nyc_dumbo_lite.compressed.ply | 27.6 MB | 1.69 M (opacity >= 0.1) | flat (SH degree 0) |
| https://104-238-146-229.sslip.io/splat/nyc_dumbo.compressed.ply | 155 MB | 2.75 M | view-dependent (SH degree 3) |
| https://104-238-146-229.sslip.io/splat/nyc_dumbo_lite.splat | 54 MB | 1.69 M | flat |
| https://104-238-146-229.sslip.io/splat/nyc_dumbo.splat | 88 MB | 2.75 M | flat (the format has no SH) |

`.compressed.ply` is PlayCanvas's format, which Spark, SuperSplat and PlayCanvas read; `.splat` is antimatter15's. No `.spz` or `.ksplat`: the only converters found were an unvetted 0.0.1 package and a JavaScript tool, and Spark already reads the compressed ply. The lite file is the one to load on venue Wi-Fi. Backup of the cropped checkpoint on linuxbox: `checkpoints/splats/nyc_dumbo/crop_29999.pt` (re-export with `splat/export.py`).

Renders from Cam A (the A9TVAN shot camera: heading 3.75, pitch 3.07, roll 0.9, 52.9 mm, 1.04 m up): `data/splats/nyc_dumbo/renders/camA_final_side.jpg` (photo, full, lite) on linuxbox. `splat/render_view.py` renders any solve_result pose.

## Frame

The splat is in the spot model's georegistered east-north-up frame, in metres: x east, y north, z up, origin at 40.704169444, -73.989605 (`model/georef.json` "origin"), ground near z = 0 (the median training camera sits at z = 1.5 m).

`splat/prepare.py` moved the COLMAP model into that frame before training (x_enu = s M x_sfm + T with s, M, T from `model/georef.json`), and the trainer ran with world normalization off, so the exported Gaussians need no rotation or scale.

The studio's frame (module `scene_object` rows, `web/src/studio/frame.ts`) is centred on the spot row's lat/lon (40.7035215, -73.9896683, from `spot.json`). The georef origin sits at (+5.349 m east, +71.953 m north, 0) in that frame (exact WGS84; the two tangent planes differ by under 0.001 degrees over 72 m). So:

- spot ENU = splat + (5.349, 71.953, 0)
- in the studio, put the splat inside the ENU group (the one rotated by `ENU_TO_THREE`) at position (5.349, 71.953, 0) with no rotation and scale 1. In three.js world space that is X = 5.349, Y = 0, Z = -71.953.

Georegistration error carries over: this rebuild's EXIF GPS fit has a median residual of 7.5 m (30 of 61 GPS photos within 15 m, `stats.json`), so the splat can sit a few metres off Google's tiles. Heights are relative to the camera median, not the ellipsoid.

## Method

- **Data.** `splat/prepare.py` takes the solver's COLMAP model (pycolmap 4.2, SIMPLE_RADIAL per photo), moves it into the georef ENU frame, keeps the 55 cameras in the street corridor (within 25 m across and 120 m along the street from `geometry.json`, at street level, all facing up the street toward the bridge) and undistorts them to PINHOLE at up to 1600 px. 8,701 SfM points start the Gaussians.
- **Training.** gsplat 1.5.3 (CUDA) `simple_trainer.py default` on a Brev A100 80 GB, 30,000 steps, world normalization off, every 8th view held out (7 views), real fused-ssim built with nvcc. 15.6 minutes, ending at 3.0 M Gaussians. `splat/train.sh` holds the exact command.
- **Floater crop.** `splat/crop.py` drops Gaussians in space that is empty on the real street: the air between the facades (1 m inside each, 2.5 m above the ground up to the roofline) and the driving lane between the parked cars (0.5 to 2.5 m up). That removed 258 k Gaussians (240 k air, 18 k lane). From Cam A, the uncropped splat is covered by dark blobs a few metres in front of the camera; the cropped one shows the street.
- **Export.** `splat/export.py`: full = all 2.75 M with SH degree 3; lite = opacity >= 0.1 and SH degree 0.

Two runs failed first, both kept on the GPU box for reference. Run 1 used all 127 photos with gsplat's bilateral grid for per-photo exposure: the grids (a 16x16 colour transform per photo) learned each photo on their own and the 3D scene collapsed into one flat colour. gsplat's appearance embeddings were skipped for the same reason, and because their colours do not export. The far photos (across the river, on the bridge) also stretched gsplat's scene scale to 395 m; the street crop brought it to 131 m. Run 2 (MCMC densification, 1 M cap) diverged to NaN at step 2,887.

| Held-out views (7) | PSNR | Colour-corrected PSNR |
|---|---|---|
| Uncropped, 30k steps | 14.17 dB | 16.31 dB |
| Cropped (full file) | 12.84 dB | 15.38 dB |
| Cropped lite | 13.23 dB | 15.66 dB |
| Uncropped, 7k steps | 13.80 dB | 16.01 dB |

Colour-corrected: one affine RGB transform per held-out photo fitted to the render, because a Commons photo's exposure and processing are unknowable for a view the splat never saw (`splat/eval_views.py`). These are low numbers by benchmark standards, which is what internet photos of a street with traffic give. The crop costs about 1 dB on held-out views that sit right beside training cameras (lamp posts, banners and passing cars live in the cropped space), and it is what makes new poses like Cam A usable.

What it looks like: good looking north up Washington St at the tower, deck and brick facades; cars and cobblestones near the camera are smeared, and colours are darker than the punchy hero photo. Looking south, from above, or far off the street there is little or no data.

## Licenses and credits

The 55 training photos come from 26 Wikimedia Commons authors: CC BY-SA 4.0 (19), CC BY 4.0 (13), CC BY 2.0 (11), CC BY 3.0 (5), CC0 (5), CC BY-SA 3.0 (2). They are the files in `data/splats/nyc_dumbo/input/images`; every one, with author, license and page, is in `spots/nyc_dumbo/CREDITS.tsv` and on the app's `/credits` page (which lists all of the spot's photos, a superset).

The splat is an adaptation of the share-alike photos, so we release it under CC BY-SA 4.0 (the BY-SA 3.0 photos allow later versions). Show "3D scene trained from photos by 26 Wikimedia Commons contributors, CC BY-SA 4.0, credits at /credits" wherever the splat renders. Like the solver model, the splat files stay out of git (`data/` is ignored).

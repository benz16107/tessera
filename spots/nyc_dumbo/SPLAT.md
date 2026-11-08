# NYC DUMBO photoreal set: a 3D Gaussian splat

A Gaussian splat of the Manhattan Bridge view from Washington St, trained on the same 127 Creative Commons photos and camera poses as this spot's solver model. It is our own data, so the studio can render it, export it and feed it to AI steps, unlike Google's tiles.

## Files and URLs

PENDING

## Frame

The splat is in the spot model's georegistered east-north-up frame, in metres: x east, y north, z up, origin at 40.704169444, -73.989605 (`model/georef.json` "origin"), ground near z = 0 (the median training camera sits at z = 1.5 m).

`splat/prepare.py` moved the COLMAP model into that frame before training (x_enu = s M x_sfm + T with s, M, T from `model/georef.json`), and the trainer ran with world normalization off, so the exported Gaussians need no rotation or scale.

The studio's frame (module `scene_object` rows, `web/src/studio/frame.ts`) is centred on the spot row's lat/lon (40.7035215, -73.9896683, from `spot.json`). The georef origin sits at (+5.349 m east, +71.953 m north, 0) in that frame (exact WGS84; the two tangent planes differ by under 0.001 degrees over 72 m). So:

- spot ENU = splat + (5.349, 71.953, 0)
- in the studio, put the splat inside the ENU group (the one rotated by `ENU_TO_THREE`) at position (5.349, 71.953, 0) with no rotation and scale 1. In three.js world space that is X = 5.349, Y = 0, Z = -71.953.

Georegistration error carries over: this rebuild's EXIF GPS fit has a median residual of 7.5 m (30 of 61 GPS photos within 15 m, `stats.json`), so the splat can sit a few metres off Google's tiles. Heights are relative to the camera median, not the ellipsoid.

## Method

PENDING

## Licenses and credits

The 127 training photos come from 40 Wikimedia Commons authors: CC BY-SA 4.0 (39), CC BY 2.0 (34), CC BY 4.0 (27), CC BY 3.0 (8), CC0 (7), CC BY-SA 3.0 (6), CC BY-SA 2.0 (6). Every photo, author, license and page is in `spots/nyc_dumbo/CREDITS.tsv` (the rows with role `train` that are in the model) and on the app's `/credits` page.

The splat is an adaptation of the share-alike photos, so we release it under CC BY-SA 4.0 (the BY-SA 2.0 and 3.0 photos allow later versions). Show "3D scene trained from photos by 40 Wikimedia Commons contributors, CC BY-SA 4.0, credits at /credits" wherever the splat renders. Like the solver model, the splat files stay out of git (`data/` is ignored).

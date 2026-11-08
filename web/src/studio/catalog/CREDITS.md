# Studio asset credits

Every file the studio ships or loads, with its author and license. The asset library and the inspector show the author
and license next to each model, and the CC BY models carry their attribution there.

## Props (`web/public/studio/props/<id>.glb`)

Downloaded by `web/scripts/props.ts` from Poly Pizza. The machine-readable copy is `props.credits.json`.

| Id | Title | Author | License | Source page |
|---|---|---|---|---|
| car | Car | Quaternius | CC0 1.0 | https://poly.pizza/m/Cz6yDaUcM9 |
| taxi | Taxi | Quaternius | CC0 1.0 | https://poly.pizza/m/x43lOScTpN |
| suv | SUV | Quaternius | CC0 1.0 | https://poly.pizza/m/xsMtZhBkxL |
| bike | Bike | Zsky | CC BY 3.0 | https://poly.pizza/m/NHjJnFYYCc |
| bench | Bench | Quaternius | CC0 1.0 | https://poly.pizza/m/jLxjFxFRpw |
| chair | Chair | Quaternius | CC0 1.0 | https://poly.pizza/m/iMNqRzPwwe |
| table | Small Table | Quaternius | CC0 1.0 | https://poly.pizza/m/rAEBvfb1FT |
| parasol | Parasol | Zsky | CC BY 3.0 | https://poly.pizza/m/FLEbO2jluO |
| flowers | Flowers | Quaternius | CC0 1.0 | https://poly.pizza/m/NBUxHir6FJ |
| potted-plant | Potted Plant | Kenney | CC0 1.0 | https://poly.pizza/m/23Dx9CC95C |
| streetlight | Streetlight | Quaternius | CC0 1.0 | https://poly.pizza/m/Bq1Qj4DAre |
| traffic-light | Traffic Light | Quaternius | CC0 1.0 | https://poly.pizza/m/apWcPbwhlq |
| cone | Traffic Cone | Quaternius | CC0 1.0 | https://poly.pizza/m/aDIrUbMbW3 |
| hydrant | Fire Hydrant | Quaternius | CC0 1.0 | https://poly.pizza/m/DKkMQbEklp |
| trash-can | Trashcan | Quaternius | CC0 1.0 | https://poly.pizza/m/vlVx279xut |
| town-sign | Town Sign | Quaternius | CC0 1.0 | https://poly.pizza/m/VSZubp0ru3 |
| arrow-sign | Arrow Sign | Quaternius | CC0 1.0 | https://poly.pizza/m/dwmvPHHCdq |

CC BY 3.0 (https://creativecommons.org/licenses/by/3.0/) requires credit to the author: "Bike" and "Parasol" by Zsky,
via Poly Pizza. The studio scales them to real-world size at load time and changes nothing else.

## People (`web/public/studio/people/mannequin.glb`)

Universal Animation Library by Quaternius, CC0 1.0, from the free release (https://quaternius.itch.io/universal-animation-library,
glTF mirror https://github.com/J-Ponzo/gltf-universal-animation-library). `web/scripts/people.ts` keeps eight clips
(stand, walk, sit, jump, point, talk, crouch, push), recolours the mannequin grey and packs one GLB. "Lean" is the stand
pose tilted back 10 degrees.

## Lens profiles (`lensfun.json`)

Measured distortion and vignetting from the lensfun database (https://github.com/lensfun/lensfun, `data/db`), CC BY-SA 3.0
(https://creativecommons.org/licenses/by-sa/3.0/). `web/scripts/lensfun.ts` extracts the 59 lenses the catalog lists; the
database timestamp and fetch date are inside the file. Share-alike applies to `lensfun.json` itself.

## Camera bodies and lenses (`bodies.ts`, `lenses.ts`)

Facts (sensor sizes, pixel counts, focal ranges, apertures, minimum focus distances) typed by hand from the makers'
published specifications. Facts are not copyrightable; no maker text or images are included.

## Draco decoder (`web/public/studio/draco/`)

Copied from three.js (`examples/jsm/libs/draco/gltf`), Apache License 2.0, Google's Draco project
(https://github.com/google/draco). Needed to decode Google's 3D tiles.

## Google Maps logo (`web/public/studio/attribution/google-maps-logo.svg`)

Google's attribution logo, shown on screen with the data providers' credits whenever Photorealistic 3D Tiles render, as
the Map Tiles API policies require. Tiles are display only: they never enter a render layer, an export or an AI step.

## Generated props (`/asset/<id>.glb`)

Made on demand by NVIDIA TRELLIS through the crew (see `docs/NVIDIA.md`); each one is the requesting session's output.

## Interface assets (`web/public/studio/ui/`)

- Icons: Phosphor Icons (regular weight), MIT License, https://phosphoricons.com, exported from the round 3 Figma file
  (QrpLuCwKGGFFBSDRMd7VqS) and, for `lock`, `car` and `eye-slash`, from the Iconify API (`ph:` set).
- Pose thumbnails (`pose-*.png`): clay mannequin renders made with Figma's image generation for the round 3 designs.
- Fonts: Archivo (SIL Open Font License 1.1) and Martian Mono (SIL Open Font License 1.1), through Fontsource.

## Photoreal set (`/splat/<spot>.*`)

The DUMBO Gaussian splat is trained from the spot's 127 Wikimedia Commons photos (40 authors), so it is released under
CC BY-SA 4.0 and the studio shows "3D scene trained from photos by 40 Wikimedia Commons contributors, CC BY-SA 4.0,
credits at /credits" whenever it renders. Details in `spots/nyc_dumbo/SPLAT.md`. Rendered with Spark
(https://sparkjs.dev, MIT License).

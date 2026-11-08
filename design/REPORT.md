# ShotMatch design directions: report

Figma file: https://www.figma.com/design/QrpLuCwKGGFFBSDRMd7VqS

It sits in benz.zhou's team (drafts). There is a Cover page, plus one page per direction with four frames and a note. Screenshots of every frame are in `design/directions/`.

## Node ids

| Frame | A · Viewfinder (page 2:2) | B · Darkroom (page 2:3) | C · Call sheet (page 2:4) |
|---|---|---|---|
| 1 Drop | 3:2 | 6:2 | 10:2 |
| 2 Found it | 3:36 | 6:151 | 10:38 |
| 3 Make it yours | 4:2 | 7:2 | 11:2 |
| 4 Scout, both phones | 4:113 | 8:2 | 11:129 |
| 4 Scout, walking | 4:114 | 8:3 | 11:130 |
| 4b Scout, you're there | 4:155 | 8:156 | 11:172 |
| Note | 13:6 | 13:19 | 13:28 |

Cover frame: 13:37, on page 0:1. It holds the three Found it frames side by side, each with a one-line description.

## What makes each direction different

- **A · Viewfinder (light).** The photo carries the screen. The scene runs full-bleed, the answer is set in large SF Pro beside it, and blue appears only on the primary action and the live direction cues.
- **B · Darkroom (dark).** The answer reads like camera instruments around a central viewfinder. A compass ring draws the 53 mm field of view as a cone, a lens ring scrolls past a fixed amber index, and tick dials control the blend and the ghost. Type is Archivo with Martian Mono numerals.
- **C · Call sheet (editorial).** The answer is a ruled film-crew shot card: facing, lens, "call time" (the next good light), the mark, and one line of notes. Photos are bordered prints, placed people are blocking marks, and type is Instrument Serif with Courier Prime.

All three use only the real numbers from the brief. Each shows the Google Maps logo and data credit bottom-left on every 3D view, the photo credit in every frame that uses the photo, and the "AI interpretation" label on every AI preview. Text contrast passes AA; the exact ratios are in each page's note. The Drop frames have Privacy, Terms and Credits links.

## What I could not do, or did differently

- **Fonts.** SF Pro is available in Figma, so A uses it directly. No banned fonts appear anywhere.
- **3D screenshot.** I cropped it to the 3D area and removed the old person icons and the Cesium/Google logo strip with OpenCV inpainting. I also shifted and scaled the 3D layer by about 12% so it lines up under the photo in the blend. The real overlay from a solve may line up less neatly.
- **Google Maps logo.** I cut it from the old screenshot. The source is only about 98×18 px. Use Google's official logo file when building this.
- **Scout camera.** No live camera frame exists, so the "camera" is the same photo, offset to show the ghost misaligned.
- **AI preview.** Figma AI generated it from a text prompt (one generate_image call, which used Ben's Figma AI credits). The real feature makes it from the user's photo.
- **Numbers I derived, not given in the brief:**
  - 24 mm main camera, from 53 mm = 2.2×
  - "15 m away" for the placed people
  - 6:52 AM as the custom light time
  - The sun at about 111° in the top-view dials
  - "Overcast" for the original photo
  - "GPS ±5 m", taken from the old scout screen
- **Failure state.** "Only 73 matches" is not drawn. It was not one of the four frames.
- **Screenshot size.** get_screenshot exports at 1x (frame size), not 2x.
- **Cover frames are copies.** The hero frames on the cover are clones. If a hero frame changes, clone it onto the cover again.

## Which I would pick

B, Darkroom. It is the one judges will remember. Its signature controls explain the answer instead of decorating it: the cone shows what the lens sees, and the lens ring shows where 53 mm sits between 50 and 85. The dark ground also makes the 3D view and the photos the brightest things on screen. If B feels too dense on a projector, A is the safe fallback, and B can borrow A's larger type scale for facing and lens.

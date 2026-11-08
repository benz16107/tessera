# ShotMatch redesign brief (Figma directions for Ben to choose from)

You are a senior product designer working for Ben (benz16107) on ShotMatch, a HackUTD 2026 project also entered for HackUTD's Best Design prize. Ben looked at the current web app and said: "The UI looks awful... a lot of shit is broken... make mockups, at least a couple of designs for me to choose from, a couple of frames of the most important ones, creative and cool but simple, maybe like Apple design... make those in Figma and let me choose."

Deliverable: a new Figma file with 3 design directions, each with the same 4 key frames, plus a short note under each direction. Design only: do not write or change any app code.

## The product

Send ShotMatch a photo of a place you love. It finds where the photographer stood, which way they pointed and what lens they used, and lays the photo over a live 3D view of the place so you can check it. Then you plan your version: change the lens, place friends, pick the light, get an AI preview made from your own photo. Friends plan in one live session while a scout at the real spot walks to the mark with the original photo as a ghost over their phone camera. It also works over iMessage.

Real numbers you can use in the mockups (from a real solve):
- Spot: "Manhattan Bridge from Washington St, DUMBO"
- Confidence: Solid, 1690 matches, 1 m from a mapped camera, solved in 15 s
- Facing 4° N; lens 53 mm full-frame equivalent = 2.2x on an iPhone main camera; camera 1.0 m above ground, tilted up 3°
- The mark: 40.703195, -73.989598, "Walk here"
- Next light: golden hour Sun 6:35 to 7:12 AM, sun from the right; blue hour 6:05 AM
- Session code A9TVAN; people online: Ben (planner), Maya (scout, 29 m from the mark, then "You're there")
- Failure state copy: "Couldn't place this photo. Only 73 matches; 200 needed." with "Try with a lens hint"
- Every AI preview carries the label "AI interpretation"
- The 3D view is Google Photorealistic 3D Tiles; any frame that shows it must show the Google Maps logo and data credit line (small, bottom-left), as Google requires.

## Assets (in /home/ben/Code/hackathons/shotmatch/design/assets/)

- `dumbo-photo-d0481.jpg`: the user's photo. Credit "Photo: Shah Ronak S, CC BY-SA 4.0" somewhere small in any frame using it.
- `3d-view-dumbo.png`: a real screenshot of the 3D view at the solved pose (crop it to the 3D area; ignore the old UI around it).
- `home.png`, `planner-make-it-yours.png`, `scout-live-mobile.png`, `planner-route.png`: the CURRENT UI, for reference of what exists and what is wrong (cramped form panel, tiny type, duplicate status text, error toast over the photo, a dozen buttons of equal weight, beige-on-black clash). Do not copy its look.

## Frames per direction

1. **Drop** (desktop 1512×982): the first screen. One clear action: drop a photo (or paste a link). A small "Join with a code" path. No form wall.
2. **Found it** (desktop 1512×982): the solved state. Photo overlaid on the 3D view with a photo/3D blend control, the confidence state, and the answer: spot, facing, lens and phone zoom, walk-to-mark, next good light. This is the hero frame; spend the most care here.
3. **Make it yours** (desktop 1512×982): lens (24/35/50/85/135 and a continuous control), people placed in the scene, light/time with the sun direction, and the AI preview side by side with the original, labelled "AI interpretation". Live presence (who is in the session) visible but quiet.
4. **Scout** (iPhone 393×852): camera view with the original photo as a ghost overlay, distance and a direction arrow to the mark, ghost opacity control, and the arrived state ("You're there. Turn left 26°") either as a second phone frame or an inset.

## Directions

Make three that are genuinely different, all simple and calm, Apple-grade in restraint, spacing and type. Suggested starting points (you may change them if you find something better; say why in the note):

- **A. Viewfinder (light).** Apple Photos and Camera feel: the scene is full-bleed, controls float in a few quiet groups, generous whitespace, one accent. Think of the photo as the interface.
- **B. Darkroom (dark).** A pro camera app (Halide, Leica) feel: the 3D view is the hero on near-black, a lens ring or dial as the signature control, precise numerals, one warm accent. Not neon, not purple.
- **C. Call sheet (editorial).** A film-crew call sheet and contact-print feel: the answer as a printed shot card, photos as prints, strong typographic hierarchy, still minimal.

Rules for all three:
- Read and apply these skills before designing (use the Skill tool): `apple-design`, `make-interfaces-feel-better`, `interfaces:better-ui`, `interfaces:better-typography`, `interfaces:better-layout`, `ui-design:visual-hierarchy`. For Apple platform details, `python3 ~/.claude/skills/apple-hig/scripts/hig.py <slug>` prints a HIG page (try `layout`, `typography`, `color`, `materials`, `designing-for-ios` for the scout phone frame).
- Check every frame against Ben's checklist in `~/.claude/rules/design-tells.md` and avoid its tells unless a direction owns one on purpose (say so in the note). In particular: no Inter, Geist or Space Grotesk; no purple-and-black; no emoji; no gradients for decoration; no three-cards-in-a-row; no bento grid; no drop shadows on everything; no em dashes in copy. If SF Pro is not available in Figma, pick a close, available grotesk or a distinctive pairing that fits the direction (see `~/.claude/projects/-home-ben/memory/font-pairings.md` for Ben's saved pairs).
- Real content only (the numbers above); no lorem ipsum, no fake testimonials.
- Hierarchy: one primary action per frame. Numbers that matter (facing, lens, distance) are big and calm; secondary facts are quiet.
- Accessible contrast (AA) for text.

## Figma

Use the Figma MCP (`mcp__figma__*` tools; `use_figma` runs Figma plugin code, `upload_assets` uploads images). Create a NEW design file named "ShotMatch: design directions" in Ben's own Figma team (the student-tier "benz.zhou's team", where the Tapper file 6X3xOmtCMCM0kLvBnkcst6 lives; do NOT use the CUSEC files). One page per direction plus a cover page with the three directions' hero frames side by side and a one-line description each. Upload the real photo and 3D screenshot as image fills. Keep layers named and grouped sensibly (auto layout where it helps).

After building, take screenshots of every frame with the Figma MCP (or export PNGs) and save them to `/home/ben/Code/hackathons/shotmatch/design/directions/` as `A-1-drop.png`, `A-2-found.png`, ... `C-4-scout.png`, plus `cover.png`. Look at each screenshot yourself and fix what looks off (overlaps, clipped text, misaligned groups, low contrast) before finishing. Two review passes minimum.

## Report

End with a short plain report (no em dashes): the Figma file URL, the node id of each frame, one sentence per direction on what makes it different, anything you could not do (fonts, assets), and which direction you would pick and why. Write the same report to `/home/ben/Code/hackathons/shotmatch/design/REPORT.md`.

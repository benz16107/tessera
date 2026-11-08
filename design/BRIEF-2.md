# ShotMatch round 2: the pro studio (Figma)

You designed round 1 in the Figma file https://www.figma.com/design/QrpLuCwKGGFFBSDRMd7VqS (pages A Viewfinder, B Darkroom, C Call sheet; your report is design/REPORT.md, your brief was design/BRIEF.md; read both). Keep everything from round 1 untouched.

Ben's feedback after round 1 was planned, verbatim: "the lens should actually depict actual lenses and lens distortion... a very professional photographer settings tab with a lot of different actual meaningful things... place people... an actual creative studio kind of like Blender where you can have all these different kinds of things, and it has to be very technical. This is very surface level... I'm trying to build a whole full suite of an actual tool for actual creators."

So round 2 designs the studio: a dense, technical, professional workspace that still looks calm and expensive. Reference points: Blender's layout (viewport, outliner, properties editor with tabs, timeline), Capture One and Lightroom Classic's tool panels, Final Cut Pro's inspector, DaVinci Resolve's precision, Halide's camera HUD. Study 2 or 3 of these with the Mobbin MCP if it is connected, and with the skills `apple-design`, `make-interfaces-feel-better`, `interfaces:better-ui`, `ui-design:information-density` style guidance (`visual-critique:critique-information-density`), `ui-design:layout-grid`. Check every frame against `~/.claude/rules/design-tells.md`.

## What the studio holds (all real, meaningful controls)

- **Viewport** (center, the hero): the 3D scene at the solved camera, with the user's photo blended over it, composition overlays (rule of thirds, golden spiral, horizon level, safe areas, aspect mask 3:2 / 4:5 / 1:1 / 16:9 / 65:24), focus point reticle, and the lens's real distortion rendered (barrel on a wide lens). A small viewport header: view mode (Camera / Orbit / Top), overlay toggles, aspect, blend. Google Maps logo and data credit bottom-left of any 3D view.
- **Orbit view**: the same scene from outside, Blender-style: the camera drawn as a frustum gizmo with the near and far depth-of-field planes, the focus plane, the sun direction arrow and shadow, people as figures, the mark on the ground.
- **Outliner** (left): Scene tree. Camera (Sony a7 IV, full frame) > Lens (Sony FE 24-70 mm f/2.8 GM II at 53 mm); Original photo (Shah Ronak S, CC BY-SA 4.0); People > Maya (1.68 m, standing, 15 m), Ben (1.80 m, walking, 16 m); Sun; Mark (40.703195, -73.989598); Similar shots (6).
- **Properties** (right), tabs with icons and labels: Camera body, Lens, Exposure, Focus and depth, Composition, Light, People, Output. Design at least these tabs fully:
  - **Lens**: a real lens picker (search, mount filter: Sony E, Canon RF, Nikon Z, Fujifilm X, iPhone) listing real lenses, e.g. Sony FE 24-70 mm f/2.8 GM II, Sony FE 85 mm f/1.4 GM II, Canon RF 15-35 mm f/2.8L, Sigma 35 mm f/1.4 DG DN Art, Fujifilm XF 23 mm f/1.4 R LM WR, iPhone 16 Pro 24 mm / 13 mm / 120 mm. For the chosen lens: focal length control within its range, max aperture at that focal, minimum focus distance, aperture blades, a distortion plot (radial distortion % vs image height, from the lens profile), a distortion grid preview (barrel/pincushion), vignetting in stops at the corner, "Profile: lensfun, measured". Field of view (horizontal, vertical, diagonal) and 35 mm equivalent on this body.
  - **Exposure**: aperture, shutter, ISO as real stepped values (third stops), white balance in Kelvin with presets, an exposure meter scale (-3 to +3 EV) showing the reading for golden hour at this spot, warnings: "Handheld risk below 1/60 s at 53 mm", "Diffraction softening past f/11 on this sensor".
  - **Focus and depth**: focus distance, DOF near / far / total, hyperfocal distance, circle of confusion for the body, a horizontal depth diagram (camera, near limit, focus plane, far limit, infinity, with the people and the bridge placed at their real distances).
  - **People**: pose library (stand, walk, sit, lean, point, jump) as small figure thumbnails, height, facing, distance from camera, "appears 38% of frame height", per-person list.
  - **Light**: sun azimuth and altitude, shadow length for a 1.7 m person and direction, light quality (soft / hard, front / side / back relative to camera), weather.
- **Timeline** (bottom, full width): 24 hours for the plan date with blue hour and golden hour bands, sunrise/sunset ticks, the sun altitude curve, a playhead at 6:52 AM, and keyframe-like markers for saved shots.
- **Live session**: presence avatars and the scout's live distance, quiet, in the top bar.
- Real numbers from round 1 apply (53 mm, facing 4 degrees N, golden hour 6:35 to 7:12 AM, blue hour 6:05 AM, A9TVAN, Maya the scout 29 m away). Derive any extra numbers with real optics (for example DOF at 53 mm f/4 focused at 15 m on full frame with CoC 0.03 mm: hyperfocal about 23.4 m, near about 9.1 m, far about 42 m) and say in the note which numbers you derived.

## Frames to make (1512x982 desktop unless noted)

On a new page "Studio":
1. **Studio, B Darkroom**: the full studio in camera view with the Lens tab open. This is the hero; spend most care here.
2. **Studio, B Darkroom, Exposure + Focus**: same layout, Focus and depth tab open with the depth diagram, viewport showing the focus reticle and overlay grid.
3. **Studio, B Darkroom, Orbit**: orbit view with the camera frustum gizmo, DOF planes, sun and people; People tab open with the pose library.
4. **Studio, A Viewfinder**: frame 1's content in the A language (light), so Ben can compare.
5. **Studio, C Call sheet**: frame 1's content in the C language.
6. **Lens detail close-up** (any size): the Lens tab at 2x zoom so the distortion plot, grid and specs read clearly.

Use the round-1 assets (design/assets/), and for the orbit view build a simple diagrammatic 3D scene in Figma (or use the 3D screenshot with drawn gizmos); it does not need to be photoreal. Draw people as clean figure silhouettes. Keep layers named; use auto layout for panels.

Export screenshots to design/directions/ as `S-1-studio-B-lens.png`, `S-2-studio-B-focus.png`, `S-3-studio-B-orbit.png`, `S-4-studio-A.png`, `S-5-studio-C.png`, `S-6-lens-detail.png`, and update the Cover page with a second row "Round 2: Studio" showing frames 1, 4 and 5. Review each screenshot yourself and fix collisions, clipping and contrast; at least two passes.

Append a "Round 2" section to design/REPORT.md: node ids, which numbers you derived, what you could not do, and your pick between B, A and C for the studio and why. Design only; do not change app code.

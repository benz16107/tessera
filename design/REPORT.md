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

## Round 3: the virtual set

Page "Round 3: Virtual set" (18:2) in the same file: https://www.figma.com/design/QrpLuCwKGGFFBSDRMd7VqS. Screenshots are in `design/directions/V-*.png`. The Cover page has a new top row, "Round 3: Virtual set", with frames 2, 4 and 5 at half size above the round-1 row. `directions/cover.png` now shows the new cover, which still includes the round-1 row.

### Node ids

| Frame | Node | Export |
|---|---|---|
| 1 Enter a location (B) | 32:82 | V-1-enter.png |
| 2 Set editor, hero (B Darkroom) | 25:2 | V-2-editor-B.png |
| 3 AI command bar + generated prop (B) | 29:38 | V-3-ai.png |
| 4 Through the shot camera + Render (B) | 30:76 | V-4-camera-render.png |
| 5 Set editor (A Viewfinder, light) | 34:82 | V-5-editor-A.png |
| 6 Phones: iMessage 35:121, scout 35:183 | 35:118 | V-6-phones.png |
| 7 VR concept | 37:118 | V-7-vr.png |

Inside the hero frame: viewport 25:3, Outliner and Asset library 26:12, Inspector 26:182, timeline 27:39. The cover clones are 37:217 (frame 2), 38:196 (frame 4) and 37:1554 (frame 5). The source images and icon components are in 18:3 and 19:2.

### What each frame shows

1. **Enter a location.** Drop a photo, search a place or paste a link. ShotMatch found the spot and solved the camera, and the world is 68% streamed. Tiles in front of the camera load first, and the rest are blurred placeholders. Cam A's 25.4 degree view cone points 4 degrees N from the mark. The top bar links Privacy, Terms and Credits.
2. **Set editor.** The Outliner holds the full scene tree from the brief, and the Asset library shows six pose thumbnails and "Generate a prop". The 3D view shows Maya selected, with an amber outline and a move gizmo. The other placed items are Ben, the bike, the bench, the key area light (drawn as a wireframe on a stand), two strands of string lights and the Cam A object. Maya (teal) is moving the bench, and Jun, the scout, shows up as a live beacon 29 m from the mark. A small preview shows the view through Cam A. The Inspector shows transform fields in metres, the person controls (pose, height, facing, gaze) and how Maya sits in Cam A's frame. The timeline has blue hour, golden hour, the sun altitude curve, the playhead at 6:52 AM and three saved shots as keyframes.
3. **AI command bar.** The bar holds Ben's prompt and Nemotron 3.5 Super VL's four steps with timings. "Keep 4 edits" is the only primary button in this frame. The bike is selected and tagged "Generated with TRELLIS on NVIDIA", with its own inspector: model preview, source prompt, time, size, and buttons to regenerate or start from a photo.
4. **Through Cam A + Render.** The camera view uses the user's photo as the backplate, with the objects composited over it. It has a thirds overlay, a focus point on Maya, and switches for backplate (your photo or 3D Tiles), aspect and overlay. The render sits beside it, labelled "AI interpretation". The camera inspector covers body, lens, the 24 to 70 mm lens ring at 53 mm, field of view, exposure, focus and depth of field with a 0 to 40 m diagram, and the lensfun distortion and vignetting profiles. No map tiles appear in this frame.
5. **Set editor, A.** The same content and selection in a light window: SF Pro, sentence-case section names, a rounded viewport inset in the window, white floating controls with soft shadows, macOS-style solid blue selection, and white-on-gray segmented controls. Blue marks selection and the primary action. The sun keeps its warm orange.
6. **Phones.** The iMessage phone shows a sent photo, then ShotMatch's reply with the spot, heading and lens. Next comes a rich link "Open the set" whose preview image is the render, labelled "AI interpretation". Then "make it sunset" and the re-render reply. No map image goes into the thread. The scout phone shows the camera with the original photo as a 40% ghost, Maya and Ben from the set as AR figures with ground rings, "On the mark, turn left 6 degrees", layer chips, the ghost dial, a 2.2x zoom button and a shutter.
7. **VR (concept).** You stand on the set at 1:1. It shows a wrist menu (Place, Light, Cam A, Time, Render), a pointer ray on Maya ("Squeeze to move"), a floating Cam A monitor and a heads-up line saying who is in the session.

Every frame that shows Google 3D Tiles has the Google Maps logo and data credit bottom-left. Every frame that uses the photo has the photo credit.

### Numbers I derived

The script is `~/Code/scratch/shotmatch-design-r3/optics.py`.

- **Sun at the mark, Sunday Nov 8 2026, NOAA equations:** the sun reaches -6 degrees at 6:05 AM and -4 degrees at 6:17 AM, so the blue hour band runs 6:05 to 6:17. Sunrise is 6:34. The sun reaches +6 degrees at 7:14; I drew the brief's 6:35 to 7:12 golden hour band. At 6:52 the sun is 2.2 degrees up at azimuth 114, which is 110 degrees right of the camera's 4 degrees N heading ("from the right"). Sunset is 4:44 PM at azimuth 248, which matches "sun low on your left" in the iMessage reply.
- **Depth of field:** 53 mm at f/2.8 focused at 15 m, CoC 0.03 mm, gives hyperfocal 33.5 m, near 10.4 m and far 27.1 m, 16.8 m in total. **Correction:** the brief's far limit of 27.2 m comes from the approximation H = f²/(Nc) with far = Hs/(H - s). The exact thin-lens formula gives 27.12 m, so the frames say 27.1 m.
- **Field of view:** Sony a7 IV sensor (35.9 × 23.9 mm), held in portrait and cropped to 3:4 to match the photo: 25.4 × 33.5 degrees. At 15 m the frame is 9.0 m tall, so Maya (1.68 m) fills 19% of it. The bike (1.05 m at 14.9 m) fills 12%.
- **Exposure:** f/2.8 at 1/250 s, ISO 100 is EV 10.9.
- **iPhone zoom:** 53 / 24 = 2.2x.

**Placed or invented, not derived:**
- Maya's position (x -1.20 m) and her 184 degree facing.
- Ben at 15.4 m.
- The bike's position (-3.10, 14.60 m), its 92 degree yaw and 12 degree lean, and its size (1.72 × 0.58 × 1.05 m).
- The string lights at 5.5 m and 2700 K.
- The step timings, and the render time of 12.4 s.
- The TRELLIS time of 11 s, which is BUILD.md's measured time.
- "Jun" as the scout's name.
- "Persp, 2.4 m up" for the viewport camera.
- "Mild pincushion at 53 mm", which is a description, not a measurement.

### What I could not do, or did differently

- **3D views.** I had only the round-1 street screenshot at the solved pose. The editor viewport therefore looks almost along Cam A instead of from an orbit position, and Cam A's object is drawn in the foreground as a stand-in. The aerial view in frame 1 is cropped from the old route screen, with the route line and markers removed by OpenCV inpainting.
- **Objects.** The clay mannequins, the bicycle and the AI render came from the three generate_image calls the interrupted run had already made (Figma AI credits). I made no new calls. The bench and the lights are simple vectors. Placed objects are not hidden behind the parked cars in the camera view.
- **Render label.** The render caption says "AI pass on NVIDIA". BUILD.md notes that FLUX.1-dev's first test returned a 500 and that previews use gpt-image-2 for now.
- **Icons.** The icon set (Phosphor) has no eye-slash icon, so the hidden umbrella says "hidden" instead.
- **Scout camera.** No live frame exists, so the scout's camera is the photo, offset from the ghost.
- **Export size.** Exports are 1x; the Figma MCP does not render larger than the node.
- **Cover.** The cover frames are copies. If frames 2, 4 or 5 change, copy them onto the cover again.

### Pick: B

B, Darkroom. In a set editor, the 3D scene, the photo and the render have to be the brightest things on screen. Dark chrome makes that happen, and it matches the tools creators already edit in (Blender, Capture One, Resolve). The amber accent marks one thing at a time: the selection, the shot camera or the primary action. A reads calmer and closer to Reality Composer Pro, and it suits the phone and iMessage side. Next to a dark 3D scene, though, the light panels draw the eye away from the work.

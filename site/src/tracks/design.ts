// HackUTD Best Design. Facts from design/REPORT.md (directions, round 3, derived and invented values), web/src/simple and
// web/src/studio (labels, states, shortcuts), and the site itself. Figma frames are labelled as mockups; every other image
// is a screenshot of the live app on shoot A9TVAN.
import type { Track } from './types.ts';
import hero from '../assets/shots/studio-default-prod.png';
import roundThree from '../assets/design/V-2-editor-B.png';
import directions from '../assets/cards/design-directions.png';
import twoViews from '../assets/cards/design-two-views.png';
import answer from '../assets/cards/design-answer.png';
import slider from '../assets/cards/design-blend-slider.png';
import lensRing from '../assets/cards/design-lens-ring.png';
import guides from '../assets/cards/design-guides.png';
import aiLabel from '../assets/cards/design-ai-label.png';
import site from '../assets/cards/design-site.png';

export default {
  slug: 'design',
  sponsor: 'HackUTD',
  prize: 'Best Design',
  whyTitle: 'Why it is designed this way',
  splitTitle: 'What we made, what we built on',
  theirsTitle: 'Tools and libraries we built on',
  order: 4,
  oneLine: 'We designed Tessera in Figma before writing code, then built two interfaces from it, Simple for anyone and Studio for photographers, over one live set.',
  note: 'The Figma images on this page are design mockups and are labelled as such. Every other image is a screenshot of the live app.',
  hero: {
    img: hero,
    alt: 'Tessera Studio looking through Cam A on the demo shoot: the Manhattan Bridge photo with two placed figures, a thirds grid, the focus label on a person, the horizon label in the right margin, and the camera inspector with a Tamron 28-75mm lens at 51 mm, f/2.8.',
    caption: 'Studio, built from the Darkroom direction: looking through the shot camera with a real lens, focus on a person, and every label kept clear of the picture.',
    frame: 'browser',
    url: '104-238-146-229.sslip.io/studio/A9TVAN',
  },
  headline: [
    { value: '3', label: 'design directions drawn in Figma before any code', check: 'Figma file QrpLuCwKGGFFBSDRMd7VqS, pages A, B and C; exports in design/directions/A-*.png, B-*.png, C-*.png' },
    { value: '7', label: 'frames for the virtual set in round 3', check: 'Figma page "Round 3: Virtual set" (18:2); exports design/directions/V-1 to V-7' },
    { value: '2 views, 1 set', label: 'Simple and Studio read and write the same live rows', check: 'Open /p/A9TVAN and /studio/A9TVAN on the app; both show the same shoot' },
  ],
  why: [
    { title: 'One answer, two kinds of people', body: 'The solve is technical: a position, a heading, a 35 mm equivalent focal length, a confidence. A casual user needs "stand here, 2.2x on your phone". A photographer needs the body, the lens and the depth of field. Two interfaces over one set serve both without hiding the numbers from one or burying the other in them.' },
    { title: 'The design does the explaining', body: 'A lens ring shows where the focal length sits in the lens\'s range. The Figma compass cone draws the lens\'s field of view. Simple\'s blend slider lays your photo over the 3D view so you can check the match yourself.' },
    { title: 'Trust is designed, not added later', body: 'A tool that guesses where a photo was taken must show how sure it is. "Couldn\'t place this photo" is a designed screen, every AI image says "AI interpretation", and every view credits its sources.' },
    { title: 'Built from the frames', body: 'Studio\'s colours, fonts and icons came out of the Figma frames through the Figma MCP. Colours are CSS variables, so the light direction is a token swap. This site uses the same tokens.' },
  ],
  uses: [
    {
      name: 'Three directions in Figma',
      line: 'Round 1 drew the same four screens three ways: A Viewfinder (light), B Darkroom (dark camera instruments) and C Call sheet (an editorial shot card).',
      where: 'Figma QrpLuCwKGGFFBSDRMd7VqS, pages 2:2, 2:3, 2:4; exports design/directions/A-*, B-*, C-*',
      status: 'built',
      img: directions,
      alt: 'Figma mockups: the Found it screen drawn three ways, A Viewfinder in light grey and white, B Darkroom in near-black with an amber compass, and C Call sheet as a ruled cream shot card.',
      detail: 'The four screens were Drop, Found it, Make it yours and Scout. A Viewfinder lets the photo carry the screen, with large type beside it and blue only on the main action. B Darkroom reads like camera instruments around a central viewfinder: a compass ring draws the 53 mm field of view as a cone, a lens ring scrolls past a fixed amber index, and tick dials control the blend and the ghost, in Archivo with Martian Mono numerals. C Call sheet is a ruled film-crew shot card with photos as bordered prints and people as blocking marks, in Instrument Serif and Courier Prime. All three show the Google Maps logo and data credit on every 3D view, the photo credit on every frame with the photo, and "AI interpretation" on every AI preview.',
    },
    {
      name: 'Round 3: the virtual set',
      line: 'Seven frames drew the set editor: enter a location, the editor in B and in A, the Nemotron command bar, Through Cam A with the render, the phones, and a VR concept.',
      where: 'Figma page "Round 3: Virtual set" (18:2); exports design/directions/V-1 to V-7',
      status: 'built',
      img: roundThree,
      alt: 'Figma mockup of the Darkroom set editor: the outliner and asset library on the left, the 3D street with a selected person, a bike and a light in the middle, the person inspector on the right, and the dawn timeline with blue and golden hour bands.',
      detail: 'The hero frame holds the full scene tree, pose thumbnails, a selected person with a move gizmo, a live scout beacon, a picture-in-picture view through Cam A, and a timeline with blue hour, golden hour and the sun\'s altitude. Numbers in the frames come from NOAA sun equations and the thin-lens formula, computed by a script; a few positions and timings were placed by hand and are listed in design/REPORT.md, so they are not product measurements.',
    },
    {
      name: 'Two views over one live set',
      line: 'Simple and Studio are two interfaces over the same SpacetimeDB rows, so a friend on a phone and a photographer at a laptop edit one shot together, and one toggle switches between them.',
      where: 'web/src/simple/, web/src/studio/, the toggle in web/src/simple/ViewSwitch.tsx',
      status: 'live',
      img: twoViews,
      alt: 'The same shoot in two interfaces: Simple on the left, light, with the photo and the answer card; Studio on the right, dark, with the outliner, the view through Cam A and the camera inspector.',
      detail: 'Darkroom became Studio because in a set editor the scene, the photo and the render must be the brightest things on screen, and dark chrome matches the tools creators already use (Blender, Capture One, Resolve). Amber marks one thing at a time: the selection, the shot camera or the main action. Viewfinder became Simple: calmer, phone first, closer to the iMessage side.',
    },
    {
      name: 'The answer in plain words',
      line: 'Simple says "Solid match", "4° N" with a compass, and "2.2x on your iPhone\'s main camera", with the 53 mm full-frame equivalent in small type for anyone who wants it.',
      where: 'web/src/simple/Found.tsx, confidence words in web/src/simple/lib.ts',
      status: 'live',
      img: answer,
      alt: 'Simple\'s answer card: Solid match, Manhattan Bridge from Washington St, DUMBO, 1690 matches, facing 4 degrees N with a compass, lens 2.2x on your iPhone\'s main camera, the mark with Take me there, and the next golden hour.',
    },
    {
      name: 'Check the answer yourself',
      line: 'A 3D to Photo slider blends your photo over the 3D view of the spot, so you can see the match line up instead of taking it on trust.',
      where: 'web/src/simple/ShotView.tsx',
      status: 'live',
      img: slider,
      alt: 'The bottom of the Manhattan Bridge photo in Simple with parked cars on the cobbles and a white pill slider labelled 3D on the left and Photo on the right.',
    },
    {
      name: 'Real camera instruments',
      line: 'Studio\'s camera inspector shows the real lens, a lens ring across its focal range, aperture, shutter, ISO, an exposure meter, and focus with the sharp range: 4.4 to 6.0 m on the demo shot.',
      where: 'web/src/studio/editor/Inspector.tsx (LensRing, depth of field), web/src/studio/optics.ts',
      status: 'live',
      img: lensRing,
      alt: 'Studio\'s camera inspector: Cam A, Tamron 28-75mm F2.8 Di III VXD G2 at 51 mm with a 28.6 by 37.5 degree field of view, a lens ring from 28 to 75, aperture f/2.8, shutter 1/640, ISO 100, meter +0.0 EV, and focus 5.1 m on Person, sharp from 4.4 m to 6.0 m.',
      detail: 'Depth of field uses the thin-lens formula (near = s(H-f)/(H+s-2f), far = s(H-f)/(H-s)) with each body\'s circle of confusion; optics.ts has its own self-check. The catalog has 19 bodies and 67 lenses, 59 with measured distortion and vignetting from lensfun.',
    },
    {
      name: 'Guides that stay off the subject',
      line: 'Through Cam A draws thirds, golden ratio, spiral, centre, horizon and safe areas over the photo, and the horizon label sits in the margin where the line leaves the frame, clear of the people.',
      where: 'web/src/studio/editor/Overlays.tsx',
      status: 'live',
      img: guides,
      alt: 'The view through Cam A: the photo with two grey figures, a thirds grid, a readout bar reading CAM A 51 mm f/2.8 1/640 s ISO 100, the label Focus 5.1 m Person, and Horizon +0.9 degrees in the margin to the right of the frame.',
    },
    {
      name: '"AI interpretation" on every render',
      line: 'Every AI render carries the label, and its caption says it was made from your photo and your objects only, with map tiles never entering a render.',
      where: 'web/src/simple/Yours.tsx, Studio\'s render view (web/src/studio)',
      status: 'live',
      img: aiLabel,
      alt: 'An AI render of four people walking on the cobbles under the Manhattan Bridge at golden hour, with a chip reading AI interpretation, and the caption Render 2, AI preview, made from your photo and your objects only.',
    },
    {
      name: '"Couldn\'t place this photo", as a designed screen',
      line: 'A photo the solver cannot place gets its own screen: "We could not tell where this was taken", the reason, and lens chips (24, 35, 50, 85 mm) to try again with a hint, instead of a confident wrong pin.',
      where: 'web/src/simple/Simple.tsx, web/src/simple/lib.ts',
      status: 'live',
      detail: 'The held-out photo d0473.jpg had 75 matches against the DUMBO model, under the 200-match gate, so the solver answers "Couldn\'t place" (spots/nyc_dumbo/eval.md). The other two states are "Solid match" and "Likely match, check it".',
    },
    {
      name: 'Credits on every view',
      line: 'Studio\'s credit band names where the 3D world comes from, every frame that shows a photo credits it, and Google\'s logo and data credit appear whenever Google tiles render.',
      where: 'Studio credits band (web/src/studio), Simple photo credit, the app\'s /credits page and this site\'s /credits/',
      status: 'live',
    },
    {
      name: 'Accessibility',
      line: 'Simple\'s buttons are at least 44 px tall and its fields 48 px, both stylesheets honour reduced motion, Studio has keyboard shortcuts, and text contrast passes AA in the Figma frames.',
      where: 'web/src/simple/simple.css, web/src/studio/studio.css',
      status: 'built',
      detail: 'Studio shortcuts: G, R and S for move, rotate and scale; W select; M measure; L laser pointer; X delete; Shift+A add; F focus; 0, 1, 3, 5 and 7 for views. The AA ratios are written in each Figma page\'s note. No screen-reader audit was run.',
    },
    {
      name: 'This site',
      line: 'The site uses the same Darkroom tokens, shows only real screenshots in device and window frames, and its scroll motion explains the product; with reduced motion it is a complete static page.',
      where: 'site/src/pages/index.astro, site/src/components/frames/, site/src/scripts/landing.ts',
      status: 'live',
      img: site,
      alt: 'This site\'s home page while scrolling: an iPhone frame showing Simple\'s Found it screen, with the step title 02 Found it and an amber progress rail.',
      detail: 'The iPhone and browser frames are Magic UI\'s components (MIT), ported to Astro. Motion is GSAP with ScrollTrigger and Lenis. The home page has about 75 words of prose; every section is a picture first.',
    },
  ],
  proof: [
    { value: '3 x 4', label: 'directions by screens in round 1 (Drop, Found it, Make it yours, Scout)', check: 'design/directions/A-1 to C-4; node ids in design/REPORT.md' },
    { value: '7', label: 'round 3 frames for the virtual set', check: 'design/directions/V-1-enter.png to V-7-vr.png; node ids in design/REPORT.md' },
    { value: '2 views', label: 'over one shoot, switched by one toggle', check: 'https://104-238-146-229.sslip.io/p/A9TVAN and /studio/A9TVAN' },
    { value: '44 px', label: 'minimum height of Simple\'s buttons (48 px for fields)', check: 'web/src/simple/simple.css lines 38, 63 and 70' },
    { value: '75 matches', label: 'on the held-out photo d0473.jpg, which gets the designed "Couldn\'t place" screen', check: 'spots/nyc_dumbo/eval.md, row T3' },
    { value: '0', label: 'AI images without the "AI interpretation" label', check: 'Simple: Make it yours, then Make it; Studio: Render. Every result carries the label' },
  ],
  ours: [
    'The three Figma directions and the seven round 3 frames',
    'Simple and Studio: layouts, states, copy and tokens',
    'The confidence states, the "Couldn\'t place" screen and the "AI interpretation" label',
    'The credits band, the photo credits and the /credits pages',
    'This site: layout, copy, motion and the reduced-motion static page',
  ],
  theirs: [
    'Figma: the design file, and the Figma MCP that exported tokens and icons from the frames',
    'Magic UI: the iPhone and browser window frames on this site (MIT)',
    'Phosphor Icons (MIT), Archivo and Martian Mono (SIL Open Font License)',
    'GSAP with ScrollTrigger and Lenis for this site\'s motion',
  ],
  limits: [
    'The Figma file is private to the team, so a logged-out visitor sees a not-found page. The exports on this page are the same frames.',
    'Some values in the Figma frames were placed by hand (a person\'s position, step timings, a 12.4 s render time). design/REPORT.md lists them; they are not product numbers.',
    'The VR frame is a concept. "Enter VR" in Studio is untested on a headset, and the wrist menu and floating monitor are not built.',
    'Studio\'s exposure uses a sunny-16 sky model, not a measurement, and the render layers are not lens-distorted.',
    'Accessibility was checked against the brief in screenshots. No screen-reader audit was run.',
  ],
  video: {
    title: 'From Figma to two interfaces',
    length: 'about 2:00',
    summary: 'A screen recording that walks the Figma directions, then the same screens in the live app: Simple in plain words, Studio with the real camera, and the honest states.',
    shots: [
      { t: '0:00 to 0:15', screen: 'Simple in a phone-sized window: drop the DUMBO photo, the solving steps', say: 'You saw a photo and want your own. The answer is technical, so we designed how to say it before writing code.', criterion: 'Problem first' },
      { t: '0:15 to 0:40', screen: 'Figma cover: pan across A Viewfinder, B Darkroom, C Call sheet', say: 'Three directions for the same four screens: a light viewfinder, a dark set of camera instruments, and a film crew\'s call sheet.', criterion: 'Process' },
      { t: '0:40 to 1:00', screen: 'Figma round 3: the set editor in B, then in A', say: 'Then the virtual set. Dark won for the editor: the scene, the photo and the render are the brightest things on screen.', criterion: 'Rationale' },
      { t: '1:00 to 1:25', screen: 'Live Simple /p/A9TVAN: Found it; drag the 3D to Photo slider; tap Make it yours', say: 'Simple says it in plain words: face 4 degrees north, 2.2x on your iPhone. Slide to check the match yourself.', criterion: 'Usability' },
      { t: '1:25 to 1:45', screen: 'Tap Studio in the toggle: Through Cam A, turn the lens ring, the depth of field updates', say: 'Studio gives a photographer the real camera: lens, aperture, depth of field, the light. Same set, same moment.', criterion: 'Two views, one set' },
      { t: '1:45 to 2:00', screen: 'The "Couldn\'t place" screen for the 75-match photo, then a render labelled AI interpretation', say: 'And it is honest: it says when it can\'t place a photo, and labels every AI image.', criterion: 'Trust' },
    ],
    notes: 'Figma in presentation mode on the cover page, then the round 3 page. Simple at 393 x 852 for the phone beats, Studio at 1512 x 982. The "Couldn\'t place" beat needs the held-out photo d0473.jpg from spots/nyc_dumbo/test/ dropped into a test session, not A9TVAN.',
  },
  docs: [
    { label: 'Get started', href: '/docs/get-started/' },
    { label: 'The virtual set', href: '/docs/how-it-works/virtual-set/' },
    { label: 'Look through the camera', href: '/docs/guides/look-through-the-camera/' },
    { label: 'Lens catalog', href: '/docs/reference/lens-catalog/' },
    { label: 'Credits and licenses', href: '/credits/' },
  ],
} satisfies Track;

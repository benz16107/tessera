# Video plan

Ben, 5:20 AM CT: "Really good animations, good sound, a good story, narration in parts using my ElevenLabs voice clone. Make a couple of plans for the main video and for the track videos."

Hard limits: Devpost allows **at most 2 minutes** for the main video ("Demo Video (Skits are allowed, maximum of 2 minutes)"), and it must be a publicly playable YouTube or Vimeo link. Production starts after the 9:00 AM CT deploy freeze and must be uploaded before the noon deadline, so the main video comes first and the track videos follow in priority order.

## Rules for every video (product-video-checklist, step 1)

- **Colours (3):** near-black `#0b0b0a` background, near-white `#ece9e2` type and UI, muted warm `#c9a46a` for one thing at a time (the sun, golden hour, the mark). These are the app's own greyscale tokens.
- **Type:** Archivo, two weights (500 and 700). The camera HUD's mono appears only inside real screenshots.
- **Background:** flat near-black, no gradients, glows or grain.
- **Music:** one mood, cinematic and calm, 72 to 80 BPM; cuts land on the beat.
- **Product shots** are real captures from production at 2x (1512 x 982 at device scale 2), never rebuilt UI. Every number on screen comes from the repo or the live site.
- **Captions** at least 60 px tall at 1080p. Two cuts of each video: with music, and voice plus effects only.
- **People:** Reddit screenshots keep names blurred. Ben's own Clifton Hill photo (a person in it) and the Rick Astley frames never appear.
- **Narration:** ElevenLabs, Ben's cloned voice "Ben Zhou" (voice id `CSWOX3djBEY4mlYbaQ2U`, Creator plan, about 125,000 characters left this cycle). One line per file so it can be timed to picture. About 150 words a minute.
- **Tools:** HyperFrames for the composition (HTML + GSAP, deterministic render), Playwright on linuxbox for the screen captures, ElevenLabs for voice. Music from ElevenLabs Music if the plan allows commercial use (check), else the YouTube Audio Library.

## Main video: three options

### A. "Where did they stand?" (story first, recommended)

1:55. Narrated by Ben throughout, about 260 words.

| Time | Picture | Voice |
|---|---|---|
| 0:00 to 0:12 | Black. Reddit screenshots slide in one at a time, names blurred: the grieving husband ("sit exactly there"), the grandmother's graduation photo ("I can't nail the cross streets"), the Jay St "will the sun even hit this spot". Each quote's key phrase lifts to warm. | "People post a photo and ask strangers the same question: where was this taken from?" |
| 0:12 to 0:20 | Count line typed on black: "103 of 1,949 posts we read asked exactly that." | "We read almost two thousand of these posts. A hundred and three ask for the spot, the lens, or how to recreate it." |
| 0:20 to 0:38 | The DUMBO photo drops into Simple; "Solid match"; facing 4° N; "2.2x on your iPhone". A warm dot traces from the photo to the mark on the dark map. | "Tessera answers from the photo itself. It finds where the photographer stood, which way they faced, and the lens, against our own 3D model of the street." |
| 0:38 to 0:55 | Simple slider 3D to Photo; push into Studio, Through Cam A; aperture f/1.4 to f/8, the 24 vs 85 mm compare. | "Then it rebuilds the place as a set, with a real camera: real lenses, real depth of field." |
| 0:55 to 1:12 | Type "two friends walking toward camera"; mannequins appear; Render; the AI render beside it, "AI interpretation". | "Say what you want. Nemotron stages it, renders it into your photo, and checks its own light and shadows." |
| 1:12 to 1:25 | Timeline scrub from noon through golden hour to night, the live sun relighting the world. | "Pick the light. The sun moves for the real date and place." |
| 1:25 to 1:38 | Two browsers side by side plus a phone: a drag in one appears in the others; a Telegram message arrives with the render. | "Your crew plans it together, live, or by text." |
| 1:38 to 1:48 | Drop the Palace of Fine Arts night photo: "Looks like Palace of Fine Arts. From the landmark." | "And it works anywhere. No map of the spot? It reads the signs and landmarks instead." |
| 1:48 to 1:55 | The scout page's ghost overlay lining up, then the title card: "Stand where the photo was taken. Tessera." | "Stand where the photo was taken. Then make it yours." |

### B. "One photo" (product film, minimal voice)

1:30. Music-led, Apple style. Five short voice lines only. Big typographic beats on black ("Where did they stand?", "Which lens?", "When's the light?", "Who's in it?") alternate with slow camera moves across 2x UI captures, one idea per shot, about 12 shots of 5 to 9 seconds. It ends on the same title card. Better as a share clip; weaker on proof for judges.

### C. "Drop anything" (judge's challenge)

2:00. It opens with the anywhere flow as the hook: three very different photos dropped in a row (the Palace at night, a Commons Eiffel Tower, the DUMBO example), each landing correctly with how it was placed. Then it slows into the DUMBO solve and the full plan. It's strong on robustness, but it puts the precise solve, our real differentiator, second.

Recommendation: **A**, because it follows the GurtOS principle of problem first with real numbers, uses the research, and still shows "anywhere" in its last 20 seconds.

## Track videos (60 to 90 s each, same rules, a 2 s shared open and close)

| Priority | Track | Title | Beats |
|---|---|---|---|
| 1 | NVIDIA | "Nemotron runs the set" | A sentence becomes a scene (the step trace streaming); a render that checks and fixes itself; Nemotron placing a photo from its signs (Clifton text, Palace landmark); the fine-tuned lens reader (72.4% long-lens recall against 48.3% for OpenAI); the models panel with live latency. |
| 2 | SpacetimeDB | "The set is the database" | Three screens on one set: a drag appears everywhere; locks; Follow; the history scrubber and undo; an outsider sees 0 rows until they join; the load test at 900 of 900; the live sun clock as a schedule; a procedure calling Nemotron from inside the database. |
| 3 | Photon | "The set in your texts" | Telegram: text a photo, located; an edit comes back as v1 with its render; a native reply forks v1.1; a check-in from the street ("step forward 12 paces"); the golden-hour alert with conditions. Voice is proven against a stand-in only: say so in one caption. |
| 4 | HackUTD Best Design | "A tool, not a dashboard" | Figma directions to the shipped Studio and Simple; the greyscale system (three colours, one type family); motion that means something (the live sun scrub, the lens switch); UI audit before and after (44 rows). |
| 5 | MLH Vultr | "Running on Vultr" | 45 s: the VM, Caddy with three hostnames and automatic HTTPS, Object Storage for photos, Serverless Inference for safety and the render, with real numbers from docs. |

The existing shot lists on the site's track pages (site/src/tracks/*.ts, `video`) are the source for each track's beats; these shorten them to 60 to 90 s.

## Production, after the 9:00 freeze

1. **Scripts:** final narration text per video, about 150 words a minute, every claim sourced (docs/story.md, DEVPOST.md).
2. **Voice:** generate each line with the "Ben Zhou" voice and save per-line MP3s and timings. Ben listens to two sample lines first.
3. **Capture:** Playwright scripts on production at 2x in scratch sessions (A9TVAN only read, never edited), one clip per shot, plus the site's retake kit for stills.
4. **Compose:** HyperFrames, one composition per video, transitions that carry an element across (the warm dot, the photo frame), the beat grid from the music.
5. **Music and sound:** one track per video at 72 to 80 BPM, plus three quiet effects (drop, shutter, message), then a mute test.
6. **Render:** 1080p, two cuts, a final checklist pass, then upload to Ben's YouTube as unlisted or public (Devpost needs it publicly playable), and paste the links into Devpost and the track pages.

Order, given the noon deadline: the main video first (by about 10:45), then NVIDIA, SpacetimeDB and Photon in parallel threads, then Design and Vultr if time allows.

---
title: Tracks
description: What ShotMatch built for each HackUTD 2026 prize track, with the proof and a video plan for each.
---

ShotMatch starts from one problem: you saw a photo of a place and want your own version, but nothing tells you where the photographer stood, which way they faced or what lens they used. ShotMatch solves that from the photo's geometry, then builds the place as a 3D set where your group plans the shot. Every track page follows the same rules. The problem comes first. The virtual set is the environment every feature runs in. The optics are real: a solved position, heading and focal length, real lenses, real sun. The place is rebuilt from our own Creative Commons photos, and Google's 3D tiles are for display only. People plan together live, from a browser, a text thread or a phone call. Every number was measured, and anything not measured says so. Each page labels what comes from the ShotMatch core and what the sponsor's product adds.

| Track | What ShotMatch does for it | Headline proof | Page |
|---|---|---|---|
| NVIDIA: Nemotron, beyond a chatbot | Nemotron runs the set's workflows: text to set, rebuild the scene from the photo, a render that checks its own physics, props at real size, art director, call sheet, voice, offline on CPU. Plus our own LoRA fine-tune that reads lenses. | A sentence placed 16 objects in 6.6 s; the fine-tuned lens reader flags 72.4% of long-lens photos on landmarks it never saw (OpenAI zero-shot 48.3%) | [NVIDIA](/tracks/nvidia/) |
| SpacetimeDB | The set is the database: every person, prop, light and camera is a row, and there is no other backend for the live set. | 3 clients dragging at 10 Hz for 30 s: 900 of 900 edits committed, median round trip 42 to 50 ms | [SpacetimeDB](/tracks/spacetime/) |
| Photon, plus the voice-call prize | The set reaches people on iMessage, Telegram, SMS, WhatsApp Business, email and a phone call, each in that app's form. | All five mechanisms end to end against a stand-in for Photon's Beta API: 29 of 29 checks; live on Photon's event stream with Telegram | [Photon](/tracks/photon/) |
| HackUTD Best Design | Three directions in Figma before code, then the virtual set; Darkroom became Studio and Viewfinder became Simple, over one live set. | Both views ship on the same session; every tile view carries Google's credit, every render says "AI interpretation" | [Best Design](/tracks/design/) |
| MLH Best Use of Vultr | Production runs on a Vultr VM in Dallas, with Vultr Object Storage and Vultr Serverless Inference. This site is served from the same VM. | Nemotron Content Safety on Vultr answers in 0.51 s (text) and 1.9 s (with an image) | [Vultr](/tracks/vultr/) |

The HackUTD overall prizes are automatic for every project. MLH Best Domain Name from GoDaddy Registry is entered only if Ben registers a domain; until then the app and this site run on sslip.io names.

## Try it

- The app: https://104-238-146-229.sslip.io
- The demo set in Studio: https://104-238-146-229.sslip.io/studio/A9TVAN
- The same set in Simple: https://104-238-146-229.sslip.io/p/A9TVAN

---
title: Privacy
description: What this site and the Tessera app store, and which services process it.
---

Tessera is a project built at HackUTD 2026. This page covers this documentation site and the Tessera app at [app.tesseraphoto.com](https://app.tesseraphoto.com). It matches the privacy page inside the app. Last updated November 8, 2026.

## This site

- It has no accounts, forms, cookies, analytics or tracking scripts.
- Search runs in your browser (Pagefind). Your search terms never leave your device.
- The site is served by Caddy on our Vultr server, which is set up without an access log. Vultr, as the host, handles the network traffic.
- Fonts are served from this site, not from a font service.

## The app: what we store

- **Photos you add.** Stored on our server and in our Vultr Object Storage bucket so everyone in the shoot can see them. We keep the photo's location and focal length from its metadata to find the spot, and drop the rest.
- **The shoot.** Its title, the name you give, the people and props you place, the camera settings, messages and AI renders live in our SpacetimeDB database, visible only to people in that shoot.
- **Your position, only on the camera page.** While "Take me there" or the scout page is open, your location and compass heading are shared with the shoot so friends can see you walk. Closing the page stops it.
- **Invites.** A phone number or email you enter to invite someone is stored with the shoot and used only to message that person about it.
- **Calls.** If you call the set, the call's transcript is written into the shoot's messages.

## The app: who processes it

- **NVIDIA** hosted models read photos and the words you type or say, to place objects, make renders and check them.
- **Vultr** hosts our servers, storage and some models (Vultr Serverless Inference). **OpenAI** is a fallback for image edits when the NVIDIA and Vultr paths fail.
- **SpacetimeDB** (Maincloud) holds the shared set.
- **Photon** delivers invites and messages on iMessage, SMS, WhatsApp, Telegram and email. **ElevenLabs** runs the phone call.
- **Google** Photorealistic 3D Tiles draw the 3D view. Google receives the map requests, never your photo.
- Weather, tide and permit data come from public sources (Open-Meteo, NOAA, NWS, USGS, NYC Open Data, OpenStreetMap). They receive the spot's location, not anything about you.

## Deleting

The person who started a shoot can delete it from Share in the app. That removes its photos, renders, people and messages from the database.

## Contact

Ask at the Tessera table at HackUTD, or through the Devpost project page.

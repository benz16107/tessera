---
title: Messaging and calls
description: How the set reaches people on iMessage, Telegram, SMS, WhatsApp, email and by phone through Photon, and what is live today.
---

Most people on a shoot will never open a 3D editor. The friends in the frame, the person with the reflector and the scout walking to the mark already have a messaging app. Photon brings the set to them there, each in that app's own form.

Code: `crew/src/photon.ts` (the event stream and the router), `crew/src/channels/` (one file per job), `crew/src/voice.ts` (the call), `web/src/photon/` (the studio panel). Rows: `channel_link`, `shot_version`, `checkin`, `message`, `reminder` and `outbox` in the SpacetimeDB module.

## What is live, and what was proven against a stand-in

- **Live:** the production crew went live on Photon's API and event stream at 12:30 AM CT on November 8, 2026, and connected a managed Telegram bot. `GET /api/photon/status` lists its handle, @ShotMatchSetBot. Between 12:42 and 1:24 AM CT on Nov 8, through Photon's live API and the managed Telegram bot @ShotMatchSetBot, a photo was located ("Solid ... 1600 matches ... 54 mm"), a set edit came back as v1 with its render, a native reply to v1 forked the set to v1.1, "versions" listed the tree, a street photo was solved as a check-in ("You're 9.3 m south of the mark. Step forward 12 paces, then 4 paces to your left."), a texted lamp became a prop (a flat cut-out: the hosted photo-to-3D model returned an error), and a render started in the studio arrived in Telegram on its own as an album of lens options. A golden-hour alert fired by the SpacetimeDB schedule (a test scheduled a minute out) reached Telegram at 1:24 AM CT with the conditions at the mark: "Clear sky, poor colour chance (20/100), wind 9 mph; low tide 1:47 PM (0.2 ft)" and the scaffolding nearby. The screenshots are on the [Photon track page](/tracks/photon/). The other channels have no public handle yet.
- **Waiting on setup by hand:** the iMessage shared line, SMS (a number and a 10DLC campaign), the voice number, email on our own domain (DNS records) and WhatsApp Business each need steps in Photon's dashboard. Invites to those channels are saved as `channel_link` rows and go out once the line exists.
- **Proven end to end:** all five mechanisms below ran against a stand-in for Photon's Beta API (`crew/test/fake-photon.ts`, the HTTP routes and the Socket.IO event stream with replay cursors) with the real crew, the real SpacetimeDB module (a scratch database) and real NVIDIA models. `crew/scripts/photon-e2e.ts` passed 29 of 29 checks on its last run.

## 1. One live set, everyone on their own channel

Each person in a session has a channel link: iMessage, Telegram, SMS, WhatsApp Business, email, or a phone number for calls. When the set changes (a finished render, a moved camera, a scout reaching the mark, a check-in, the call sheet), the crew sends it to each person in their channel's form:

| Channel | What arrives |
|---|---|
| iMessage | the render image, then one line: "v3: red bike on the left. Reply to this to change it." |
| Telegram | an album of 35, 50 and 85 mm options (exact crops of the render) with a caption, and one progress message edited in place while it renders |
| Email | one message from the project's domain: a Markdown body with the image attached; the call sheet in full, with a link to its page |
| SMS | text plus a link to the image |
| WhatsApp Business | the image, then the line with the live set link |

Anything anyone sends back, on any channel, lands in the session as a `message` row that the studio shows.

**Invites** work from Share in the app or from a text: "add Maya +1 469 555 0144 on SMS". Where Photon allows a first message (SMS, WhatsApp Business, email), the invite goes straight out. Where it doesn't (the shared iMessage line, Telegram bots), the inviter gets the exact text to forward: "Text JOIN AB3DKQ to ..." or a `t.me/<bot>?start=<code>` link.

## 2. Call the set

Calling the Tessera number connects to the set by voice: an ElevenLabs agent on Photon's SIP voice line. The agent calls tools on the crew:

- `guide_me` gives one turn-by-turn instruction from the caller's live phone position and compass on the scout page: "Turn left 26 degrees, then walk 12 m north."
- `edit_set` sends the caller's words to the same Nemotron command the studio uses ("move the bike to the left", "make it sunset"), so planners watch the set change while the caller talks.
- `get_plan` reads out the framing.

When the call ends, Photon's `call.ended` event makes the crew send the final framing and the latest render to the caller's own thread. ElevenLabs' signed post-call webhook writes the transcript into the session's messages inside SpacetimeDB. See [Call the set](/docs/guides/call-the-set/).

## 3. Check in by photo

The scout texts a photo from where they stand. The crew solves it against the spot model, compares the solved camera with the shot camera, and replies with the correction:

> You're 3.2 m east of the mark and facing 14 degrees too far left. 4 paces to your left, then turn right 14 degrees.

or "You're on the mark. Take the shot." The check-in is a `checkin` row with its position, so a marker appears in the 3D set at once, and everyone else gets a one-line note on their channel.

## 4. The thread is the version tree

Every render the crew sends is a numbered version (v1, v2, v3) tied to a point in the set's SpacetimeDB history. Replying to a version's message in any chat app (Photon's `parentMessageId`) forks the set from that version: the set goes back to that snapshot as a new branch (v1.1), the reply's words are applied, it renders, and the answer comes back threaded on the reply. Text "versions" to list the tree. The studio shows the same tree under **Versions from the threads**, with **Fork** on each.

## 5. Messages at the moment of the shot

The module's reminder schedule fires 20 minutes before golden hour for the mark's position and heading. The crew writes one message per person with their live distance from the scout page:

> Golden hour starts in 20 min. You're 300 m away, about 4 min on foot.

The message also carries the colour chance and up to two permits near the mark from the [geodata layers](/docs/how-it-works/geodata/). Photon's shared iMessage line can't message first and may refuse a late message into an open thread, so for anyone whose iMessage refuses, the alert goes to their next channel: Telegram, SMS, email, then WhatsApp. In the end-to-end run, Maya's iMessage refused the late alert (`SHARED_LINE_INBOUND_REQUIRED`) and it reached her by email.

## Also: the camera roll becomes props

A photo of one object (a jacket, a lamp, a sign) texted into a session becomes a 3D prop in the set through NVIDIA's photo-to-3D path, placed in frame, with a reply like "Added a floor lamp to the set on the left, 5 m from the camera." Voice notes on Telegram or WhatsApp are transcribed by NVIDIA Parakeet and treated like typed messages.

## Photon features used

iMessage inbound text and images, replies and threaded replies; Telegram direct and group chats, albums of 2 to 10 attachments, message edits and deep links; SMS outbound and inbound; WhatsApp Business; email on a custom domain with attachments and inbound replies; the voice line over SIP and `call.ended`; users and spaces create-or-get; attachment upload and download; voice notes; typing indicators; event delivery over Socket.IO with a replay cursor (saved in `data/photon.json`); problem codes (`SHARED_LINE_INBOUND_REQUIRED`, `SPACE_NOT_SENDABLE`, `SMS_CAMPAIGN_NOT_ELIGIBLE`) to drive the fallback; and an idempotency key on every send, so a restarted crew never sends a message twice.

Not used: a dedicated iMessage line, MMS images, personal WhatsApp, Apple Messages for Business, outbound calls, webhooks, reactions, polls, read receipts and delivery status events.

# ShotMatch on Photon

ShotMatch plans a photo shoot in a shared virtual set: a 3D copy of a real place where friends place people, props, lights and the camera, then render the shot with AI. Photon is how the set reaches people who are not at a laptop. This page is for Photon judges: why messaging is essential here, the five things ShotMatch does with Photon that a chat app can't, and which Photon Beta features each one uses.

## Why the set lives in messages

- **The people who won't install an app.** A shoot has a photographer, two friends in the frame, someone holding a reflector and a parent who drives. Only one of them opened the studio. Everyone else already has iMessage, Telegram, WhatsApp, SMS or email, so the set comes to them there, in each one's own app, with nothing to install.
- **The person at the spot has their hands full.** The scout is outdoors with a phone, a bag and maybe a tripod. They can call and talk, or snap one photo, but they can't drive a 3D editor. Calling the set and texting a photo are the two things a person can do while walking.
- **The camera roll lives in Messages.** Reference shots, the jacket someone wants to wear, the sign they want in frame: people already send these as texts. A photo texted to ShotMatch becomes a check-in, a prop in the set, or a new spot to locate.
- **Light doesn't wait.** Golden hour starts at a fixed minute. The message that matters is the one that arrives at that minute on the channel that will actually deliver, with how far that person still has to walk.

## The five mechanisms

Each one starts from where the people and phones are, not from a chatbot.

### 1. One live set, everyone on their own channel

Every person in a session has a channel link (iMessage, Telegram, SMS, WhatsApp Business, email, or a phone number for calls). When the set changes in SpacetimeDB (a finished render, a moved camera, a scout reaching the mark, a check-in, the call sheet) the crew sends it to each person in their channel's form:

| Channel | What arrives |
|---|---|
| iMessage | the render image, then one line ("v3: red bike on the left. Reply to this to change it.") |
| Telegram | an album of lens options (35, 50 and 85 mm, exact crops of the render) with a caption, and one progress message edited in place while it renders |
| Email | one message from the project's own domain: a Markdown body with the image attached; the call sheet in full, with a link to the designed page |
| SMS | text plus a link to the image |
| WhatsApp Business | the image, then the line with the live set link |

Anything anyone sends back, on any channel, lands in the same session as a message row the studio shows. Invites work from the studio or from a text: "add Maya +1 469 555 0144 on SMS". Where Photon allows a first message (SMS, WhatsApp Business, email) the invite goes out with a scout link; where it doesn't (the shared iMessage line, Telegram bots), the inviter gets the exact text to forward: "Text JOIN AB3DKQ to +1..." or a `t.me/<bot>?start=AB3DKQ` link.

Demo: In the studio, invite a judge by email and a friend on Telegram. Press Render: the judge's inbox gets the shot from our domain while the Telegram group gets three lens options in one album.

### 2. Call the set

Calling the ShotMatch number connects to the set by voice (an ElevenLabs agent over Photon's SIP voice line). The agent has tools on the crew: `guide_me` gives one turn-by-turn instruction from the caller's live phone position and compass on the scout page ("Turn left 26 degrees, then walk 12 m north."), and `edit_set` sends the caller's words to the same Nemotron text-to-set command the studio uses ("move the bike to the left", "make it sunset"), so planners watch the set change while the caller talks. When the call ends, Photon's `call.ended` event makes the crew send the final framing and the latest render to the caller's own thread, and ElevenLabs' signed post-call webhook writes the transcript into the session's messages inside SpacetimeDB.

Demo: A judge calls the number from the street and says "move the bike to the left"; the bike moves on the studio screen. They hang up and the framing arrives in their texts.

### 3. Check in by photo

The scout texts a photo from where they stand. The crew runs the solver on it against the session's spot model, compares the solved camera with the shot camera, and replies with the correction: "You're 3.2 m east of the mark and facing 14 degrees too far left. 4 paces to your left, then turn right 14 degrees." or "You're on the mark. Take the shot." The check-in is a SpacetimeDB row with its position, so a marker appears in the 3D set at once, and everyone else gets a one-line note on their channel.

Demo: The scout snaps the view and texts it. Ten seconds later the studio shows their marker beside the mark, and their phone tells them which way to step.

### 4. The thread is the version tree

Every render the crew sends is a numbered version (v1, v2, v3) tied to a point in the set's SpacetimeDB history. Replying to a version's message, in any chat app (Photon's `parentMessageId`), forks the set from that version: the set goes back to that snapshot as a new branch (v1.1), the reply's words are applied, it renders, and the answer comes back threaded on the reply. "versions" lists the tree. The studio shows the same tree and can fork from any version too.

Demo: Scroll up in iMessage, reply "make it sunset" to v1. The set rewinds to v1 for everyone, and v1.1 arrives as a reply in the thread.

### 5. Messages at the moment of the shot

The module's reminder schedule fires 20 minutes before golden hour for the mark's position and heading. The crew writes one message per person with their live distance from the scout page: "Golden hour starts in 20 min. You're 300 m away, about 4 min on foot." Photon's shared iMessage line can't message first and may refuse a late message into an open thread, so for anyone whose iMessage refuses (or who never texted), the alert goes to their next channel: Telegram, SMS, email, then WhatsApp.

Demo: The alert lands on a teammate's WhatsApp with their walking time; the judge whose iMessage line refused the late send gets it by email instead.

## Also: the camera roll becomes props

A photo of one object (a jacket, a lamp, a sign) texted into a session becomes a 3D prop in the set through NVIDIA's photo-to-3D model, placed in frame, with a reply like "Added a floor lamp to the set on the left, 5 m from the camera." Voice notes on Telegram or WhatsApp are transcribed and treated like typed messages.

## Evidence

Photon project credentials were not issued before judging prep, so everything runs against a stand-in for Photon's Beta API (`crew/test/fake-photon.ts`: the HTTP routes and the Socket.IO event stream with replay cursors, checking the fields the real API requires). The crew switches to `api.photon.codes` as soon as the project key and id exist. `crew/scripts/photon-e2e.ts` runs the real crew, the real SpacetimeDB module (a scratch database), real NVIDIA models and a fake solver through all five mechanisms and the photo-to-prop path (29 of 29 checks on the last run); `npm test` in `crew/` covers the per-channel formats, check-in and guidance geometry, commands, the version tree, channel fallback, and the API client against the stand-in.

## Photon Beta features used

| Feature (Photon Beta) | Used | Where |
|---|---|---|
| iMessage shared line: inbound text and images, replies, native threaded replies (`parentMessageId`) | Yes | `src/photon.ts`, `channels/versions.ts` |
| iMessage dedicated line (send first, groups) | No | would remove the forward-a-JOIN-text step; needs a paid line |
| Telegram bot: direct and group chats | Yes | `src/photon.ts` (groups answer photos, replies, commands and "ShotMatch") |
| Telegram albums (2 to 10 attachments) with captions | Yes | `channels/format.ts`, `channels/deliver.ts` |
| Telegram edits (`message.update`) | Yes | progress message edited in place |
| Telegram deep links to start the bot | Yes | invites (`t.me/<bot>?start=<code>`) |
| SMS: outbound-first and inbound | Yes | invites, alerts, render links |
| MMS images | No | SMS gets a link instead |
| WhatsApp Business on a Photon number | Yes | invites, renders, call framing |
| Personal WhatsApp | No | not released yet |
| Email on a custom domain: outbound-first, subject, Markdown body, attachments, inbound replies | Yes | renders, call sheet, alerts; quoted replies are stripped |
| Apple Messages for Business | No | |
| Voice line over SIP to an ElevenLabs agent | Yes | `src/voice.ts`, `scripts/setup-voice.ts` |
| Voice events (`call.ended`) | Yes | framing after hang-up |
| Outbound calls, DTMF | No | |
| Users and Spaces create-or-get (`POST /users`, `POST /spaces`) | Yes | starting conversations for invites and alerts |
| Attachments upload and download | Yes | renders out; photos and voice notes in |
| Voice notes in (`voice` content) | Yes | transcribed by NVIDIA Parakeet, then routed like text |
| Typing indicator | Yes | while a thread render runs |
| Event delivery over Socket.IO with replay cursor | Yes | `startPhoton` saves the cursor in `data/photon.json` |
| Problem codes (`SHARED_LINE_INBOUND_REQUIRED`, `SPACE_NOT_SENDABLE`, `SMS_CAMPAIGN_NOT_ELIGIBLE`) | Yes | drive the channel fallback |
| Idempotency keys on every send | Yes | a restarted crew never sends a message twice |
| Webhook delivery (Standard Webhooks) | No | Socket.IO instead |
| Reactions, polls, message delete, read receipts, space backgrounds | No | |
| Delivery status events (`message.delivered`, `message.failed`) | No | fallback acts on the send's own refusal |
| Chat SDK adapter, Photon Apps, Photon MCP server | No | |

## Where it lives

- `crew/src/photon.ts`: the event stream, per-thread queues and the router (commands, version replies, photos, set words, the locate agent).
- `crew/src/channels/`: `api.ts` (Photon client), `format.ts` (what each channel gets), `deliver.ts` (link to space to sends), `fanout.ts`, `invite.ts`, `versions.ts`, `photos.ts` (check-ins and props), `alerts.ts`, `sheet.ts` (call sheet and its page), `marks.ts` (geometry and words), `commands.ts`.
- `crew/src/voice.ts`: the call tools and the framing after hang-up.
- `web/src/photon/`: the studio panel (people on channels, invites, versions with fork, check-ins), channel badges, check-in markers for the 3D set, and the invite claim on the scout page.
- SpacetimeDB rows: `channel_link`, `shot_version` (each version points at a `scene_change` id), `checkin`, `message`, `reminder` and `outbox` (`module/src/index.ts`, "Photon:").
- Setup for the real project: `crew/PHOTON.md`.

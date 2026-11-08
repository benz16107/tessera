---
title: Call the set
description: Phone the set to be guided to the mark turn by turn and to change the scene by voice while planners watch.
---

At the spot your hands are full: a phone, a bag, maybe a tripod. You can talk, though. Calling the set connects you to a voice agent that knows where you are, where the mark is, and can change the set while you speak.

## Status

The call is built and the agent is configured, but it needs a phone number to dial. That number is a Photon line with a SIP profile pointed at the ElevenLabs agent, which is a setup step in Photon's dashboard (step 5 in `crew/PHOTON.md`). Until it exists, ShotMatch publishes no number to call. The tools below were tested against a stand-in for Photon's Beta API with the real crew and the real SpacetimeDB module: `guide_me` and `edit_set` both ran in the end-to-end check.

## What happens on a call

1. You call the ShotMatch number. Photon hands the call over SIP to an ElevenLabs agent ("ShotMatch guide").
2. The agent finds your set: from your phone number's channel link, else your latest Photon thread, else the six-letter set code you say. If it finds none, it says: "I don't have a set for this number yet. Text a photo to ShotMatch from this phone first, or tell me the six-letter set code."
3. While you talk, it calls tools on the crew (`POST /api/tools/<name>`, guarded by a shared secret):
   - **`get_plan`** reads out the framing: "The mark is `where`. Face `direction`, `n` millimetre lens, about `zoom` on an iPhone."
   - **`guide_me`** gives one turn-by-turn instruction from your phone's live position and compass on the scout page, for example "Turn left 26 degrees, then walk 12 m north." It uses your own scout page when your number is linked to you, else the newest scout in the set, and only positions from the last 10 minutes.
   - **`edit_set`** sends your words to the same Nemotron command the studio uses: "move the bike to the left", "make it sunset". Planners watch the set change while you talk. If an edit takes more than 22 s, the agent says it is still going and the change appears when it lands.
4. When you hang up, Photon's `call.ended` event makes the crew text the final framing and the latest render to your own thread.
5. ElevenLabs' post-call webhook goes straight into the SpacetimeDB module (`POST /hooks/elevenlabs`). The module checks the HMAC signature itself and writes the transcript into the session's messages, so the planners can read what was said.

## Before you call

- Open the scout page on the same phone (see [Scout to the mark](/docs/guides/scout-to-the-mark/)) so `guide_me` has your live position. Without it, the agent can still read the plan and edit the set.
- Text a photo to the ShotMatch line once from that phone, or have someone invite your number from Share, so your number is linked to the set.

## Voice in the studio

You don't need a phone line to talk to the set. In Studio, hold **Hold to talk** in the command bar: NVIDIA Parakeet transcribes in 0.6 to 1.0 s and the words run as a set command. Tick **Speak replies (Magpie)** to hear the answer in NVIDIA Magpie's voice (0.8 to 1.1 s a sentence). Voice notes on Telegram and WhatsApp go through the same Parakeet path.

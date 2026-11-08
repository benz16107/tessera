# Photon and voice setup

The crew's Photon bridge (`src/photon.ts`) is built against the Photon 2.0 beta docs (https://photon.codes/docs/beta/). It stays off until two credential files exist. At start it logs `Photon off: put photon_api_key ... and photon_project_id ...` until they do.

## Files the crew reads

All of them live in `~/.config/shotmatch/` with mode 600, and the crew reads them when it starts. After adding a file, run `systemctl --user restart shotmatch-crew`.

| File | Value | From |
|---|---|---|
| `photon_api_key` | `pho_sk_...` project API key with `project:read` and `project:write` | Beta dashboard, API keys |
| `photon_project_id` | `pho_prj_...` | Beta dashboard, project Settings |
| `elevenlabs_key` | ElevenLabs API key (exists) | ElevenLabs |
| `voice_tool_secret` | random hex; the ElevenLabs tools send it as `x-shotmatch-tool-secret` (exists, also stored as ElevenLabs workspace secret `shotmatch_voice_tool_secret`) | generated |
| `elevenlabs_webhook_secret` | HMAC secret for the post-call webhook (exists) | written by `scripts/setup-voice.ts` |

Nothing else is needed. The crew does not need the agent's Photon user id: it takes the id from each inbound message (`receivedBy.id`).

## What Ben clicks in https://app.beta.photon.codes

Use a ShotMatch project. Do not reuse the hackutd26 project, its agents or its numbers.

1. **Project.** Create the organization and a project named ShotMatch. Open **Settings** and copy the Project ID into `photon_project_id`.
2. **API key.** Go to **API keys**, then **New API key**. Name it `shotmatch-crew`, tick `project:read` and `project:write` (add `platforms:write` if the Telegram bot will be connected over the API), and click **Create key**. The key is shown once; copy it into `photon_api_key`.
3. **iMessage (shared line).** Open **iMessage**. Under "Add the number you or your user will send from", add each tester's phone number or Apple ID email and click **Add**, then **Assign a number from the shared pool**. Each tester must text the assigned number first; the dashboard shows "Waiting for first text" until they do. Shared lines are direct-chat only: no groups, no calls. Every judge's phone used in the demo has to be added here as a sender.
4. **Telegram.** Open the Telegram page in the project and follow its connect flow. It provisions a managed bot, and you pick the name and username inside Telegram. The API route is `POST /v1/projects/{id}/platforms/telegram/bots` with `{}` and an `Idempotency-Key`, then open `detail.setupUrl`. In groups the crew answers only photos, replies to its own messages, and messages that say "ShotMatch".
5. **No webhook destination is needed.** The crew uses the Socket.IO event stream.

## Voice: connecting a Photon number to the ElevenLabs agent

ElevenLabs agent: **ShotMatch guide**, `agent_9201m6wab2eje2eb6x2gg17mnbz8`. Its tools are `get_plan`, `scout_status` and `distance_to_mark`; each POSTs to `https://linuxbox.<tailnet>.ts.net:10000/api/tools/<name>` with the caller id. The post-call webhook goes to `/api/voice/ended`. Re-run `npx tsx scripts/setup-voice.ts` after changing the prompt or the public URL; it updates in place.

The number must be an SMS number, a WhatsApp number or a dedicated iMessage line. A shared iMessage line cannot take calls. Buying an SMS number does not complete messaging compliance, so ask the Photon booth which number counts for the voice prize.

1. Photon dashboard, **Voice**, then **Lines**: find the number. If it has no default profile, click **Set up default**, choose **SIP**, then **Create profile**.
2. ElevenLabs, **Deploy**, **Phone Numbers**, **Import number**, **From SIP Trunk**. Fill in:
   - Label: ShotMatch
   - Number: the Photon number with `+` and country code
   - Inbound Configuration: Media Encryption **Allowed**, allowed numbers empty, source IP `0.0.0.0/0`, username and password empty

   Save, then pick **ShotMatch guide** in the Agent dropdown. A number set to "No agent" does not answer.
3. Photon profile, **Inbound calls**, **Enable inbound**:
   - Destination: `sips:sip.rtc.elevenlabs.io:5061`
   - Transport: TLS
   - Media encryption: Auto
   - No credentials, unless you set them in step 2; then use the identical pair.
4. Call the number. Check **Voice, Recent calls** in Photon and the conversation in ElevenLabs.

**How the caller is matched.** The tools send `system__caller_id`, the caller's number, and the crew looks up that number's latest iMessage or SMS thread in `data/photon.json`. So a caller must have texted ShotMatch from the same phone first. After the call, the post-call webhook texts the final framing into that thread.

## Run and check

- Logs: `journalctl --user -u shotmatch-crew -f`. Look for `Photon subscribed from seq N`.
- The replay cursor and the thread-to-session map live in `data/photon.json`, so a restart resumes after the last handled event.
- Test: text a DUMBO photo to the assigned number. The reply carries the spot, where to stand, heading, lens, light and links to the live plan and scout page; a preview follows when you ask for one ("make it 85mm", "add two people", "at sunset").

# Photon setup and operation

The crew's Photon code (`src/photon.ts` inbound, `src/channels/` outbound, `src/voice.ts` calls) is built against the Photon 2.0 Beta API (https://photon.codes/docs/beta/, spec https://api.photon.codes/openapi.json and https://api.photon.codes/asyncapi.yaml). It switches to the real API the moment `photon_api_key` and `photon_project_id` exist on the box that runs the crew; nothing else changes. `test/fake-photon.ts` stands in for Photon in tests.

## Live state (checked Sun Nov 8, 12:30 AM CT)

- **Project** "ShotMatch", `pho_prj_01m6wse3h8eh78gcxekd7hje5m`, Free plan, in the organization Ben shares with the Hatch project "HackUTD 2026". Never add numbers, testers, bots or webhooks to the Hatch project; every call here names the ShotMatch project id.
- **Key** (full access, ShotMatch only) in `~/.config/shotmatch/photon_api_key` on linuxbox and the Vultr VM, with `photon_project_id`. The Vultr crew logs `Photon subscribed from seq 0`, so the live event stream is up.
- **API checks:** `GET /projects/{id}` and `GET /platforms` answer 200 and list email, iMessage, SMS, Telegram, voice, WhatsApp Business and WhatsApp Personal. `GET /platforms/resources` is empty (no numbers yet). `GET /platforms/imessage` says shared mode, 25 assignments, none used, and a dedicated line would be available now. Billing endpoints answer 403 to a project key.
- **Telegram: live.** @ShotMatchSetBot (resource `pho_res_01m6wyaddhecxsn4829p7cvya0`, active since 00:42 CT). The setup operation only finishes after the person who opened the setup link taps **Select this bot** and then **Confirm connection** in the Photon bot chat in Telegram; until then the operation stays `running`, Telegram shows the bot, and messages to it reach nobody. `photon_agents` on both boxes has `{"telegram":"@ShotMatchSetBot"}`. Live round trips at 00:43 to 01:03 CT: hello, photo located, set edit as v1, reply-to-v1 fork as v1.1, versions, check-in, object photo to prop, and a studio render fanned out as an album (`web/screenshots/photon-live-*.png`). Telegram photo captions arrive on the attachment (`content.metadata.caption`), which the parser reads.
- **iMessage:** Ben's 437 number is assigned on the shared line, agent line +1 (628) 502-4649. The crew answers his first text like any other.
- **Not yet:** an SMS and voice number, email domain, WhatsApp Business, more iMessage testers.

## What it costs on the Free plan (Photon's plans and billing pages)

| Item | Price | Notes |
|---|---|---|
| iMessage shared line | $0 | 25 shared assignments included per project; no per-message fees |
| Telegram, WhatsApp sends | $0 per message | |
| Local US number (SMS and voice) | $2 per month | paid in advance, no proration; inbound voice works about 15 minutes after purchase |
| Voice, US/Canada | $0.013 per minute | |
| SMS, US/Canada | $0.01 per part plus carrier fees | US recipients need an approved 10DLC campaign |
| 10DLC campaign | $20 per registration submission plus $15 per month | review can take days; registration fees are not refundable |
| Email | $0.001 per email | one domain included |
| Dedicated iMessage line | $250 per month | Business plan only |

The $100 organization credit covers the number, an hour of calls and the SMS campaign many times over. It is shared with Hatch's project.

## Ben's dashboard checklist (one pass, about 30 minutes plus waits)

Everything happens at https://app.beta.photon.codes in a project named ShotMatch. Do not reuse the hackutd26 project. Steps marked "wait" start a review or DNS propagation; start those first.

1. **Project.** Done: ShotMatch, `pho_prj_01m6wse3h8eh78gcxekd7hje5m`.
2. **API key.** Done: full access, on linuxbox and the Vultr VM.
3. **Email (wait: DNS).** **Email**, **Connect a domain**: a subdomain of a domain you own, for example `mail.<your domain>` (a subdomain keeps any real inbox's MX records untouched). Open its setup page and add every record it shows at the DNS host: three DKIM CNAMEs, the bounce MX and SPF TXT, and the receiving MX. On GoDaddy: `gddy dns` from macserver (memory `godaddy-cli`), CNAMEs as DNS only. Wait for **Connected**. The agent address is any name under it, for example `set@mail.<your domain>`; Photon creates it when the first email arrives.
4. **SMS number (wait: 10DLC).** **SMS**, buy a number (any US area code). Sending SMS to US numbers needs an approved 10DLC campaign, and carrier review can take days, so outbound SMS may not clear before judging. Start the brand and campaign anyway (use case: account notifications; opt-in: "people text the number first or are added by a friend in the app"). Until it clears, the crew falls back to the person's other channels. Ask the booth whether in-network test numbers can receive.
5. **Voice on that number.** **Voice**, **Lines**, the number, **Set up default**, **SIP**, **Create profile**. Then follow "Voice: connecting the number to the ElevenLabs agent" below.
6. **WhatsApp Business (optional).** **WhatsApp Business**, **Use a Photon SMS number**, pick the number from step 4, complete Meta's signup window (Photon shows Meta's SMS code in the panel). Business-started messages outside a 24-hour window need approved templates, so invites on WhatsApp may be refused until the invitee messages first; the crew then hands the inviter a link to forward.
7. **iMessage shared line.** **iMessage** in the ShotMatch project, under "Add the number you or your user will send from" add each phone that will text ShotMatch: Ben's, each teammate who demos, and any judge's phone at the table (a judge's number can be added in a minute during judging; 25 seats). **Add**, **Assign a number from the shared pool**, and write down the assigned number per person: each person texts their own assigned number once ("JOIN" and the set code works). The dashboard shows "Waiting for first text" until then. Shared lines are direct chats only, no groups, no calls, and cannot send first. For judges who just walk up, Telegram (no assignment) is quicker.
   - *A phone that is already a tester on Hatch's shared line:* Photon's docs don't say how one sender assigned in two projects is routed. An assignment pairs a sender with a pooled line the server picks, and "only messages from the assigned sender reach this shared-line connection", so if ShotMatch gives that sender a different line number, texts to that number should reach ShotMatch and texts to the Hatch number stay with Hatch. Check the assigned number after adding: if it equals the person's Hatch line, release the ShotMatch assignment and ask Photon support before relying on it. Hatch's lines (memory): Maya +16283166196, Theo +16289988619, Jun +16283167976.
8. **Telegram.** Started over the API (above): open the setup link from the lead thread in Telegram and pick the bot's name and @username (for example `@ShotMatchSetBot`). The dashboard's **Telegram** page shows the same flow. Add the bot to a group for the group demo. In groups the crew answers photos, replies to its own messages, commands and messages that say "ShotMatch".
9. **No webhook destination.** The crew reads events over Socket.IO with a saved replay cursor.

Then, on linuxbox (the crew runs on the Vultr box, so the files go there too):

```sh
cd ~/.config/shotmatch
read -rs "k?photon api key: "; printf %s "$k" > photon_api_key; unset k
printf %s pho_prj_XXXXXXXX > photon_project_id
# The handles people text, email, call or open, from steps 3 to 8 (any you skip can be left out):
cat > photon_agents <<'EOF'
{"imessage":"+1XXXXXXXXXX","sms":"+1XXXXXXXXXX","voice":"+1XXXXXXXXXX","whatsapp":"+1XXXXXXXXXX","email":"set@mail.<your domain>","telegram":"@ShotMatchSetBot"}
EOF
chmod 600 photon_api_key photon_project_id photon_agents
scp -p photon_api_key photon_project_id photon_agents ben@104.238.146.229:.config/shotmatch/
ssh ben@104.238.146.229 'systemctl --user restart shotmatch-crew && sleep 6 && journalctl --user -u shotmatch-crew -n 20 --no-pager | grep -i photon'
```

The log should say `Photon subscribed from seq 0`. `GET /api/photon/status` on the public URL says `"enabled": true`, and the studio's Photon panel switches from "waiting on keys" to "Photon live".

## Files the crew reads

All in `~/.config/shotmatch/`, mode 600, read at use time.

| File | Value | From |
|---|---|---|
| `photon_api_key` | `pho_sk_...` with `project:read`, `project:write`, `platforms:read` | step 2 |
| `photon_project_id` | `pho_prj_...` | step 1 |
| `photon_agents` | JSON of the agent's handle per channel (`imessage`, `sms`, `voice`, `whatsapp`, `email`, `telegram`) | steps 3 to 8 |
| `elevenlabs_key`, `voice_tool_secret`, `elevenlabs_webhook_secret` | exist | `scripts/setup-voice.ts` |

`photon_agents` is what lets the crew start a conversation (an invite, an alert, the framing after a call) on a channel nobody has written on yet: it resolves the handle to Photon's agent user (`POST /users`) and creates the space (`POST /spaces`). Agent ids learned from inbound messages are kept in `data/photon.json` too.

## How each mechanism uses Photon

| Mechanism | Code | Photon calls |
|---|---|---|
| 1. One live set, everyone on their own channel | `channels/fanout.ts`, `format.ts`, `deliver.ts`, `invite.ts` | `POST /users`, `POST /spaces`, `POST /attachments`, `POST /messages` (text, attachment, group album, `message.update` edit, email subject), Socket.IO `message.received` |
| 2. Call the set | `voice.ts`, `scripts/setup-voice.ts` | Voice line, SIP profile to ElevenLabs, `call.ended` event; tools at `/api/tools/<name>` |
| 3. Check in by photo | `channels/photos.ts` | inbound image attachment, threaded reply (`parentMessageId`) |
| 4. The thread is the version tree | `channels/versions.ts`, `photon.ts` | inbound `parentMessageId` (a native reply), threaded replies |
| 5. Messages at the moment of the shot | `channels/alerts.ts` | `POST /messages` into existing or new spaces, refusal codes `SHARED_LINE_INBOUND_REQUIRED`, `SPACE_NOT_SENDABLE`, `SMS_CAMPAIGN_NOT_ELIGIBLE` drive the channel fallback |

Per channel, an event becomes: iMessage, the image and one line; Telegram, an album of lens options (exact crops at 50 and 85 mm) and one progress message edited in place; email, one message with a Markdown body (Photon refuses HTML inside Markdown, so the designed page is linked at `/sheet/<code>`) and the image attached; SMS, text and a link; WhatsApp, the image and a line with the live set link. Voice links take calls only.

## Voice: connecting the number to the ElevenLabs agent

ElevenLabs agent **ShotMatch guide** (`agent_9201m6wab2eje2eb6x2gg17mnbz8`). Tools: `get_plan`, `guide_me` (one turn-by-turn instruction from the caller's live phone pose), `edit_set` (scene edits by voice through the same text-to-set command as the studio), plus `scout_status` and `distance_to_mark` as aliases of `guide_me`. Each POSTs to `<public URL>/api/tools/<name>` with the caller id and the `x-shotmatch-tool-secret` header. Re-run `npx tsx scripts/setup-voice.ts` on linuxbox after changing the prompt, the tools or the public URL; it updates in place. Run it only where `data/voice.json` has the current webhook id (linuxbox), or it would create a second post-call webhook.

1. Photon dashboard, **Voice**, **Lines**: the SMS number from step 4. If it has no default profile, **Set up default**, **SIP**, **Create profile**.
2. ElevenLabs, **Deploy**, **Phone Numbers**, **Import number**, **From SIP Trunk**: label ShotMatch, the number with `+` and country code, Inbound: media encryption **Allowed**, allowed numbers empty, source IP `0.0.0.0/0`, no username or password. Save, then pick **ShotMatch guide** in the Agent dropdown (a number set to "No agent" does not answer).
3. Photon profile, **Inbound calls**, **Enable inbound**: destination `sips:sip.rtc.elevenlabs.io:5061`, transport TLS, media encryption Auto, no credentials.
4. Call the number. Check **Voice, Recent calls** in Photon and the conversation in ElevenLabs.

**How the caller is matched.** The tools send `system__caller_id`. The crew finds the newest channel link with that number (an invite or anyone who texted from it), else their latest thread, else a set code they say. If that link was claimed from the scout page (`/s/<code>?inv=...`), `guide_me` reads that phone's own position; otherwise it guides from the newest scout. After hang-up, Photon's `call.ended` makes the crew send the framing and the latest render to the caller on the first of their channels that takes it. The ElevenLabs post-call webhook (`d459b97d...`) goes to the module's `/hooks/elevenlabs` route, which checks the HMAC and writes the transcript into the caller's session (found by the same channel link). The crew's own `/api/voice/ended` still works if a webhook is pointed at it.

## Shared-line limits and what the crew does about them

- A shared iMessage line cannot send first. Invites on iMessage hand the inviter a "Text JOIN <code> to <number>" message to forward, and alerts skip iMessage for anyone who never texted.
- It may refuse a late message into an open thread (`403 SHARED_LINE_INBOUND_REQUIRED` or `409 SPACE_NOT_SENDABLE`). The alert then goes to that person's next channel in the order Telegram, SMS, email, WhatsApp.
- Telegram bots cannot message first either: Telegram invites return a `https://t.me/<bot>?start=<code>` link, and `/start <code>` joins the set.

## Run and check

- Unit tests: `npm test` (includes the fake server API and event stream tests).
- End to end without credentials: `npx tsx scripts/photon-e2e.ts`. It runs a second crew against the scratch database `shotmatch-photon` with the fake Photon server and a fake solver, and real NVIDIA calls. Never point it at `shotmatch`: it re-registers the crew identity on the database it uses.
- Logs: `journalctl --user -u shotmatch-crew -f`. `data/photon.json` holds the replay cursor, threads, outbound spaces, version message ids and invite tokens.

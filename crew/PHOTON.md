# Photon setup and operation

The crew's Photon code (`src/photon.ts` inbound, `src/channels/` outbound, `src/voice.ts` calls) is built against the Photon 2.0 Beta API (https://photon.codes/docs/beta/, spec https://api.photon.codes/openapi.json and https://api.photon.codes/asyncapi.yaml). It runs fully against the fake Photon server in `test/fake-photon.ts` today. It switches to the real API the moment `photon_api_key` and `photon_project_id` exist on the box that runs the crew; nothing else changes.

## Ben's dashboard checklist (one pass, about 30 minutes plus waits)

Everything happens at https://app.beta.photon.codes in a project named ShotMatch. Do not reuse the hackutd26 project. Steps marked "wait" start a review or DNS propagation; start those first.

1. **Project.** Create (or pick) the organization, then a project named ShotMatch. **Settings**, copy the **Project ID** (`pho_prj_...`).
2. **API key.** **API keys**, **New API key**, name `shotmatch-crew`, tick `project:read`, `project:write` and `platforms:read` (add `platforms:write` only if you want the crew to connect the Telegram bot over the API). **Create key**. It is shown once.
3. **Email (wait: DNS).** **Email**, **Connect a domain**: a subdomain of a domain you own, for example `mail.<your domain>` (a subdomain keeps any real inbox's MX records untouched). Open its setup page and add every record it shows at the DNS host: three DKIM CNAMEs, the bounce MX and SPF TXT, and the receiving MX. On GoDaddy: `gddy dns` from macserver (memory `godaddy-cli`), CNAMEs as DNS only. Wait for **Connected**. The agent address is any name under it, for example `set@mail.<your domain>`; Photon creates it when the first email arrives.
4. **SMS number (wait: 10DLC).** **SMS**, buy a number (any US area code). Sending SMS to US numbers needs an approved 10DLC campaign, and carrier review can take days, so outbound SMS may not clear before judging. Start the brand and campaign anyway (use case: account notifications; opt-in: "people text the number first or are added by a friend in the app"). Until it clears, the crew falls back to the person's other channels. Ask the booth whether in-network test numbers can receive.
5. **Voice on that number.** **Voice**, **Lines**, the number, **Set up default**, **SIP**, **Create profile**. Then follow "Voice: connecting the number to the ElevenLabs agent" below.
6. **WhatsApp Business (optional).** **WhatsApp Business**, **Use a Photon SMS number**, pick the number from step 4, complete Meta's signup window (Photon shows Meta's SMS code in the panel). Business-started messages outside a 24-hour window need approved templates, so invites on WhatsApp may be refused until the invitee messages first; the crew then hands the inviter a link to forward.
7. **iMessage shared line.** **iMessage**, under "Add the number you or your user will send from" add each demo phone (Ben, teammates, every judge phone you will hand a demo to), **Add**, **Assign a number from the shared pool**. Each sender must text the assigned number once ("JOIN" and the set code works); the dashboard shows "Waiting for first text" until then. Shared lines are direct chats only, no groups, no calls, and cannot send first.
8. **Telegram.** **Telegram**, follow the connect flow; it provisions a managed bot and you pick its name and @username in Telegram (for example `@ShotMatchSetBot`). Add the bot to a group for the group demo. In groups the crew answers photos, replies to its own messages, commands and messages that say "ShotMatch".
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

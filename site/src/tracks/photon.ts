// Photon track. The thread mocks quote the real message text from the end-to-end run against the Photon stand-in
// (crew/scripts/photon-e2e.ts, log in data/photon-e2e.log, report in the photon thread) and the crew's channel formats
// (crew/src/channels/format.ts). Where the run did not record a reply's exact words, the thread shows a note instead.
import type { Track } from './types.ts';
import panel from '../assets/cards/photon-panel.png';
import render from '../assets/cards/photon-render.png';
import photo from '../assets/shots/user-photo-d0481.jpg';
import liveHello from '../assets/shots/photon-live-telegram-hello.png';
import liveLocate from '../assets/shots/photon-live-telegram-locate.png';
import liveVersion from '../assets/shots/photon-live-telegram-version.png';
import liveFork from '../assets/shots/photon-live-telegram-fork.png';
import liveVersions from '../assets/shots/photon-live-telegram-versions.png';
import liveCheckin from '../assets/shots/photon-live-telegram-checkin.png';
import liveProp from '../assets/shots/photon-live-telegram-prop.png';
import liveFanout from '../assets/shots/photon-live-telegram-fanout.png';
import studioCheckin from '../assets/shots/photon-live-studio-checkin.png';
import studioPanel from '../assets/shots/photon-live-studio-panel.png';

const SRC = 'Text from crew/scripts/photon-e2e.ts against the Photon stand-in (29 of 29 checks), formats from crew/src/channels/format.ts';

export default {
  slug: 'photon',
  sponsor: 'Photon',
  prize: 'Photon 2.0 API, plus the voice-call prize',
  order: 3,
  oneLine: 'The shared set reaches every person on the app they already use, and a phone call can guide you to the mark and edit the set by voice.',
  noteTag: 'Live on Telegram',
  note: 'Every mechanism that runs on Telegram is shown below from real screenshots: Photon\'s live API and the managed bot @ShotMatchSetBot, Sunday Nov 8, 12:42 to 1:03 AM CT. iMessage, SMS, voice calls, email and WhatsApp Business each need a number, DNS or Meta signup, so the phone call, the golden-hour alert and those channels are shown from our end-to-end run against a stand-in for the Photon Beta API and tagged Stand-in.',
  hero: { img: liveLocate, alt: 'The live Telegram chat with the ShotMatch bot: a photo of the Manhattan Bridge from Washington St goes in; the reply says Solid, 1600 matches, where to stand, facing north 4 degrees, 54 mm equivalent or about 2.2x on an iPhone, and the next golden hour.', caption: 'Live on Telegram, Nov 8, 12:51 AM CT: a texted photo comes back located, with where to stand, the heading, the lens and the next good light.', frame: 'none' },
  headline: [
    { value: '8', label: 'live round trips on Telegram, 12:42 to 1:03 AM CT: hello, locate, v1, fork to v1.1, versions, check-in, prop, fan-out', check: 'web/screenshots/photon-live-*.png; message @ShotMatchSetBot' },
    { value: '29 of 29', label: 'end-to-end checks across all five mechanisms', check: 'cd crew && npx tsx scripts/photon-e2e.ts', standIn: true },
    { value: '6', label: 'channels, each in its own form: iMessage, Telegram, SMS, WhatsApp Business, email, phone', check: 'crew/src/channels/format.ts' },
  ],
  why: [
    { title: 'Most of the crew will never open a 3D editor', body: 'A shoot has a photographer, friends in the frame, someone holding a reflector, a parent driving. They already have iMessage, Telegram, WhatsApp, SMS or email. Photon lets the set come to each of them there.' },
    { title: 'The person at the spot has their hands full', body: 'A scout outdoors can call or snap one photo, not drive an editor. Calling the set and texting a photo are the two things a person can do while walking, and both run on Photon.' },
    { title: 'Light does not wait', body: 'Golden hour starts at a fixed minute. The message that matters arrives at that minute on the channel that will actually deliver, so ShotMatch falls back to the next channel when one refuses.' },
    { title: 'A thread is a natural version history', body: 'People already reply to the picture they mean. Photon\'s threaded replies let a reply to v1 fork the set from v1, so the conversation and the set history stay one thing.' },
  ],
  threads: [
    {
      mechanism: 'Live: the bot answers',
      channel: 'Telegram',
      why: 'A real "hi" to @ShotMatchSetBot starts a session and returns the live plan and scout links, with nothing to install.',
      source: 'Photon live API, managed Telegram bot, Nov 8, 12:43 AM CT',
      live: { when: '12:43 AM CT', shots: [{ img: liveHello, alt: 'Telegram chat with the ShotMatch bot: /start and hi; the bot replies: Hi. I am ShotMatch. Share a photo of a place and I will find where the photographer stood, which way they faced, and what lens they used, with links to the live plan and the scout page.' }] },
      messages: [],
    },
    {
      mechanism: 'Live: text a photo, get the spot',
      channel: 'Telegram',
      why: 'The core of ShotMatch runs in the chat: a photo goes in; where to stand, which way to face, the lens and the next good light come back.',
      source: 'Photon live API, managed Telegram bot, Nov 8, 12:51 AM CT',
      live: { when: '12:51 AM CT', shots: [{ img: liveLocate, alt: 'Telegram: the Manhattan Bridge photo with the caption Where was this taken from; the bot replies Locating your shot: done, then Solid: Manhattan Bridge from Washington St, DUMBO. 1600 matches, 1 m from a mapped camera. Stand at 40.70317, -73.98960. Face north (4 degrees), tilted up 3 degrees. Lens: 54 mm equivalent, about 2.2x on an iPhone. Next good light: golden hour Sun 6:35 AM to 7:15 AM.' }] },
      messages: [],
    },
    {
      mechanism: '1. One live set, everyone on their own channel',
      channel: 'Telegram',
      why: 'A planner pressed Render in the studio. Nobody touched Telegram: the render arrived there on its own as an album of lens options (54 and 85 mm, exact crops), captioned v2, and the studio\'s People panel shows the same set with Ben on Telegram and every version.',
      source: 'Photon live API, managed Telegram bot, and the studio on the same set, Nov 8, about 1:03 AM CT',
      live: { when: '1:03 AM CT', shots: [
        { img: liveFanout, alt: 'Telegram: the bot sends v2: golden hour light, the floor lamp switched on beside the bike, with Lens options: 54 mm, 85 mm, exact crops of the render, then v2 is ready.' },
        { img: studioPanel, alt: 'Studio on the same set: the People and live data panel shows Photon live, Ben Zhou on Telegram, versions v1, v1.1 and v2 with Fork buttons, the check-in row, and the live feed; the lamp stands in the Cam A view.' },
      ] },
      messages: [],
    },
    {
      mechanism: '4. The thread is the version tree',
      channel: 'Telegram',
      why: 'Words in the chat edited the set and came back as v1 with its render. A native Telegram reply to v1 forked the set to v1.1 with its own render, and "versions" printed the tree.',
      source: 'Photon live API, managed Telegram bot, Nov 8, 12:52 to 12:57 AM CT',
      live: { when: '12:52 to 12:57 AM CT', shots: [
        { img: liveVersion, alt: 'Telegram: Add a red bike leaning on the left and a friend walking toward the camera; the bot replies with a render and v1: I placed a red bike leaning on the left at frame_x -0.59, 4.5 m, and a friend walking toward the camera at frame_x 0.12, 6 m. Reply to change it.' },
        { img: liveFork, alt: 'Telegram: a reply to the v1 message, Make it sunset and move the bike to the right; the bot answers with a sunset render and v1.1 (from v1): I set the time to sunset and moved the red bike to the right side of the frame at 4.5 m from the camera.' },
        { img: liveVersions, alt: 'Telegram: versions; the bot lists v1 at 1:53 AM on telegram with v1.1 at 1:56 AM under it, and Reply to any version\'s message to fork from it.' },
      ] },
      messages: [],
    },
    {
      mechanism: '3. Check in by photo',
      channel: 'Telegram',
      why: 'A second photo from the street was solved against the spot and compared with the shot camera. The reply said which way to step, and the check-in appeared in the studio for everyone.',
      source: 'Photon live API, managed Telegram bot, and the studio, Nov 8, 12:58 AM CT',
      live: { when: '12:58 AM CT', shots: [
        { img: liveCheckin, alt: 'Telegram: a street photo toward the Manhattan Bridge; the bot replies You are 9.3 m south of the mark. Step forward 12 paces, then 4 paces to your left.' },
        { img: studioCheckin, alt: 'Studio in Earth top view (Google 3D Tiles, with credits) on the same set, with the notice Ben Zhou checked in: off the mark, 9.3 m.' },
      ] },
      messages: [],
    },
    {
      mechanism: 'Also: the camera roll becomes props',
      channel: 'Telegram',
      why: 'A photo of a lamp with "Add this lamp to the set" put a floor lamp in the set, and the next render showed it. In this run the hosted photo-to-3D model returned an error, so the lamp went in as a flat cut-out from the photo, not a 3D mesh.',
      source: 'Photon live API, managed Telegram bot, Nov 8, 12:59 AM to 1:02 AM CT',
      live: { when: '12:59 AM CT', shots: [{ img: liveProp, alt: 'Telegram: a photo of a floor lamp with Add this lamp to the set; the bot replies Turning a floor lamp into a 3D prop for the set. It takes a minute or two, then Added a floor lamp to the set on the left, 5 m from the camera.' }] },
      messages: [],
    },
    {
      mechanism: '1. The same set on iMessage, SMS, email and WhatsApp',
      channel: 'iMessage',
      why: 'Set up next: each channel gets its own form (iMessage the image and one line, email a full message, SMS a link). Ben\'s number is assigned on the shared iMessage line but has not texted it yet; SMS, email and WhatsApp Business need a number, DNS or Meta signup.',
      source: SRC,
      messages: [
        { from: 'person', text: 'JOIN ER7CGZ' },
        { from: 'note', text: 'Joined the set ER7CGZ. Anything this person texts now lands in the session as a message row.' },
        { from: 'person', text: 'add Priya +1 469 555 0144 on SMS' },
        { from: 'note', text: 'Priya is invited by SMS with a link to the scout page.' },
        { from: 'shotmatch', text: 'v1: warm golden hour light Reply to this to change it.', img: render, meta: 'image, then one line' },
        { from: 'note', text: 'Email: subject "ShotMatch v1: warm golden hour light", the image attached, "It is an AI interpretation of the shot." SMS: "ShotMatch v1: warm golden hour light See it:" and a link.' },
      ],
    },
    {
      mechanism: '2. Call the set',
      channel: 'Phone call',
      why: 'A caller walking to the spot gets turn-by-turn directions from their live phone position, and can change the set out loud while planners watch.',
      source: `${SRC}. Voice tools guide_me and edit_set in crew/src/voice.ts.`,
      messages: [
        { from: 'note', text: 'The scout calls the ShotMatch number. The agent asks guide_me for the caller\'s live position and compass.' },
        { from: 'shotmatch', text: 'Turn left 26 degrees, then walk 12 m north.', meta: 'spoken' },
        { from: 'person', text: 'move the red bike to the right side of the frame', meta: 'spoken' },
        { from: 'shotmatch', text: 'The red bike is now on the right side of the frame at frame_x 1, 9.2 m from the camera.', meta: 'spoken; the bike moves in the studio' },
        { from: 'note', text: 'Call ended. The framing and the latest render are sent to the caller\'s own thread (WhatsApp in this run), and the transcript is written into the session.' },
      ],
    },
    {
      mechanism: '5. Messages at the moment of the shot',
      channel: 'WhatsApp',
      why: 'The alert goes out 20 minutes before golden hour with each person\'s own walking time, on the channel that will deliver.',
      source: SRC,
      messages: [
        { from: 'shotmatch', text: 'Golden hour starts in 20 min. You\'re 300 m away, about 4 min on foot.' },
        { from: 'note', text: 'In the same run Maya\'s iMessage refused the late send (SHARED_LINE_INBOUND_REQUIRED), so her alert went to her email instead.' },
      ],
    },
  ],
  uses: [
    { name: 'Text a photo, get the spot', line: 'A photo sent to the bot is solved against the spot model; the reply names the spot, where to stand, the heading, the lens and the next good light.', where: 'crew/src/photon.ts (locate agent), solver POST /solve', status: 'live', img: liveLocate, alt: 'The live Telegram reply locating the Manhattan Bridge photo' },
    { name: 'Event stream with a replay cursor', line: 'Every inbound message, voice note and call event arrives over Photon\'s Socket.IO stream; a restarted crew resumes from its saved cursor.', where: 'crew/src/photon.ts (startPhoton), cursor in data/photon.json', status: 'live' },
    { name: 'Per-channel delivery', line: 'One set event becomes an album on Telegram (live: a studio render arrived as v2 with 54 and 85 mm crops), an image and a line on iMessage, a Markdown email, an SMS link or a WhatsApp image.', where: 'crew/src/channels/format.ts, deliver.ts, fanout.ts', status: 'live', img: liveFanout, alt: 'The live Telegram album of lens options captioned v2', detail: 'Live on Telegram. iMessage, email, SMS and WhatsApp Business are set up next; their formats are proven in the stand-in run.' },
    { name: 'The studio\'s People panel', line: 'Who is on which channel, the versions that came from the threads with Fork buttons, and the check-ins, on the same set the chat edits.', where: 'web/src/photon/ (PhotonPanel); channel_link, shot_version, checkin rows', status: 'live', img: studioPanel, alt: 'The live People panel: Ben Zhou on Telegram, versions v1, v1.1 and v2, the check-in row' },
    { name: 'Invites by channel', line: 'Invite from the studio or from a text; where Photon cannot message first, the inviter gets the exact text or t.me link to forward.', where: 'crew/src/channels/invite.ts; Studio People panel', status: 'stand-in', },
    { name: 'Threaded replies fork versions', line: 'A native reply to a version\'s message forks the set from that version over SpacetimeDB scene history (live: v1 to v1.1).', where: 'crew/src/channels/versions.ts; shot_version and restoreToVersion in the module', status: 'live', img: liveFork, alt: 'The live Telegram reply to v1 that came back as v1.1' },
    { name: 'Telegram albums and edits', line: 'Lens options as one album with a caption (live), and one progress message edited in place while a render runs.', where: 'crew/src/channels/format.ts (Telegram)', status: 'live' },
    { name: 'Voice line over SIP', line: 'An ElevenLabs agent on a Photon number, with guide_me and edit_set tools on the crew, and the framing texted after call.ended.', where: 'crew/src/voice.ts, crew/scripts/setup-voice.ts', status: 'built', detail: 'Waits on a Photon number with a SIP profile pointed at ElevenLabs (crew/PHOTON.md step 5). The ElevenLabs post-call webhook is live and writes transcripts into SpacetimeDB.' },
    { name: 'Check in by photo', line: 'A texted photo is classified, solved against the spot and compared with the shot camera; the reply gives the correction (live: 9.3 m south, 12 paces forward).', where: 'crew/src/channels/photos.ts, marks.ts; checkin table', status: 'live', img: liveCheckin, alt: 'The live Telegram check-in reply' },
    { name: 'Photo to prop', line: 'A photo of one object becomes a prop through Nemotron and TRELLIS, placed where the reply says. Live run: TRELLIS returned an error, so the lamp became a flat cut-out from the photo.', where: 'crew/src/channels/photos.ts, /api/props/generate', status: 'live', img: liveProp, alt: 'The live Telegram lamp photo and the bot\'s reply' },
    { name: 'Channel fallback on problem codes', line: 'SHARED_LINE_INBOUND_REQUIRED, SPACE_NOT_SENDABLE and SMS_CAMPAIGN_NOT_ELIGIBLE move an alert to the next channel.', where: 'crew/src/channels/alerts.ts', status: 'stand-in' },
    { name: 'Golden-hour alerts', line: 'The module\'s reminder schedule fires 20 minutes before golden hour; the crew writes one message per person with their live distance.', where: 'module reminder schedule, crew/src/channels/alerts.ts', status: 'stand-in' },
    { name: 'Voice notes in', line: 'Telegram and WhatsApp voice notes are transcribed by NVIDIA Parakeet and routed like typed text.', where: 'crew/src/speech.ts, crew/src/photon.ts', status: 'stand-in' },
    { name: 'Idempotency keys and typing indicator', line: 'Every send carries an idempotency key so a restarted crew never sends twice; a typing indicator shows while a render runs.', where: 'crew/src/channels/api.ts', status: 'stand-in' },
  ],
  proof: [
    { value: '29 of 29', label: 'checks in the end-to-end run of all five mechanisms and photo-to-prop', check: 'cd crew && npx tsx scripts/photon-e2e.ts (uses database shotmatch-photon, never production)', standIn: true },
    { value: '66 of 66', label: 'crew unit tests, including per-channel formats, guidance geometry, the version tree and channel order', check: 'cd crew && npm test' },
    { value: '8 live', label: 'round trips through Photon\'s live API and @ShotMatchSetBot, 12:42 to 1:03 AM CT: hello, locate (Solid, 1600 matches, 54 mm), v1, fork to v1.1, versions, check-in (9.3 m south), lamp prop, studio render fanned out as an album', check: 'web/screenshots/photon-live-*.png; docs/PHOTON.md, Evidence; message @ShotMatchSetBot' },
    { value: 'live', label: 'ElevenLabs post-call webhook into SpacetimeDB: bad signature 401, valid one writes the transcript, retry is a no-op', check: 'docs/SPACETIME.md, section HTTP handlers' },
  ],
  ours: [
    'The five mechanisms and the router that decides what each message means (command, reply to a version, photo, set words)',
    'Per-channel formats, fan-out, invites, channel fallback, alerts with walking time',
    'Check-in geometry and the corrections in words',
    'The voice tools guide_me and edit_set',
    'The SpacetimeDB rows behind it: channel_link, shot_version, checkin, message',
  ],
  theirs: [
    'iMessage shared line, Telegram bots, SMS, WhatsApp Business, email on our domain, and the voice line over SIP',
    'Users and Spaces, attachments, threaded replies (parentMessageId), Telegram albums and message edits',
    'The event stream with replay cursor, problem codes, idempotency keys, typing indicators',
  ],
  limits: [
    'Telegram is live. iMessage (Ben\'s number is assigned on the shared line but has not texted yet), SMS, voice calls, email and WhatsApp Business still need a number, DNS or Meta signup (crew/PHOTON.md); SMS also needs a 10DLC campaign.',
    'In the live run the hosted photo-to-3D model returned an error, so the texted lamp became a flat cut-out, not a 3D mesh.',
    'Until those lines are connected, their proof is the stand-in run, not a live round trip.',
    'The shared iMessage line cannot message first, so iMessage invites ask the person to text JOIN <code>.',
    'MMS, reactions, polls and delivery-status events are not used.',
  ],
  video: {
    title: 'The set in your texts',
    length: 'about 2:45',
    summary: 'A screen recording of the studio beside the message threads. Beats that need a live Photon line say so; until a line is live, the recording shows the stand-in run and says so on screen.',
    shots: [
      { t: '0:00 to 0:15', screen: 'Simple /p/A9TVAN, then Share: the invite sheet', say: 'Most people on a shoot will never open a 3D editor. So the set comes to their texts.', criterion: 'Problem first' },
      { t: '0:15 to 0:45', screen: 'Studio on the test set; press Render. Telegram receives the 35, 50 and 85 mm album with the progress message edited in place. iMessage and email: record once the line is live; until then the e2e log lines for iMessage and email', say: 'One render, every channel in its own form: an album on Telegram, the image and one line on iMessage, an attachment by email.', criterion: 'Photon 2.0 API, multi-channel' },
      { t: '0:45 to 1:15', screen: 'Reply "make it sunset" to v1 in the thread; the studio\'s set rewinds to v1 and v1.1 arrives threaded. Record once iMessage is live; until then Telegram reply or the e2e log', say: 'Reply to any version and the set forks from it. The thread is a version tree over the set\'s history.', criterion: 'Threads drive state' },
      { t: '1:15 to 1:45', screen: 'Scout page on a phone at the mark; text a photo; the correction reply and a check-in marker in the studio', say: 'Text a photo from where you stand. ShotMatch solves it and tells you which way to step.', criterion: 'Messaging as input' },
      { t: '1:45 to 2:20', screen: 'Call the number; say "move the bike to the left"; the bike moves in the studio; hang up; the framing arrives as a text. Record once the voice number is live; until then the e2e log\'s guide_me and edit_set lines', say: 'Call the set. It guides you to the mark and edits the scene by voice while your friends watch.', criterion: 'Voice-call prize' },
      { t: '2:20 to 2:45', screen: 'The golden-hour alert on one channel and the fallback to email; then this page\'s Where it\'s used list', say: 'Twenty minutes before golden hour, everyone gets their walking time on the channel that will deliver.', criterion: 'Reliability, problem codes' },
    ],
    notes: 'Studio at 1512 x 982 on the left half, the phone or Telegram Desktop on the right. Use the test set ZJNNGP so renders do not pile up on A9TVAN. Run npx tsx scripts/photon-e2e.ts once and keep its log open. Each live beat needs its line connected in Photon\'s dashboard first (crew/PHOTON.md steps 3 to 8).',
  },
  docs: [
    { label: 'How messaging works', href: '/docs/how-it-works/messaging/' },
    { label: 'Call the set', href: '/docs/guides/call-the-set/' },
    { label: 'Scout to the mark', href: '/docs/guides/scout-to-the-mark/' },
    { label: 'HTTP API', href: '/docs/reference/http-api/' },
  ],
} satisfies Track;

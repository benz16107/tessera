// Photon track. The thread mocks quote the real message text from the end-to-end run against the Photon stand-in
// (crew/scripts/photon-e2e.ts, log in data/photon-e2e.log, report in the photon thread) and the crew's channel formats
// (crew/src/channels/format.ts). Where the run did not record a reply's exact words, the thread shows a note instead.
import type { Track } from './types.ts';
import panel from '../assets/cards/photon-panel.png';
import render from '../assets/cards/photon-render.png';
import photo from '../assets/shots/user-photo-d0481.jpg';

const SRC = 'Text from crew/scripts/photon-e2e.ts against the Photon stand-in (29 of 29 checks), formats from crew/src/channels/format.ts';

export default {
  slug: 'photon',
  sponsor: 'Photon',
  prize: 'Photon 2.0 API, plus the voice-call prize',
  order: 3,
  oneLine: 'The shared set reaches every person on the app they already use, and a phone call can guide you to the mark and edit the set by voice.',
  note: 'Stand-in proof: the production crew is connected to Photon\'s live API and event stream, but no public number or bot handle is published yet. Every thread below ran end to end against a stand-in for the Photon Beta API with the real crew, the real SpacetimeDB module and real NVIDIA models. We will replace this note with the live round trip once the lines are connected.',
  hero: { img: panel, alt: 'The People panel in ShotMatch Studio: On their phones, Photon live, an invite form with name, channel and phone number, Send call sheet to everyone, and Versions from the threads.', caption: 'Studio\'s People panel on the demo set: invite by channel, send the call sheet, and see the versions that came from the threads.', frame: 'none' },
  headline: [
    { value: '29 of 29', label: 'end-to-end checks across all five mechanisms', check: 'cd crew && npx tsx scripts/photon-e2e.ts', standIn: true },
    { value: '6', label: 'channels, each in its own form: iMessage, Telegram, SMS, WhatsApp Business, email, phone', check: 'crew/src/channels/format.ts' },
    { value: '20 min', label: 'before golden hour, each person gets their own walking time', check: 'module reminder schedule; crew/src/channels/alerts.ts' },
  ],
  why: [
    { title: 'Most of the crew will never open a 3D editor', body: 'A shoot has a photographer, friends in the frame, someone holding a reflector, a parent driving. They already have iMessage, Telegram, WhatsApp, SMS or email. Photon lets the set come to each of them there.' },
    { title: 'The person at the spot has their hands full', body: 'A scout outdoors can call or snap one photo, not drive an editor. Calling the set and texting a photo are the two things a person can do while walking, and both run on Photon.' },
    { title: 'Light does not wait', body: 'Golden hour starts at a fixed minute. The message that matters arrives at that minute on the channel that will actually deliver, so ShotMatch falls back to the next channel when one refuses.' },
    { title: 'A thread is a natural version history', body: 'People already reply to the picture they mean. Photon\'s threaded replies let a reply to v1 fork the set from v1, so the conversation and the set history stay one thing.' },
  ],
  threads: [
    {
      mechanism: '1. One live set, everyone on their own channel',
      channel: 'iMessage',
      why: 'Joining and inviting by text means nobody installs anything, and every render reaches each person in their own app.',
      source: SRC,
      messages: [
        { from: 'person', text: 'JOIN ER7CGZ' },
        { from: 'note', text: 'Joined the set ER7CGZ. Anything this person texts now lands in the session as a message row.' },
        { from: 'person', text: 'add Priya +1 469 555 0144 on SMS' },
        { from: 'note', text: 'Priya is invited by SMS with a link to the scout page.' },
        { from: 'shotmatch', text: 'v1: warm golden hour light Reply to this to change it.', img: render, meta: 'image, then one line' },
      ],
    },
    {
      mechanism: '1. The same render on Telegram, email and SMS',
      channel: 'Telegram',
      why: 'Each channel gets the form it does best: Telegram an album with a caption, email a full message, SMS a link.',
      source: SRC,
      messages: [
        { from: 'person', text: '/start ER7CGZ', meta: 'from the t.me/ShotMatchSetBot?start=ER7CGZ invite link' },
        { from: 'note', text: 'One progress message is edited in place while the render runs.' },
        { from: 'shotmatch', text: 'v1: warm golden hour light Lens options: 35 mm, 50 mm, 85 mm, exact crops of the render. Reply to change it.', img: render, meta: 'album of 3 crops' },
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
      mechanism: '3. Check in by photo',
      channel: 'iMessage',
      why: 'The scout snaps the view instead of describing it. The solver places the photo and the reply says exactly which way to step.',
      source: SRC,
      messages: [
        { from: 'person', text: '', img: photo, meta: 'a photo from where they stand' },
        { from: 'shotmatch', text: 'You\'re 3.2 m east of the mark and facing 14 degrees too far left. 4 paces to your left, then turn right 14 degrees.' },
        { from: 'note', text: 'A check-in row with the position: a marker appears in the 3D set and everyone else gets one line on their channel.' },
      ],
    },
    {
      mechanism: '4. The thread is the version tree',
      channel: 'iMessage',
      why: 'Replying to an older render is how people already say "go back to that one". The reply forks the set from that version.',
      source: SRC,
      messages: [
        { from: 'shotmatch', text: 'v1: warm golden hour light Reply to this to change it.', img: render },
        { from: 'person', text: 'move the red bike to the left side of the frame', meta: 'a reply to v1' },
        { from: 'note', text: 'The set rewinds to v1 for everyone, branches to v1.1, moves the bike (x 2.0 to -2.6), renders, and answers threaded on the reply.' },
        { from: 'person', text: 'versions' },
        { from: 'note', text: 'The reply lists the version tree: v1, then v1.1 under it.' },
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
    {
      mechanism: 'Also: the camera roll becomes props',
      channel: 'iMessage',
      why: 'A texted photo of one object becomes a 3D prop at real size, so props come from what people already have on their phones.',
      source: SRC,
      messages: [
        { from: 'person', text: 'add this lamp to the set', meta: 'with a photo of a floor lamp' },
        { from: 'shotmatch', text: 'Added a floor lamp to the set on the left, 5 m from the camera.' },
        { from: 'note', text: 'Nemotron read it as a floor lamp, 0.45 x 0.45 x 1.6 m; TRELLIS built the model in 9.7 s.' },
      ],
    },
  ],
  uses: [
    { name: 'Event stream with a replay cursor', line: 'Every inbound message, voice note and call event arrives over Photon\'s Socket.IO stream; a restarted crew resumes from its saved cursor.', where: 'crew/src/photon.ts (startPhoton), cursor in data/photon.json', status: 'live' },
    { name: 'Per-channel delivery', line: 'One set event becomes an image and a line on iMessage, an album on Telegram, a Markdown email, an SMS link or a WhatsApp image.', where: 'crew/src/channels/format.ts, deliver.ts, fanout.ts', status: 'stand-in' },
    { name: 'Invites by channel', line: 'Invite from the studio or from a text; where Photon cannot message first, the inviter gets the exact text or t.me link to forward.', where: 'crew/src/channels/invite.ts; Studio People panel', status: 'stand-in', img: panel, alt: 'The invite form in Studio\'s People panel' },
    { name: 'Threaded replies fork versions', line: 'parentMessageId on a reply forks the set from that version over SpacetimeDB scene history.', where: 'crew/src/channels/versions.ts; shot_version and restoreToVersion in the module', status: 'stand-in' },
    { name: 'Telegram albums and edits', line: 'Lens options as one album with a caption, and one progress message edited in place while a render runs.', where: 'crew/src/channels/format.ts (Telegram)', status: 'stand-in' },
    { name: 'Voice line over SIP', line: 'An ElevenLabs agent on a Photon number, with guide_me and edit_set tools on the crew, and the framing texted after call.ended.', where: 'crew/src/voice.ts, crew/scripts/setup-voice.ts', status: 'built', detail: 'Waits on a Photon number with a SIP profile pointed at ElevenLabs (crew/PHOTON.md step 5). The ElevenLabs post-call webhook is live and writes transcripts into SpacetimeDB.' },
    { name: 'Check in by photo', line: 'A texted photo is classified, solved against the spot and compared with the shot camera; the reply gives the correction.', where: 'crew/src/channels/photos.ts, marks.ts; checkin table', status: 'stand-in' },
    { name: 'Photo to prop', line: 'A photo of one object becomes a 3D prop through Nemotron and TRELLIS, placed where the reply says.', where: 'crew/src/channels/photos.ts, /api/props/generate', status: 'stand-in' },
    { name: 'Channel fallback on problem codes', line: 'SHARED_LINE_INBOUND_REQUIRED, SPACE_NOT_SENDABLE and SMS_CAMPAIGN_NOT_ELIGIBLE move an alert to the next channel.', where: 'crew/src/channels/alerts.ts', status: 'stand-in' },
    { name: 'Golden-hour alerts', line: 'The module\'s reminder schedule fires 20 minutes before golden hour; the crew writes one message per person with their live distance.', where: 'module reminder schedule, crew/src/channels/alerts.ts', status: 'stand-in' },
    { name: 'Voice notes in', line: 'Telegram and WhatsApp voice notes are transcribed by NVIDIA Parakeet and routed like typed text.', where: 'crew/src/speech.ts, crew/src/photon.ts', status: 'stand-in' },
    { name: 'Idempotency keys and typing indicator', line: 'Every send carries an idempotency key so a restarted crew never sends twice; a typing indicator shows while a render runs.', where: 'crew/src/channels/api.ts', status: 'stand-in' },
  ],
  proof: [
    { value: '29 of 29', label: 'checks in the end-to-end run of all five mechanisms and photo-to-prop', check: 'cd crew && npx tsx scripts/photon-e2e.ts (uses database shotmatch-photon, never production)', standIn: true },
    { value: '66 of 66', label: 'crew unit tests, including per-channel formats, guidance geometry, the version tree and channel order', check: 'cd crew && npm test' },
    { value: 'enabled', label: 'production crew connected to Photon\'s API; no public channel handle yet', check: 'curl https://104-238-146-229.sslip.io/api/photon/status' },
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
    'No public number or bot handle yet: the iMessage, SMS, voice, email and WhatsApp lines need dashboard setup (crew/PHOTON.md), and SMS also needs a 10DLC campaign.',
    'Until then the proof is the stand-in run, not a live round trip.',
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

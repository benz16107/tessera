// HackUTD Virality, our HackUTD track. Numbers from docs/RESEARCH.md (the research thread, read on old.reddit.com at about
// 4 AM CT on Nov 8; points drift); the share link and the Telegram loop are live in production (see the Photon page).
import type { Track } from './types.ts';
import post from '../assets/research/whereisthis.png';
import yours from '../assets/shots/simple-yours-phone.png';
import found from '../assets/shots/simple-found-phone.png';

export default {
  slug: 'virality',
  sponsor: 'HackUTD',
  prize: 'Virality',
  whyTitle: 'Why it spreads',
  splitTitle: 'Tessera and what people do today',
  theirsTitle: 'What people do today',
  order: 4,
  oneLine: 'People already post "where was this photo taken?" and recreate old photos. Tessera answers that post with a link anyone can open, and the shot comes back to the group chat.',
  hero: {
    img: post,
    alt: 'A Reddit post on r/whereisthis with 858 points: Please help a grieving husband find this location, asking for the spot of a 1998 photo so he can sit exactly there. The username is blurred.',
    caption: 'The hook is already on Reddit: "I really want to find this spot so I can return to it, sit exactly there, and remember my soulmate." (r/whereisthis, 858 points)',
    frame: 'none',
  },
  headline: [
    { value: '103 of 1,949', label: 'Reddit posts we read asked where a photo was taken from, which lens made it, or how to recreate it', check: '/docs/research/ and docs/RESEARCH.md' },
    { value: '79', label: 'of those 103 asked for the exact spot', check: 'docs/RESEARCH.md' },
    { value: '858 points', label: 'on the top post, a husband looking for the spot of a 1998 photo', check: 'https://www.reddit.com/r/whereisthis/comments/1wx1wae/' },
  ],
  why: [
    { title: 'The question is already viral', body: 'People post a photo and ask where it was taken, then wait for strangers and AI place-finders to guess. Recreating an old photo is its own genre.' },
    { title: 'Every answer is shareable', body: 'A shoot is one link that opens on any phone, the recreation sits beside the original, and the set answers in the group chat.' },
  ],
  uses: [
    { name: 'One link per shoot', line: 'Share copies the shoot\'s link; whoever opens it lands on the same set in a browser, with no app and no account.', where: 'Simple: Share; /p/<code> on https://app.tesseraphoto.com', status: 'live', img: found, alt: 'Simple on a phone: the answer for the Manhattan Bridge photo, where to stand, the heading and the lens' },
    { name: 'Recreation beside the original', line: 'Make it yours shows the original photo next to your version, an AI render labelled AI interpretation, ready to post.', where: 'Simple: Make it yours', status: 'live', img: yours, alt: 'Simple on a phone: Make it yours, the original photo beside an AI render of two people, labelled AI interpretation' },
    { name: 'The shot comes back to the chat', line: 'Text the Telegram bot a photo and it finds the place; renders arrive in the thread as versions, and replying to one forks the set.', where: 'Telegram bot @ShotMatchSetBot through Photon; crew/src/channels', status: 'live', detail: '9 live round trips on Telegram, from hello to a golden-hour alert, with screenshots on the Photon page.' },
    { name: '10 vertical reels', line: 'Short vertical videos of the app answering "where was this taken?", made for the feeds where the question gets asked.', where: '/reels/', status: 'live' },
  ],
  proof: [
    { value: '103 of 1,949', label: 'Reddit posts we read, across 15 subreddits, asked where a photo was taken from, which lens made it, or how to recreate it', check: '/docs/research/ and docs/RESEARCH.md' },
    { value: '79', label: 'of the 103 asked for the exact spot (22 asked about the lens and 28 how to recreate a shot; a post can ask more than one)', check: 'docs/RESEARCH.md' },
    { value: '858 points', label: 'on the top post (r/whereisthis), read at about 4 AM CT on Nov 8', check: 'https://www.reddit.com/r/whereisthis/comments/1wx1wae/' },
    { value: '9', label: 'live round trips on Telegram, from hello to a golden-hour alert', check: '/tracks/photon/' },
    { value: '10', label: 'vertical reels', check: '/reels/' },
  ],
  ours: [
    'A link per shoot that opens in any browser',
    'The answer: where to stand, which way to face and the lens',
    'A labelled AI render beside the original photo',
    'The set in the Telegram thread, with versions as replies',
  ],
  theirs: [
    'Post the photo and wait for strangers to guess',
    'Reverse image search and Street View by hand',
    'AI place-finders that guess the place, sometimes wrong',
  ],
  limits: [
    'We have not measured how far the reels or share links travel.',
    'The live chat loop today is Telegram; iMessage, SMS and WhatsApp need numbers set up in Photon\'s dashboard.',
    'Reddit points drift; the numbers here were read at about 4 AM CT on Nov 8.',
  ],
  video: { title: '10 vertical reels', length: '10 reels', summary: '', shots: [], notes: '', url: '/reels/' },
  docs: [
    { label: 'The research: 8 posts, how we searched, what we counted', href: '/docs/research/' },
    { label: 'The Telegram loop, live', href: '/tracks/photon/' },
    { label: 'Share and join a shoot', href: '/docs/get-started/' },
  ],
} satisfies Track;

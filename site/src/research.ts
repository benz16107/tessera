// The landing page's research section: Reddit evidence of the problem, from the research thread's docs/RESEARCH.md and
// the page /docs/research/. Quotes are word for word; screenshots (usernames blurred, post photos hidden) are in
// public/research/. Set `research` to null to hide the section.
export type Quote = { text: string; where: string; href: string; shot: string; alt: string };
export type Research = { count: string; line: string; detail: string; quotes: Quote[]; href: string };

export const research: Research | null = {
  count: '103 of 1,949',
  line: 'Reddit posts we read asked where a photo was taken from, which lens made it, or how to recreate it.',
  detail: '79 asked for the exact spot, 22 about the lens and 28 how to recreate a shot, across 15 subreddits.',
  quotes: [
    {
      text: 'I really want to find this spot so I can return to it, sit exactly there, and remember my soulmate.',
      where: 'r/whereisthis, a husband with a photo from 1998',
      href: 'https://www.reddit.com/r/whereisthis/comments/1wx1wae/',
      shot: '/research/1-whereisthis.png',
      alt: 'Reddit post on r/whereisthis, 858 points: Please help a grieving husband find this location, about a photo of his wife from 1998 near Melbourne.',
    },
    {
      text: 'I can\'t nail the cross streets since its been ~50 years.',
      where: 'r/AskNYC, recreating a grandmother\'s graduation photo',
      href: 'https://www.reddit.com/r/AskNYC/comments/18mo1uc/',
      shot: '/research/3-asknyc.png',
      alt: 'Reddit post on r/AskNYC, 37 points: help me find where this photo was taken, about recreating a grandmother\'s FIT graduation photo from the mid 70s.',
    },
    {
      text: 'Golden hour is ideal but will the sun even hit this spot at that time?',
      where: 'r/AskPhotography, a photographer at Jay St in DUMBO',
      href: 'https://www.reddit.com/r/AskPhotography/comments/1u386p6/',
      shot: '/research/8-askphotography.png',
      alt: 'Reddit post on r/AskPhotography: What time of day should I shoot this?, a product photographer planning a shot at Jay St and Prospect St in Brooklyn.',
    },
  ],
  href: '/docs/research/',
};

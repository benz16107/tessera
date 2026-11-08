// The landing page's research section: Reddit evidence of the problem, curated by the research thread
// (~/Code/scratch/shotmatch-problem). Screenshots live in public/research/. While `research` is null the section is
// not rendered.
export type Quote = { text: string; where: string; href: string; shot: string; alt: string };
export type Research = { count: string; line: string; quotes: Quote[]; href: string };

export const research: Research | null = null;

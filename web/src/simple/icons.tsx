// The few line icons Simple uses, drawn here at 1.6 px strokes on a 24 px grid so they match SF Symbols' regular weight.
import type { SVGProps } from 'react';

const P = (props: SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 24 24" width={20} height={20} fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props} />
);

export const Viewfinder = (p: SVGProps<SVGSVGElement>) => <P {...p}><path d="M4 9V5a1 1 0 0 1 1-1h4M15 4h4a1 1 0 0 1 1 1v4M20 15v4a1 1 0 0 1-1 1h-4M9 20H5a1 1 0 0 1-1-1v-4" strokeWidth={2.2} strokeLinecap="square" /></P>;
export const Photo = (p: SVGProps<SVGSVGElement>) => <P {...p}><rect x="3" y="5" width="18" height="14" rx="2.5" /><circle cx="8.5" cy="10" r="1.6" /><path d="m4 17 5-4.5 3.5 3 3-2.5L20 17" /></P>;
export const Link = (p: SVGProps<SVGSVGElement>) => <P {...p}><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" /><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" /></P>;
export const Arrow = (p: SVGProps<SVGSVGElement>) => <svg viewBox="0 0 24 24" width={20} height={20} aria-hidden="true" {...p}><path d="M20.5 3.5 3.6 10.6c-.8.3-.7 1.4.1 1.6l6.7 1.4 1.4 6.7c.2.8 1.3.9 1.6.1z" fill="currentColor" /></svg>;
export const Up = (p: SVGProps<SVGSVGElement>) => <svg viewBox="0 0 24 24" width={20} height={20} aria-hidden="true" {...p}><path d="M12 3 19.5 20 12 15.6 4.5 20z" fill="currentColor" /></svg>;
export const Check = (p: SVGProps<SVGSVGElement>) => <P {...p}><path d="m5 12.5 4.5 4.5L19 7.5" strokeWidth={2.4} /></P>;
export const Turn = (p: SVGProps<SVGSVGElement>) => <P {...p}><path d="M19 12a7 7 0 1 1-2.1-5" /><path d="M17.5 3.5v4h-4" /></P>;
export const Sun = (p: SVGProps<SVGSVGElement>) => <P {...p}><circle cx="12" cy="12" r="4" /><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4" /></P>;
export const Moon = (p: SVGProps<SVGSVGElement>) => <P {...p}><path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z" /></P>;
export const Person = (p: SVGProps<SVGSVGElement>) => <P {...p}><circle cx="12" cy="7" r="3" /><path d="M6 20v-2.5A4.5 4.5 0 0 1 10.5 13h3a4.5 4.5 0 0 1 4.5 4.5V20" /></P>;
export const People = (p: SVGProps<SVGSVGElement>) => <P {...p}><circle cx="9" cy="8" r="2.6" /><circle cx="16.5" cy="9" r="2.2" /><path d="M3.5 19v-1.8A3.7 3.7 0 0 1 7.2 13.5h3.6a3.7 3.7 0 0 1 3.7 3.7V19M15 13.6h1.6a3.4 3.4 0 0 1 3.4 3.4V19" /></P>;
export const Aperture = (p: SVGProps<SVGSVGElement>) => <P {...p}><circle cx="12" cy="12" r="8.5" /><path d="m14.5 4 -5.8 10M20 9.5h-11.5M18 17.5 12.2 7.5M9.5 20l5.8-10M4 14.5h11.5M6 6.5l5.8 10" /></P>;
export const Wide = (p: SVGProps<SVGSVGElement>) => <P {...p}><path d="M3 8V5h3M21 8V5h-3M3 16v3h3M21 16v3h-3" /><rect x="7" y="8.5" width="10" height="7" rx="1.5" /></P>;
export const Mic = (p: SVGProps<SVGSVGElement>) => <P {...p}><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3" /></P>;
export const Send = (p: SVGProps<SVGSVGElement>) => <P {...p}><path d="M12 19V5M6 11l6-6 6 6" strokeWidth={2} /></P>;
export const Share = (p: SVGProps<SVGSVGElement>) => <P {...p}><path d="M12 3v12M7.5 7.5 12 3l4.5 4.5" /><path d="M8 11H6.5A1.5 1.5 0 0 0 5 12.5v6A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5v-6a1.5 1.5 0 0 0-1.5-1.5H16" /></P>;
export const Close = (p: SVGProps<SVGSVGElement>) => <P {...p}><path d="M6 6l12 12M18 6 6 18" strokeWidth={2} /></P>;
export const Spark = (p: SVGProps<SVGSVGElement>) => <P {...p}><path d="M5 19 19 5M14 5h5v5" /></P>;

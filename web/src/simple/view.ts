// Which view a person sees: Simple (phone-first, friendly) or Studio (the pro set editor). Both run in one app shell on one
// SpacetimeDB connection, and App keeps both mounted once opened, so switching changes only the URL: the session, the
// selection and each view's camera carry over without a reload.
export type ViewName = 'simple' | 'studio';

const KEY = 'shotmatch/view';

export function storedView(): ViewName | null {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'simple' || v === 'studio' ? v : null;
  } catch { return null; }
}

export function rememberView(v: ViewName) {
  try { localStorage.setItem(KEY, v); } catch { /* storage blocked: the choice lasts for this page only */ }
}

export const isPhone = () => matchMedia('(max-width: 760px), (hover: none) and (pointer: coarse)').matches;

/** The person's own choice; without one, Simple on phones and for links people were sent, Studio on a desktop. */
export const preferredView = (fromLink: boolean): ViewName => storedView() ?? (fromLink || isPhone() ? 'simple' : 'studio');

export const viewPath = (v: ViewName, code: string) => (v === 'studio' ? `/studio/${code}` : `/p/${code}`);

/** What the view being left hands to the next one. Read once by the view it names. */
export interface Handoff { to: ViewName; code: string; selected: bigint | null }
let pending: Handoff | null = null;

export function handOff(h: Handoff) { pending = h; }

export function takeHandoff(to: ViewName, code: string): Handoff | null {
  if (!pending || pending.to !== to || pending.code !== code) return null;
  const h = pending;
  pending = null;
  return h;
}

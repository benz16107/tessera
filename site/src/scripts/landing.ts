// The landing page's motion. Each animation is the product doing what it does:
//   hero:   scrolling moves the time of day on the demo shoot, as dragging the timeline does in Studio: real frames of
//           Through Cam A from 4:10 to 5:04 PM under the live sun;
//   steps:  one pinned phone walks through the four screens of Simple;
//   camera: the lens buttons switch real viewfinder frames (works without motion too, as a plain swap).
// html.motion is set in the page head only when prefers-reduced-motion is not "reduce". Without it (or without
// JavaScript) the page is a complete static layout: the hero holds golden hour and the steps sit in a row.
// GSAP 3.15.0 with ScrollTrigger; Lenis 1.3.27 is the single smooth-scroll engine, driven by GSAP's ticker.
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import Lenis from 'lenis';
import 'lenis/dist/lenis.css';

const motion = document.documentElement.classList.contains('motion');
const $ = <T extends Element = HTMLElement>(s: string, r: ParentNode = document) => r.querySelector<T>(s);
const $$ = <T extends Element = HTMLElement>(s: string, r: ParentNode = document) => [...r.querySelectorAll<T>(s)];
const HEADER = 48; // the sticky site header (--header-h); pinned sections start below it

camera();

if (motion) {
  gsap.registerPlugin(ScrollTrigger);
  const lenis = new Lenis({ autoRaf: false });
  lenis.on('scroll', ScrollTrigger.update);
  gsap.ticker.add((t) => lenis.raf(t * 1000));
  gsap.ticker.lagSmoothing(0);

  hero();
  steps();

  // Fonts and lazy images change heights after the first measurement.
  document.fonts?.ready.then(() => ScrollTrigger.refresh());
  addEventListener('load', () => ScrollTrigger.refresh());
}

function hero() {
  const root = $('[data-hero]');
  if (!root) return;
  const frames = $$<HTMLImageElement>('.h-frame', root);
  const clock = $('[data-clock]', root), head = $('[data-head]', root);
  if (frames.length < 2 || !clock || !head) return;
  // Each frame's time of day in minutes (data-min); the scrubber spans 4:00 to 5:10 PM, as in the page's markup.
  const mins = frames.map((f) => Number(f.dataset.min));
  const T0 = 16 * 60, T1 = 17 * 60 + 10;
  const label = (m: number) => `${Math.floor(m / 60) - 12}:${String(Math.round(m % 60)).padStart(2, '0')} PM`;
  for (const f of frames) f.loading = 'eager'; // every frame is needed once the scrub starts
  const show = (p: number) => {
    const x = p * (frames.length - 1);
    frames.forEach((f, i) => { f.style.opacity = String(Math.max(0, 1 - Math.abs(i - x))); });
    const i = Math.min(frames.length - 2, Math.floor(x)), t = x - i;
    const m = mins[i] + (mins[i + 1] - mins[i]) * t;
    clock.textContent = label(m);
    head.style.left = `${((m - T0) / (T1 - T0)) * 100}%`;
  };
  show(0);
  ScrollTrigger.create({ trigger: root, start: `top ${HEADER}px`, end: '+=140%', pin: true, scrub: true, onUpdate: (st) => show(st.progress) });
}

function steps() {
  const root = $('[data-steps]');
  if (!root) return;
  const items = $$('.step', root);
  const rail = $$('.steps-rail span', root);
  const mark = (i: number) => rail.forEach((r, j) => r.classList.toggle('on', j <= i));
  mark(0);
  const tl = gsap.timeline({
    defaults: { ease: 'power2.inOut' },
    scrollTrigger: {
      trigger: root, start: `top ${HEADER}px`, end: `+=${(items.length - 1) * 100}%`, pin: true, scrub: true,
      onUpdate: (st) => mark(Math.min(items.length - 1, Math.floor(st.progress * items.length))),
    },
  });
  // Each change holds most of its scroll range on one screen; the phone stays put while its screen and the title change.
  items.forEach((item, i) => {
    if (i === 0) return;
    const at = i - 0.35;
    tl.to(items[i - 1], { opacity: 0, duration: 0.3 }, at)
      .to($('.step-title', items[i - 1]), { y: -16, duration: 0.3 }, at)
      .fromTo(item, { opacity: 0 }, { opacity: 1, duration: 0.3 }, at)
      .fromTo($('.step-title', item), { y: 16 }, { y: 0, duration: 0.3 }, at);
  });
  tl.to({}, { duration: 0.35 });
}

function camera() {
  const root = $('[data-camera]');
  if (!root) return;
  const buttons = $$<HTMLButtonElement>('[data-lens]', root);
  const imgs = $$<HTMLImageElement>('[data-lens-img]', root);
  const note = $('[data-lens-note]', root), readout = $('[data-lens-readout]', root);
  const data = JSON.parse(root.dataset.lenses ?? '{}') as Record<string, { note: string; readout: string }>;
  for (const b of buttons) b.addEventListener('click', () => {
    const key = b.dataset.lens!;
    for (const x of buttons) x.setAttribute('aria-pressed', String(x === b));
    for (const img of imgs) { if (img.dataset.lensImg === key) img.loading = 'eager'; img.style.opacity = img.dataset.lensImg === key ? '1' : '0'; }
    if (data[key] && note && readout) { note.textContent = data[key].note; readout.textContent = `CAM A  ${data[key].readout}`; }
  });
}

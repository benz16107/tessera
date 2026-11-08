// The landing page's motion. Every animation here explains the product:
//   hero:    your photo slides onto the 3D set, lands in the solved camera's frame, then we look through that camera;
//   steps:   one pinned phone walks through the four screens of Simple;
//   views:   Studio wipes in over Simple on the same window (also a real toggle);
//   numbers: count up once.
// html.motion is set in the page head only when prefers-reduced-motion is not "reduce". Without it (or without
// JavaScript) the page is a complete static layout and only the toggle runs, without the wipe.
// GSAP 3.15.0 with ScrollTrigger; Lenis 1.3.27 is the single smooth-scroll engine, driven by GSAP's ticker.
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import Lenis from 'lenis';
import 'lenis/dist/lenis.css';

const motion = document.documentElement.classList.contains('motion');
const $ = <T extends Element = HTMLElement>(s: string, r: ParentNode = document) => r.querySelector<T>(s);
const $$ = <T extends Element = HTMLElement>(s: string, r: ParentNode = document) => [...r.querySelectorAll<T>(s)];
const HEADER = 56; // the sticky site header; pinned sections start below it

// Simple and Studio toggle: works everywhere, animates only with motion.
const views = $('[data-views]');
let touched = false;
function show(view: 'simple' | 'studio', animate: boolean) {
  if (!views) return;
  views.dataset.show = view;
  for (const b of $$<HTMLButtonElement>('.seg-btn', views)) b.setAttribute('aria-pressed', String(b.dataset.view === view));
  const studio = $('.v-studio', views);
  if (!studio) return;
  if (!motion || !animate) { gsap.set(studio, { clearProps: 'clipPath' }); return; }
  const open = 'inset(0% 0% 0% 0%)', closed = 'inset(0% 0% 0% 100%)';
  gsap.to(studio, { clipPath: view === 'studio' ? open : closed, duration: 0.7, ease: 'power3.inOut', overwrite: true });
}
for (const b of $$<HTMLButtonElement>('.seg-btn')) b.addEventListener('click', () => { touched = true; show(b.dataset.view as 'simple' | 'studio', true); });

if (motion) {
  gsap.registerPlugin(ScrollTrigger);
  const lenis = new Lenis({ autoRaf: false });
  lenis.on('scroll', ScrollTrigger.update);
  gsap.ticker.add((t) => lenis.raf(t * 1000));
  gsap.ticker.lagSmoothing(0);

  hero();
  steps();
  numbers();
  if (views) {
    gsap.set($('.v-studio', views), { clipPath: 'inset(0% 0% 0% 100%)' });
    ScrollTrigger.create({ trigger: views, start: 'top 55%', once: true, onEnter: () => gsap.delayedCall(0.6, () => { if (!touched) show('studio', true); }) });
  }

  // Fonts and lazy images change heights after the first measurement.
  document.fonts?.ready.then(() => ScrollTrigger.refresh());
  addEventListener('load', () => ScrollTrigger.refresh());
}

function hero() {
  const root = $('[data-hero]');
  if (!root) return;
  const tl = gsap.timeline({
    defaults: { ease: 'none' },
    scrollTrigger: { trigger: root, start: `top ${HEADER}px`, end: '+=200%', pin: true, scrub: true },
  });
  // 0 to 0.4: the photo, held up in front of the dim set, moves into the solved camera's frame.
  // Start values match the CSS: on narrow screens the window is zoomed 1.6x around Cam A, so the photo starts smaller.
  const narrow = matchMedia('(max-width: 900px)').matches;
  const start = narrow ? { xPercent: 9.7, yPercent: 5.5, scale: 2.6 } : { xPercent: 15.5, yPercent: 8.7, scale: 4.2 };
  tl.fromTo('.h-card', { ...start, rotation: -3 }, { xPercent: 0, yPercent: 0, scale: 1, rotation: 0, duration: 0.4, ease: 'power3.inOut' }, 0)
    .fromTo('.h-world', { opacity: 0.35 }, { opacity: 1, duration: 0.4 }, 0)
    .to('.card-chip', { opacity: 0, duration: 0.08 }, 0.3)
    // 0.4 to 0.6: the camera's rays draw out to the photo, and the answer appears.
    .fromTo('.h-frustum .ray', { strokeDashoffset: 1 }, { strokeDashoffset: 0, duration: 0.12, stagger: 0.02 }, 0.4)
    .fromTo('.h-frustum .plane', { strokeDashoffset: 1 }, { strokeDashoffset: 0, duration: 0.1 }, 0.42)
    .fromTo('.readout', { opacity: 0, y: 6 }, { opacity: 1, y: 0, duration: 0.08, ease: 'power2.out' }, 0.52)
    // 0.7 to 0.9: look through that camera. The set gives way to the view from Cam A.
    .fromTo('.h-cam', { opacity: 0, scale: 1.12, transformOrigin: '48.5% 48.3%' }, { opacity: 1, scale: 1, duration: 0.2, ease: 'power2.out' }, 0.7)
    .to(['.h-frustum', '.readout', '.h-card'], { opacity: 0, duration: 0.1 }, 0.7)
    .fromTo('.cam-chip', { opacity: 0 }, { opacity: 1, duration: 0.06 }, 0.86)
    .to({}, { duration: 0.1 }); // a short hold on the camera view before the page moves on
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

function numbers() {
  const root = $('[data-numbers]');
  if (!root) return;
  const els = $$<HTMLElement>('[data-count]', root);
  for (const el of els) el.textContent = '0';
  ScrollTrigger.create({
    trigger: root, start: 'top 80%', once: true,
    onEnter: () => els.forEach((el) => {
      const to = Number(el.dataset.count), v = { n: 0 };
      gsap.to(v, { n: to, duration: 1.2, ease: 'power2.out', onUpdate: () => { el.textContent = String(Math.round(v.n)); } });
    }),
  });
}

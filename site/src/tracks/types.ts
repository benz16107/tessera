// The shape every track page is written in. One file per track in this folder; src/pages/tracks/[slug].astro renders it.
// Rules: every number is measured and says how to check it; "stand-in" marks proof that ran against a stand-in; no fake
// people or quotes. Images are real screenshots (src/assets/shots) or crops of them (src/assets/cards).
import type { ImageMetadata } from 'astro';

export type Status = 'live' | 'built' | 'stand-in' | 'blocked';

export interface Use {
  name: string; // feature name, a few words
  line: string; // one sentence: what it does for the user
  where: string; // where it lives: code path, screen, or service
  status: Status; // live = runs in production now; built = in code, not exercised live; stand-in = proven against a stand-in
  img?: ImageMetadata; // a real screenshot or crop; omit rather than invent one
  alt?: string;
  detail?: string; // optional longer note, shown behind an expander
}

export interface Proof {
  value: string; // the measured number, e.g. "900 of 900"
  label: string; // what it measures, one line
  check: string; // exactly how to check it: a command, a URL or a file
  standIn?: boolean;
}

export interface Shot { t: string; screen: string; say: string; criterion: string }

export interface Message { from: 'person' | 'shotmatch' | 'note'; text: string; img?: ImageMetadata; meta?: string }
export interface Thread {
  mechanism: string; // e.g. "1. One live set, everyone on their own channel"
  channel: 'iMessage' | 'Telegram' | 'Email' | 'Phone call' | 'SMS' | 'WhatsApp';
  why: string; // one sentence: why this needs messaging
  messages: Message[];
  source: string; // where the text comes from, e.g. "crew/scripts/photon-e2e.ts against the Photon stand-in"
}

export interface Track {
  slug: string;
  sponsor: string; // "NVIDIA"
  prize: string; // the track as the sponsor names it
  order: number;
  oneLine: string; // "What we built for <sponsor>", one sentence
  hero: { img: ImageMetadata; alt: string; caption: string; frame: 'browser' | 'phone' | 'none'; url?: string };
  headline: Proof[]; // two to four numbers shown under the hero (a subset of proof is fine)
  why: { title: string; body: string }[]; // two to four reasons, each tied to the track's criteria
  uses: Use[];
  threads?: Thread[]; // Photon only: the mechanisms as real message threads
  proof: Proof[];
  ours: string[]; // what ShotMatch built
  theirs: string[]; // what the sponsor's product does
  limits: string[];
  video: { title: string; length: string; summary: string; shots: Shot[]; notes: string; url?: string };
  docs: { label: string; href: string }[];
  note?: string; // one honest status line shown near the top, e.g. stand-in proof
  whyTitle?: string; // heading overrides for tracks without a product sponsor (Best Design)
  theirsTitle?: string;
  splitTitle?: string;
}

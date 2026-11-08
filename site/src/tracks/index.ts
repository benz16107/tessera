// Every track file in this folder, in page order. A track is listed once its file exists.
import type { Track } from './types.ts';

const mods = import.meta.glob<{ default: Track }>('./*.ts', { eager: true });
export const TRACKS: Track[] = Object.entries(mods)
  .filter(([path]) => !/\/(types|index)\.ts$/.test(path))
  .map(([, m]) => m.default)
  .sort((a, b) => a.order - b.order);

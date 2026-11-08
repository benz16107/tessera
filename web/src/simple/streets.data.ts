// The street corners stored with each spot (spots/<id>/streets.json), bundled at build time like the studio's geometry.
import type { Streets } from './street.ts';

const FILES = import.meta.glob('../../../spots/*/streets.json', { eager: true, import: 'default' }) as Record<string, Streets>;
export const streetsFor = (spotId: string) => Object.entries(FILES).find(([p]) => p.includes(`/spots/${spotId}/`))?.[1];

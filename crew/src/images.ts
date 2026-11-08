import sharp from 'sharp';
import exifr from 'exifr';
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, basename } from 'node:path';
import { PHOTOS_DIR, PREVIEWS_DIR, loadSpots } from './config.ts';
import { nearestSpot } from './geo.ts';

export const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/heic', 'image/heif', 'image/webp'];

const isHeic = (b: Buffer) => b.length > 12 && b.toString('ascii', 4, 8) === 'ftyp' && /hei|mif1|msf1|hev/.test(b.toString('ascii', 8, 12));

/** Our own file name for a /photo/ or /preview/ URL; null for anything else, so paths never escape the data dirs. */
export function localPath(url: string): string | null {
  const m = /^\/(photo|preview)\/([A-Za-z0-9_-]+\.(?:jpg|png))$/.exec(url);
  return m ? join(m[1] === 'photo' ? PHOTOS_DIR : PREVIEWS_DIR, m[2]) : null;
}

export type Ingested = {
  url: string; path: string; width: number; height: number; thumb: string;
  exifF35: number | null; gpsLat: number | null; gpsLon: number | null; nearestSpot: string | null;
};

/** HEIC to JPEG, EXIF rotation applied, long side capped at 2048, EXIF stripped from the stored file. */
export async function ingest(buf: Buffer): Promise<Ingested> {
  const exif = await exifr.parse(buf, { gps: true, pick: ['FocalLengthIn35mmFormat', 'DigitalZoomRatio', 'latitude', 'longitude', 'GPSLatitude', 'GPSLongitude', 'GPSLatitudeRef', 'GPSLongitudeRef'] }).catch(() => null);
  let src = buf;
  if (isHeic(buf)) {
    // The prebuilt sharp on this box reads AVIF but not HEVC HEIC, so convert first.
    const { default: convert } = await import('heic-convert');
    src = Buffer.from(await convert({ buffer: buf, format: 'JPEG', quality: 0.92 }));
  }
  const id = randomUUID().replace(/-/g, '').slice(0, 16);
  mkdirSync(PHOTOS_DIR, { recursive: true });
  const path = join(PHOTOS_DIR, `${id}.jpg`);
  // libheif applies HEIC's own rotation box while decoding; rotate() handles JPEG/PNG EXIF orientation.
  const { data, info } = await sharp(src, { failOn: 'error' }).rotate().resize({ width: 2048, height: 2048, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 90 }).toBuffer({ resolveWithObject: true });
  writeFileSync(path, data);

  let thumb = '';
  for (const q of [70, 55, 40, 25]) {
    const t = await sharp(data).resize({ width: 320, height: 320, fit: 'inside' }).jpeg({ quality: q }).toBuffer();
    thumb = `data:image/jpeg;base64,${t.toString('base64')}`;
    if (t.length < 40_000) break;
  }

  const f35 = Number(exif?.FocalLengthIn35mmFormat) || null;
  const zoom = Number(exif?.DigitalZoomRatio);
  const exifF35 = f35 ? Math.round(f35 * (zoom > 1 ? zoom : 1) * 10) / 10 : null;
  const gpsLat = Number.isFinite(exif?.latitude) ? exif.latitude : null;
  const gpsLon = Number.isFinite(exif?.longitude) ? exif.longitude : null;
  const near = gpsLat !== null && gpsLon !== null ? nearestSpot(loadSpots(), gpsLat, gpsLon) : null;
  return { url: `/photo/${basename(path)}`, path, width: info.width, height: info.height, thumb, exifF35, gpsLat, gpsLon, nearestSpot: near?.id ?? null };
}

/** A JPEG data URL small enough for inline vision-model requests. */
export async function dataUrl(path: string, long = 768): Promise<string> {
  const b = await sharp(path).resize({ width: long, height: long, fit: 'inside' }).jpeg({ quality: 80 }).toBuffer();
  return `data:image/jpeg;base64,${b.toString('base64')}`;
}

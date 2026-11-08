import sharp from 'sharp';
import exifr from 'exifr';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, basename, dirname } from 'node:path';
import { PHOTOS_DIR, PREVIEWS_DIR, loadSpots } from './config.ts';
import { nearestSpot } from './geo.ts';
import { deleteObject, getObject, putObject } from './s3.ts';

export const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/heic', 'image/heif', 'image/webp'];

const isHeic = (b: Buffer) => b.length > 12 && b.toString('ascii', 4, 8) === 'ftyp' && /hei|mif1|msf1|hev/.test(b.toString('ascii', 8, 12));

/** Our own file name for a /photo/ or /preview/ URL; null for anything else, so paths never escape the data dirs. */
export function localPath(url: string): string | null {
  const m = /^\/(photo|preview)\/([A-Za-z0-9_-]+\.(?:jpg|png))$/.exec(url);
  return m ? join(m[1] === 'photo' ? PHOTOS_DIR : PREVIEWS_DIR, m[2]) : null;
}

/** Writes a stored image to disk and to the bucket. A bucket failure is logged, not thrown: the disk copy still serves. */
export async function saveImage(url: string, file: string, data: Buffer) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, data);
  await putObject(url.slice(1), data, 'image/jpeg').catch(e => console.warn(`${(e as Error).message}; kept on disk only`));
}

/** The disk copy of a stored image, pulled from the bucket when this box lacks it (another crew box saved it). Null if neither has it. */
export async function ensureLocal(url: string, file = localPath(url)): Promise<string | null> {
  if (!file) return null;
  if (existsSync(file)) return file;
  const data = await getObject(url.slice(1)).catch(e => { console.warn((e as Error).message); return null; });
  if (!data) return null;
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, data);
  return file;
}

/** Deletes a stored image from disk and from the bucket (refused uploads keep no copy anywhere). */
export async function forget(url: string) {
  const file = localPath(url);
  if (file) rmSync(file, { force: true });
  await deleteObject(url.slice(1)).catch(e => console.warn((e as Error).message));
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
  const path = join(PHOTOS_DIR, `${id}.jpg`);
  // libheif applies HEIC's own rotation box while decoding; rotate() handles JPEG/PNG EXIF orientation.
  const { data, info } = await sharp(src, { failOn: 'error' }).rotate().resize({ width: 2048, height: 2048, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 90 }).toBuffer({ resolveWithObject: true });
  await saveImage(`/photo/${id}.jpg`, path, data);

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

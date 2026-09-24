import { contentId } from '../core/mapName';
import { readKmz } from './KmzReader';
import { writeKmz } from './KmzWriter';

// Shared maps are public files at MAPS_URL/m/<id>.kmz: Vercel Blob today (the URL is derived at
// build time, see vite.config.ts). To self-host, set MAPS_URL to your server and replace the
// upload() call below with a plain PUT/POST to it (and drop api/upload.ts).
export const sharingEnabled = __MAPS_URL__ !== '';
export const sharedKmzUrl = (id: string) => `${__MAPS_URL__}m/${id}.kmz`;
export const isSharedId = (id: string) => /^[a-hj-km-np-z2-9]{8}$/.test(id);

const KMZ_TYPE = 'application/vnd.google-earth.kmz';
const MAX_SHARE_BYTES = 3 * 1024 * 1024; // enforced by api/upload.ts; checked here for a clear message

// Uploads a map (made smaller first) and returns its short id.
export async function publishKmz(kmz: Blob): Promise<string> {
  const small = await shrinkForSharing(kmz);
  if (small.size > MAX_SHARE_BYTES) throw new Error('the map is too large to share as a link');
  const id = await contentId(await small.arrayBuffer());
  const existing = await fetch(sharedKmzUrl(id), { method: 'HEAD' }).catch(() => undefined);
  if (existing?.ok) return id; // shared before: same bytes, same link, no upload
  const { upload } = await import('@vercel/blob/client');
  await upload(`m/${id}.kmz`, small, { access: 'public', handleUploadUrl: 'api/upload', contentType: KMZ_TYPE });
  return id;
}

// Phone photos make multi-megabyte maps; a 2560 px JPEG is plenty on a phone screen and keeps
// shared maps (storage, downloads) within the free tier. The saved map itself is untouched.
const MAX_EDGE = 2560;
const SMALL_ENOUGH = 1024 * 1024;

export async function shrinkForSharing(kmz: Blob): Promise<Blob> {
  if (kmz.size <= SMALL_ENOUGH) return kmz;
  const map = await readKmz(kmz);
  const scale = Math.min(1, MAX_EDGE / Math.max(map.imageWidth, map.imageHeight));
  const width = Math.round(map.imageWidth * scale), height = Math.round(map.imageHeight * scale);
  const canvas = new OffscreenCanvas(width, height);
  canvas.getContext('2d')!.drawImage(await createImageBitmap(map.imageBlob), 0, 0, width, height);
  return writeKmz({
    name: map.name,
    imageBlob: await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.8 }),
    imageFilename: map.imageFilename.replace(/\.[^./]+$/, '') + '.jpg',
    imageWidth: width,
    imageHeight: height,
    tiepoints: map.tiepoints.map((t) => ({
      ...t, xPixel: t.xPixel * (width / map.imageWidth), yPixel: t.yPixel * (height / map.imageHeight),
    })),
  });
}

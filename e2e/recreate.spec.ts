import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import JSZip from 'jszip';

// A real map, made with an earlier version of the app (shared as /m/5jeztgt6): the Beit Berl
// campus orientation map. This test rebuilds it from scratch with the current wizard — same
// image, same two tiepoints — and checks the result matches, so every new version can still make it.
const FIXTURE = readFileSync(new URL('./fixtures/beit-berl.kmz', import.meta.url));
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGP8z8DAwMDAxMDAwMDAAAANHQEDasKb6QAAAABJRU5ErkJggg==',
  'base64',
);

type Tiepoint = { x: number; y: number; lat: number; lon: number };

async function readMap(kmz: Buffer): Promise<{ name: string; tiepoints: Tiepoint[]; image?: { file: string; bytes: Buffer } }> {
  const zip = await JSZip.loadAsync(kmz);
  const kml = await zip.file(/\.kml$/)[0].async('string');
  const name = kml.match(/<name>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/name>/)![1];
  const tiepoints = [...kml.matchAll(/<tie:image>([\d.]+),([\d.]+)<\/tie:image>\s*<tie:geo>([-\d.]+),([-\d.]+)<\/tie:geo>/g)]
    .map(([, x, y, lon, lat]) => ({ x: +x, y: +y, lat: +lat, lon: +lon }));
  const href = kml.match(/<href>(.*?)<\/href>/)![1];
  const imageFile = zip.file(href);
  return { name, tiepoints, image: imageFile ? { file: href, bytes: await imageFile.async('nodebuffer') } : undefined };
}

// Web Mercator world pixels at a zoom level, as Leaflet places them
function worldPx(lat: number, lon: number, zoom: number): { x: number; y: number } {
  const size = 256 * 2 ** zoom;
  const s = Math.sin((lat * Math.PI) / 180);
  return { x: ((lon + 180) / 360) * size, y: (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * size };
}

const metres = (a: Tiepoint, b: Tiepoint) => Math.hypot(
  (a.lat - b.lat) * 111_320, (a.lon - b.lon) * 111_320 * Math.cos((a.lat * Math.PI) / 180));

test('a real map can be recreated from scratch with the current wizard', async ({ page }) => {
  const original = await readMap(FIXTURE);
  expect(original.tiepoints).toHaveLength(2);
  const { width, height } = await page.evaluate(async (b64) => {
    const img = new Image();
    img.src = `data:image/jpeg;base64,${b64}`;
    await img.decode();
    return { width: img.naturalWidth, height: img.naturalHeight };
  }, original.image!.bytes.toString('base64'));

  // The map picker opens between the two tiepoints, zoomed in enough to tap both precisely
  const view = {
    lat: (original.tiepoints[0].lat + original.tiepoints[1].lat) / 2,
    lon: (original.tiepoints[0].lon + original.tiepoints[1].lon) / 2,
    zoom: 16,
  };
  await page.addInitScript((v) => localStorage.setItem('cm.editorView', JSON.stringify(v)), view);
  await page.route('https://tile.openstreetmap.org/**', (r) => r.fulfill({ contentType: 'image/png', body: PNG }));
  // Capture the .kmz that reaches the share sheet
  await page.addInitScript(() => {
    navigator.canShare = () => true;
    navigator.share = async (data) => {
      (window as unknown as { kmz: number[] }).kmz = [...new Uint8Array(await data!.files![0].arrayBuffer())];
    };
  });
  await page.goto('/');

  await page.getByRole('button', { name: 'Create map' }).click();
  await page.locator('#cm-img-input').setInputFiles({ name: original.image!.file, mimeType: 'image/jpeg', buffer: original.image!.bytes });
  await expect(page.locator('#cm-leaflet.leaflet-container')).toBeVisible();

  let imageScale = 0;
  for (const tp of original.tiepoints) {
    imageScale = await tapImagePixel(page, tp, width, height);
    await tapMapSpot(page, tp, view.zoom);
    await page.getByRole('button', { name: 'Confirm' }).click();
  }
  await page.getByRole('textbox', { name: 'Map name' }).fill(original.name);
  await page.getByRole('button', { name: 'Save map' }).click();

  await page.getByRole('button', { name: `More actions for ${original.name}` }).click();
  await page.getByRole('menuitem', { name: 'Share file' }).click();
  await expect.poll(() => page.evaluate(() => 'kmz' in window)).toBe(true);
  const recreated = await readMap(Buffer.from(await page.evaluate(() => (window as unknown as { kmz: number[] }).kmz)));

  expect(recreated.name).toBe(original.name);
  expect(recreated.image?.bytes.equals(original.image!.bytes)).toBe(true);
  expect(recreated.tiepoints).toHaveLength(2);
  // A tap is only as precise as a screen pixel (WebKit rounds to whole ones), so allow 1.5 of them:
  // ~7 image pixels on the fitted image, ~3 m on the map at zoom 16
  const metresPerScreenPx = (156_543 * Math.cos((view.lat * Math.PI) / 180)) / 2 ** view.zoom;
  recreated.tiepoints.forEach((tp, i) => {
    const want = original.tiepoints[i];
    expect(Math.hypot(tp.x - want.x, tp.y - want.y), `tiepoint ${i + 1} image pixels`).toBeLessThan(1.5 / imageScale);
    expect(metres(tp, want), `tiepoint ${i + 1} metres`).toBeLessThan(1.5 * metresPerScreenPx);
  });
});

// The image starts fitted to the canvas at 90% (ImagePointPicker.fitImage)
async function tapImagePixel(page: Page, tp: Tiepoint, w: number, h: number): Promise<number> {
  const box = (await page.locator('#cm-canvas').boundingBox())!;
  const cw = Math.round(box.width), ch = Math.round(box.height);
  const scale = Math.min(cw / w, ch / h) * 0.9;
  await page.mouse.click(box.x + (cw - w * scale) / 2 + tp.x * scale, box.y + (ch - h * scale) / 2 + tp.y * scale);
  return scale;
}

// Where Leaflet actually drew a tile tells exactly where every world pixel is on screen
async function tapMapSpot(page: Page, tp: Tiepoint, zoom: number): Promise<void> {
  const tile = page.locator('#cm-leaflet img.leaflet-tile-loaded').first();
  const [z, x, y] = new URL((await tile.getAttribute('src'))!).pathname.slice(1).replace('.png', '').split('/').map(Number);
  expect(z).toBe(zoom);
  const box = (await tile.boundingBox())!;
  const p = worldPx(tp.lat, tp.lon, zoom);
  await page.mouse.click(box.x + p.x - x * 256, box.y + p.y - y * 256);
}

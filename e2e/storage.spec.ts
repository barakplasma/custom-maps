import { expect, test } from '@playwright/test';
import JSZip from 'jszip';

// Saved data the app can't trust: garbage, storage that refuses access, and files that can no
// longer be read.
const KMZ_TYPE = 'application/vnd.google-earth.kmz';
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGP8z8DAwMDAxMDAwMDAAAANHQEDasKb6QAAAABJRU5ErkJggg==',
  'base64',
);

async function kmz(): Promise<Buffer> {
  const zip = new JSZip();
  zip.file('doc.kml', `<kml xmlns="http://www.opengis.net/kml/2.2"><GroundOverlay>
    <name>Trail</name><Icon><href>map.png</href></Icon>
    <ExtendedData xmlns:tie="urn:tiepoints">
      <tie:tiepoint><tie:image>0,0</tie:image><tie:geo>34.75,32.10</tie:geo></tie:tiepoint>
      <tie:tiepoint><tie:image>2,2</tie:image><tie:geo>34.80,32.05</tie:geo></tie:tiepoint>
    </ExtendedData></GroundOverlay></kml>`);
  zip.file('map.png', PNG);
  return zip.generateAsync({ type: 'nodebuffer' });
}

test.beforeEach(async ({ page }) => {
  await page.route('https://tile.openstreetmap.org/**', (r) => r.fulfill({ contentType: 'image/png', body: PNG }));
});

for (const [label, saved] of [
  ['garbage', 'not json'],
  ['missing fields', '{"lat":1}'],
  ['non-numbers', '{"lat":"1","lon":2,"zoom":3}'],
  ['an impossible latitude', '{"lat":123,"lon":2,"zoom":3}'],
]) {
  test(`a saved map-picker view with ${label} is ignored: the picker opens on the world`, async ({ page }) => {
    const zooms = new Set<string>();
    await page.route('https://tile.openstreetmap.org/**', (r) => {
      zooms.add(new URL(r.request().url()).pathname.split('/')[1]);
      return r.fulfill({ contentType: 'image/png', body: PNG });
    });
    await page.addInitScript((v) => localStorage.setItem('cm.editorView', v), saved);
    await page.goto('/');
    await page.getByRole('button', { name: 'Create map' }).click();
    await page.locator('#cm-img-input').setInputFiles({ name: 'trail.png', mimeType: 'image/png', buffer: PNG });
    await expect.poll(() => [...zooms]).toEqual(['2']); // the world view, not the saved zoom 3
  });
}

test('works when the browser blocks localStorage', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', { get() { throw new DOMException('blocked', 'SecurityError'); } });
  });
  await page.goto('/');
  await page.locator('#cm-file-input').setInputFiles({ name: 'trail.kmz', mimeType: KMZ_TYPE, buffer: await kmz() });
  // The map view reads the overlay opacity preference; the editor reads and writes its last view
  await expect(page.locator('.leaflet-overlay-pane img')).toHaveCSS('opacity', '0.75');
  await page.getByRole('button', { name: 'Back to maps' }).click();
  await page.getByRole('button', { name: 'Create map' }).click();
  await page.locator('#cm-img-input').setInputFiles({ name: 'trail.png', mimeType: 'image/png', buffer: PNG });
  await expect(page.locator('#cm-leaflet .leaflet-tile-loaded').first()).toBeVisible();
  expect(errors).toEqual([]);
});

test('a file that can no longer be read is reported when picked, not later', async ({ page }) => {
  // What Android does when access to a picked gallery/cloud file is revoked
  await page.addInitScript(() => {
    File.prototype.arrayBuffer = () => Promise.reject(new DOMException('The requested file could not be read', 'NotReadableError'));
  });
  await page.goto('/');
  await page.locator('#cm-file-input').setInputFiles({ name: 'trail.kmz', mimeType: KMZ_TYPE, buffer: await kmz() });
  await expect(page.locator('wa-toast-item', { hasText: 'Could not read that file: The requested file could not be read' })).toBeVisible();
});

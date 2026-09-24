import { expect, test, type Page } from '@playwright/test';
import JSZip from 'jszip';

// 2×2 PNG used as the map image and as stub OSM tiles.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGP8z8DAwMDAxMDAwMDAAAANHQEDasKb6QAAAABJRU5ErkJggg==',
  'base64',
);

// A map photographed at an angle: the image diagonal points due east, so the image is
// rotated 45° on the map and drawn by the custom rotated-image layer.
async function rotatedKmz(): Promise<Buffer> {
  const zip = new JSZip();
  zip.file('doc.kml', `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2"><GroundOverlay>
  <name>Rotated</name><Icon><href>map.png</href></Icon>
  <ExtendedData xmlns:tie="urn:tiepoints">
    <tie:tiepoint><tie:image>0,0</tie:image><tie:geo>34.7800,32.0800</tie:geo></tie:tiepoint>
    <tie:tiepoint><tie:image>2,2</tie:image><tie:geo>34.7900,32.0800</tie:geo></tie:tiepoint>
  </ExtendedData>
</GroundOverlay></kml>`);
  zip.file('map.png', PNG);
  return zip.generateAsync({ type: 'nodebuffer' });
}

async function openRotatedMap(page: Page) {
  await page.route('https://tile.openstreetmap.org/**', (r) => r.fulfill({ contentType: 'image/png', body: PNG }));
  await page.goto('/');
  await page.locator('#cm-file-input').setInputFiles({ name: 'rotated.kmz', mimeType: 'application/vnd.google-earth.kmz', buffer: await rotatedKmz() });
  const img = page.locator('.leaflet-overlay-pane img');
  await expect(img).toBeVisible();
  return img;
}

test('a rotated map image is drawn as a square, not squashed or mirrored', async ({ page }) => {
  const img = await openRotatedMap(page);
  // Not collapsed by the global img { max-width: 100% } reset inside Leaflet's 0×0 pane
  expect(await img.evaluate((el: HTMLImageElement) => el.offsetWidth)).toBe(2);
  const box = (await img.boundingBox())!;
  // A square image rotated 45° has a square bounding box
  expect(box.width).toBeGreaterThan(50);
  expect(Math.abs(box.width - box.height)).toBeLessThan(2);
});

test('the map image stays attached to the map while panning', async ({ page }) => {
  const img = await openRotatedMap(page);
  await page.waitForTimeout(500); // let fitBounds settle
  // The map pane's translation is how far the map itself moved (including inertia after release)
  const mapOffset = () => page.locator('.leaflet-map-pane').evaluate((el) => {
    const m = new DOMMatrix(getComputedStyle(el).transform);
    return { x: m.m41, y: m.m42 };
  });
  const before = { img: (await img.boundingBox())!, map: await mapOffset() };
  const box = (await page.locator('.leaflet-container').boundingBox())!;
  const start = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x - 60, start.y - 50, { steps: 6 });
  await page.mouse.up();
  // Compare once the map has come to rest (inertia keeps it gliding after release)
  await expect.poll(async () => {
    const after = { img: (await img.boundingBox())!, map: await mapOffset() };
    const mapMoved = { x: after.map.x - before.map.x, y: after.map.y - before.map.y };
    const imgMoved = { x: after.img.x - before.img.x, y: after.img.y - before.img.y };
    return {
      mapMoved: Math.hypot(mapMoved.x, mapMoved.y) > 30,
      imageFollowed: Math.abs(imgMoved.x - mapMoved.x) < 1 && Math.abs(imgMoved.y - mapMoved.y) < 1,
    };
  }, { timeout: 8000 }).toEqual({ mapMoved: true, imageFollowed: true });
});

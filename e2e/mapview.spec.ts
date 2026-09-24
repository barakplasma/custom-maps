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

// Opens the rotated map; stub OSM tiles are served and their z/x/y recorded into `tiles`.
async function openRotatedMap(page: Page, tiles: string[] = []) {
  await page.route('https://tile.openstreetmap.org/**', (r) => {
    tiles.push(new URL(r.request().url()).pathname.slice(1).replace('.png', ''));
    return r.fulfill({ contentType: 'image/png', body: PNG });
  });
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

test.describe('navigating with a map', () => {
  const HERE = { latitude: 32.08, longitude: 34.785 };
  test.use({ geolocation: HERE, permissions: ['geolocation'] });

  test('shows a compass heading on the location dot', async ({ page, browserName }) => {
    const ios = browserName === 'webkit';
    // iOS (and Chrome 153+) ask for compass permission on the tap; the test grants it
    await page.addInitScript(() => {
      (DeviceOrientationEvent as unknown as { requestPermission: () => Promise<string> }).requestPermission =
        () => Promise.resolve('granted');
    });
    await openRotatedMap(page);
    await page.getByRole('button', { name: 'Show my location' }).click();
    // Android Chrome: absolute alpha via deviceorientationabsolute. iOS: webkitCompassHeading.
    await expect(async () => {
      await page.evaluate((isIos) => window.dispatchEvent(isIos
        ? Object.assign(new Event('deviceorientation'), { alpha: 0, webkitCompassHeading: 60, webkitCompassAccuracy: 10 })
        : Object.assign(new Event('deviceorientationabsolute'), { alpha: 300, beta: 0, gamma: 0, absolute: true })), ios);
      await expect(page.locator('.leaflet-control-locate-heading')).toBeAttached({ timeout: 500 });
    }).toPass();
  });

  test('keeps following the user as they walk', async ({ page, context }) => {
    const tiles: string[] = [];
    await openRotatedMap(page, tiles);
    await page.getByRole('button', { name: 'Show my location' }).click();
    await page.waitForTimeout(1000);

    // Walk ~2 km north-east: the map must follow (at whatever zoom it is) without any tap
    tiles.length = 0;
    const there = { latitude: 32.095, longitude: 34.80 };
    await context.setGeolocation(there);
    const tileAt = (z: number) => {
      const n = 2 ** z, rad = (there.latitude * Math.PI) / 180;
      return `${z}/${Math.floor(((there.longitude + 180) / 360) * n)}/${Math.floor(((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * n)}`;
    };
    await expect.poll(() => tiles.some((t) => t === tileAt(Number(t.split('/')[0]))), { timeout: 10_000 }).toBe(true);
    await expect(page.locator('.leaflet-control-locate')).toHaveClass(/following/);
  });

  test('map image transparency can be adjusted and is remembered', async ({ page }) => {
    const img = await openRotatedMap(page);
    await expect(img).toHaveCSS('opacity', '0.75');
    await page.getByRole('button', { name: 'Map image transparency' }).click();
    const slider = page.getByRole('slider', { name: 'Map image opacity' });
    await slider.focus();
    for (let i = 0; i < 5; i++) await slider.press('ArrowLeft'); // 5 × 0.05
    await expect(img).toHaveCSS('opacity', '0.5');
    await page.keyboard.press('Escape');

    await page.reload();
    await page.getByRole('button', { name: 'Rotated', exact: true }).click();
    await expect(page.locator('.leaflet-overlay-pane img')).toHaveCSS('opacity', '0.5');
  });
});

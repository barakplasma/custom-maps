import { expect, test, type Page } from '@playwright/test';

// 2×2 PNG: enough to act as the map image and as stub map tiles.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGP8z8DAwMDAxMDAwMDAAAANHQEDasKb6QAAAABJRU5ErkJggg==',
  'base64',
);

const HERE = { latitude: 32.0809, longitude: 34.7806 }; // Tel Aviv
const SAVED = { lat: 48.8584, lon: 2.2945, zoom: 15 }; // Paris

// OSM slippy-map tile containing a coordinate at a zoom level.
function tileOf(lat: number, lon: number, z: number): { x: number; y: number } {
  const n = 2 ** z;
  const rad = (lat * Math.PI) / 180;
  return {
    x: Math.floor(((lon + 180) / 360) * n),
    y: Math.floor(((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * n),
  };
}

// Stub OSM tiles and record which ones the map asks for — that tells us where it is looking.
async function recordTiles(page: Page): Promise<string[]> {
  const tiles: string[] = [];
  await page.route('https://tile.openstreetmap.org/**', (route) => {
    const [z, x, y] = new URL(route.request().url()).pathname.slice(1).replace('.png', '').split('/');
    tiles.push(`${z}/${x}/${y}`);
    return route.fulfill({ status: 200, contentType: 'image/png', body: PNG });
  });
  return tiles;
}

async function openTiepointStep(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByRole('button', { name: 'Create map' }).click();
  await page.locator('#cm-img-input').setInputFiles({ name: 'trail.png', mimeType: 'image/png', buffer: PNG });
  await expect(page.locator('#cm-leaflet.leaflet-container')).toBeVisible();
}

async function tapAt(page: Page, selector: string, fx: number, fy: number): Promise<void> {
  const box = (await page.locator(selector).boundingBox())!;
  await page.mouse.click(box.x + box.width * fx, box.y + box.height * fy);
}

test.describe('with location permission granted', () => {
  test.use({ geolocation: HERE, permissions: ['geolocation'] });

  test('map picker starts at the current location', async ({ page }) => {
    const tiles = await recordTiles(page);
    await openTiepointStep(page);
    const t = tileOf(HERE.latitude, HERE.longitude, 16);
    await expect.poll(() => tiles).toContain(`16/${t.x}/${t.y}`);
  });

  test('map and image keep their view after confirming a tiepoint', async ({ page }) => {
    const tiles = await recordTiles(page);
    await openTiepointStep(page);
    const t = tileOf(HERE.latitude, HERE.longitude, 16);
    await expect.poll(() => tiles).toContain(`16/${t.x}/${t.y}`);

    // Tag the live elements; a rebuilt map/canvas would lose the tags.
    await page.locator('#cm-leaflet').evaluate((el) => (el.dataset.e2e = 'same'));
    await page.locator('#cm-canvas').evaluate((el) => (el.dataset.e2e = 'same'));

    await tapAt(page, '#cm-canvas', 0.5, 0.5);
    await tapAt(page, '#cm-leaflet', 0.5, 0.5);
    const tilesBeforeConfirm = tiles.length;
    await page.getByRole('button', { name: 'Confirm' }).click();

    await expect(page.getByText('Tiepoint 2 of 2')).toBeVisible();
    await expect(page.locator('#cm-leaflet')).toHaveAttribute('data-e2e', 'same');
    await expect(page.locator('#cm-canvas')).toHaveAttribute('data-e2e', 'same');
    // No reload of the map: no zoomed-out tiles fetched after confirming
    expect(tiles.slice(tilesBeforeConfirm).filter((k) => !k.startsWith('16/'))).toEqual([]);
  });

  test('locate button re-centres the map on the current position', async ({ page, context }) => {
    const tiles = await recordTiles(page);
    await openTiepointStep(page);
    const here = tileOf(HERE.latitude, HERE.longitude, 16);
    await expect.poll(() => tiles).toContain(`16/${here.x}/${here.y}`);

    // The user walks somewhere else, then taps the locate button
    const THERE = { latitude: 32.794, longitude: 34.9896 }; // Haifa
    await context.setGeolocation(THERE);
    await page.getByRole('button', { name: 'Show my location' }).click();
    const there = tileOf(THERE.latitude, THERE.longitude, 16);
    await expect.poll(() => tiles).toContain(`16/${there.x}/${there.y}`);
  });
});

test('without permission, the map picker reopens where it was last left', async ({ page }) => {
  const tiles = await recordTiles(page);
  await page.addInitScript((v) => localStorage.setItem('cm.editorView', JSON.stringify(v)), SAVED);
  await openTiepointStep(page);
  const t = tileOf(SAVED.lat, SAVED.lon, SAVED.zoom);
  await expect.poll(() => tiles).toContain(`${SAVED.zoom}/${t.x}/${t.y}`);
  // No permission prompt is triggered on load: nothing asked for the current location
  expect(tiles.some((k) => k.startsWith('16/'))).toBe(false);
});

test('two-finger pinch zooms the map image', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Multi-touch is simulated through the Chrome DevTools protocol');
  await recordTiles(page);
  await openTiepointStep(page);
  const canvas = page.locator('#cm-canvas');
  // Top-left corner of the canvas is empty background until the image is zoomed in
  const cornerAlpha = () => canvas.evaluate((c: HTMLCanvasElement) => c.getContext('2d')!.getImageData(4, 4, 1, 1).data[3]);
  expect(await cornerAlpha()).toBe(0);

  // Real multi-touch through the DevTools protocol: two fingers spreading apart
  const box = (await canvas.boundingBox())!;
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
  const cdp = await page.context().newCDPSession(page);
  const touch = (type: string, d: number) => cdp.send('Input.dispatchTouchEvent', {
    type,
    touchPoints: type === 'touchEnd' ? [] : [{ x: cx - d, y: cy, id: 1 }, { x: cx + d, y: cy, id: 2 }],
  });
  await touch('touchStart', 20);
  for (let d = 30; d <= 180; d += 15) await touch('touchMove', d);
  await touch('touchEnd', 0);

  await expect.poll(cornerAlpha).toBeGreaterThan(0);
  // A pinch is not a tap: no point was picked
  await expect(page.getByText('Tap a spot on the image')).toBeVisible();
});

import { expect, test, type Page } from '@playwright/test';
import JSZip from 'jszip';

// 2×2 PNG, enough for the image decoder and the overlay.
const PNG_2x2 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGP8z8DAwMDAxMDAwMDAAAANHQEDasKb6QAAAABJRU5ErkJggg==',
  'base64',
);

async function buildKmz(): Promise<Buffer> {
  const zip = new JSZip();
  zip.file('doc.kml', `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
<GroundOverlay>
  <name><![CDATA[E2E Test Map]]></name>
  <Icon><href>map.png</href></Icon>
  <ExtendedData xmlns:tie="urn:tiepoints">
    <tie:tiepoint><tie:image>0,0</tie:image><tie:geo>34.75,32.10</tie:geo></tie:tiepoint>
    <tie:tiepoint><tie:image>2,2</tie:image><tie:geo>34.80,32.05</tie:geo></tie:tiepoint>
  </ExtendedData>
</GroundOverlay>
</kml>`);
  zip.file('map.png', PNG_2x2);
  return zip.generateAsync({ type: 'nodebuffer' });
}

// Picks an action from a saved map's "⋯" menu in the library.
async function mapAction(page: Page, mapName: string, action: 'Share' | 'Edit tiepoints' | 'Delete'): Promise<void> {
  await page.getByRole('button', { name: `More actions for ${mapName}` }).click();
  await page.getByRole('menuitem', { name: action }).click();
}

// Keep tests hermetic: never hit the real OSM tile servers.
async function stubTiles(page: Page): Promise<void> {
  await page.route('https://tile.openstreetmap.org/**', (route) =>
    route.fulfill({ status: 200, contentType: 'image/png', body: PNG_2x2 }),
  );
}

test.beforeEach(async ({ page }) => {
  await stubTiles(page);
  await page.goto('/');
});

test('library screen renders with no JS errors and no analytics outside Vercel', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const insights: string[] = [];
  page.on('request', (r) => { if (r.url().includes('/_vercel/')) insights.push(r.url()); });
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Custom Maps' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open file' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Create map' })).toBeVisible();
  await expect(page.locator('#cm-file-input')).toBeHidden();
  expect(errors).toEqual([]);
  expect(insights).toEqual([]);
});

test('importing a KMZ opens it on the map and saves it to the library', async ({ page }) => {
  await page.locator('#cm-file-input').setInputFiles({
    name: 'e2e.kmz',
    mimeType: 'application/vnd.google-earth.kmz',
    buffer: await buildKmz(),
  });
  await expect(page.locator('.leaflet-container')).toBeVisible();

  // Reload: the map must persist in IndexedDB and be listed in the library.
  await page.reload();
  await expect(page.getByRole('button', { name: 'E2E Test Map', exact: true })).toBeVisible();
});

test('a saved map can be shared as a .kmz (download where there is no share sheet)', async ({ page, browserName }) => {
  test.skip(browserName === 'webkit', "Playwright's WebKit does not report downloads of blob URLs");
  await page.locator('#cm-file-input').setInputFiles({
    name: 'e2e.kmz', mimeType: 'application/vnd.google-earth.kmz', buffer: await buildKmz(),
  });
  await expect(page.locator('.leaflet-container')).toBeVisible();
  await page.reload();

  const download = page.waitForEvent('download');
  await mapAction(page, 'E2E Test Map', 'Share');
  const file = await download;
  expect(file.suggestedFilename()).toBe('E2E_Test_Map.kmz');
  const zip = await JSZip.loadAsync(await (await file.createReadStream()).toArray().then(Buffer.concat));
  expect(await zip.file('doc.kml')!.async('string')).toContain('E2E Test Map');
});

test('sharing sends the .kmz with a message linking to the app', async ({ page }) => {
  // Capture what reaches the phone's share sheet
  await page.addInitScript(() => {
    const w = window as unknown as { shared?: { title?: string; text?: string; files: string[] } };
    navigator.canShare = () => true;
    navigator.share = async (data) => {
      w.shared = { title: data?.title, text: data?.text, files: (data?.files ?? []).map((f) => `${f.name} ${f.type}`) };
    };
  });
  await page.goto('/');
  await page.locator('#cm-file-input').setInputFiles({
    name: 'e2e.kmz', mimeType: 'application/vnd.google-earth.kmz', buffer: await buildKmz(),
  });
  await expect(page.locator('.leaflet-container')).toBeVisible();
  await page.reload();
  await mapAction(page, 'E2E Test Map', 'Share');

  const shared = await page.evaluate(() => (window as unknown as { shared: unknown }).shared);
  expect(shared).toEqual({
    title: 'E2E Test Map',
    text: expect.stringMatching(/^"E2E Test Map" is a map for Custom Maps\..*\nhttp:\/\/localhost:4173\/$/s),
    files: ['E2E_Test_Map.kmz application/vnd.google-earth.kmz'],
  });
});

test('deleting a map asks for confirmation', async ({ page }) => {
  await page.locator('#cm-file-input').setInputFiles({
    name: 'e2e.kmz', mimeType: 'application/vnd.google-earth.kmz', buffer: await buildKmz(),
  });
  await expect(page.locator('.leaflet-container')).toBeVisible();
  await page.reload();

  await mapAction(page, 'E2E Test Map', 'Delete');
  // wa-dialog's host has no box of its own, so check its open state rather than visibility
  const dialog = page.locator('wa-dialog[label="Delete map?"]');
  await expect(dialog).toHaveAttribute('open');
  await expect(dialog.getByText('will be removed from this device')).toBeVisible();
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByRole('button', { name: 'E2E Test Map', exact: true })).toBeVisible();

  await mapAction(page, 'E2E Test Map', 'Delete');
  await dialog.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(page.getByText('No maps yet')).toBeVisible();
});

test('follows the system light/dark preference live', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.reload();
  await expect(page.locator('html')).toHaveClass(/wa-dark/);
  await page.emulateMedia({ colorScheme: 'light' });
  await expect(page.locator('html')).toHaveClass(/wa-light/);
  await expect(page.locator('html')).not.toHaveClass(/wa-dark/);
});

test('create-map wizard opens', async ({ page }) => {
  await page.getByRole('button', { name: 'Create map' }).click();
  await expect(page.locator('#cm-library')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Pick a map image' })).toBeVisible();
  await page.getByRole('button', { name: 'Back' }).click();
  await expect(page.getByRole('heading', { name: 'Custom Maps' })).toBeVisible();
});

test.describe('installed app', () => {
  test.use({ serviceWorkers: 'allow' });

  test('opens offline after the first visit', async ({ page, context, browserName }) => {
    test.skip(browserName === 'webkit', "Playwright's WebKit doesn't run service workers in its ephemeral test contexts");
    await page.goto('/');
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.reload(); // now controlled by the service worker
    await context.setOffline(true);
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Custom Maps' })).toBeVisible();
  });

  test('a new deploy takes over immediately instead of waiting for all tabs to close', async ({ request }) => {
    // Without these, the first open after a deploy keeps running the old cached code
    // (see registerSW in src/main.ts, which reloads the page when the new worker activates).
    const sw = await (await request.get('/sw.js')).text();
    expect(sw).toContain('skipWaiting()');
    expect(sw).toContain('clientsClaim()');
  });

  test('has an installable web app manifest', async ({ page, request }) => {
    await page.goto('/');
    const href = await page.locator('link[rel="manifest"]').getAttribute('href');
    const manifest = await (await request.get(new URL(href!, page.url()).href)).json();
    expect(manifest).toMatchObject({ name: 'Custom Maps', display: 'standalone' });
    expect(manifest.icons.some((i: { purpose?: string }) => i.purpose === 'maskable')).toBe(true);
  });
});

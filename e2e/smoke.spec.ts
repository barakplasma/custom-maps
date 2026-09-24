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

test('library screen renders with no JS errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Custom Maps' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open file' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Create map' })).toBeVisible();
  await expect(page.locator('#cm-file-input')).toBeHidden();
  expect(errors).toEqual([]);
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

test('deleting a map asks for confirmation', async ({ page }) => {
  await page.locator('#cm-file-input').setInputFiles({
    name: 'e2e.kmz', mimeType: 'application/vnd.google-earth.kmz', buffer: await buildKmz(),
  });
  await expect(page.locator('.leaflet-container')).toBeVisible();
  await page.reload();

  await page.getByRole('button', { name: 'Delete E2E Test Map' }).click();
  // wa-dialog's host has no box of its own, so check its open state rather than visibility
  const dialog = page.locator('wa-dialog[label="Delete map?"]');
  await expect(dialog).toHaveAttribute('open');
  await expect(dialog.getByText('will be removed from this device')).toBeVisible();
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByRole('button', { name: 'E2E Test Map', exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Delete E2E Test Map' }).click();
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

  test('has an installable web app manifest', async ({ page, request }) => {
    await page.goto('/');
    const href = await page.locator('link[rel="manifest"]').getAttribute('href');
    const manifest = await (await request.get(new URL(href!, page.url()).href)).json();
    expect(manifest).toMatchObject({ name: 'Custom Maps', display: 'standalone' });
    expect(manifest.icons.some((i: { purpose?: string }) => i.purpose === 'maskable')).toBe(true);
  });
});

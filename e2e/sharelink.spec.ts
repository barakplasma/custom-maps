import { expect, test, type Page, type Request } from '@playwright/test';
import JSZip from 'jszip';

// Short links: the build points MAPS_URL at https://maps.test/ (playwright.config.ts), and these
// tests stand in for Vercel Blob and the api/upload token function with page.route.
const KMZ_TYPE = 'application/vnd.google-earth.kmz';
const PNG_2x2 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGP8z8DAwMDAxMDAwMDAAAANHQEDasKb6QAAAABJRU5ErkJggg==',
  'base64',
);

async function buildKmz(image = { name: 'map.png', bytes: PNG_2x2, width: 2, height: 2 }): Promise<Buffer> {
  const zip = new JSZip();
  zip.file('doc.kml', `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
<GroundOverlay>
  <name>E2E Test Map</name>
  <Icon><href>${image.name}</href></Icon>
  <ExtendedData xmlns:tie="urn:tiepoints">
    <tie:tiepoint><tie:image>0,0</tie:image><tie:geo>34.75,32.10</tie:geo></tie:tiepoint>
    <tie:tiepoint><tie:image>${image.width},${image.height}</tie:image><tie:geo>34.80,32.05</tie:geo></tie:tiepoint>
  </ExtendedData>
</GroundOverlay>
</kml>`);
  zip.file(image.name, image.bytes);
  return zip.generateAsync({ type: 'nodebuffer' });
}

// A detailed 3000×1500 photo-like JPEG (well over the 1 MB the app shares unchanged)
async function bigJpeg(page: Page): Promise<Buffer> {
  const dataUrl = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 3000; canvas.height = 1500;
    const ctx = canvas.getContext('2d')!;
    for (let i = 0; i < 20000; i++) {
      ctx.fillStyle = `hsl(${Math.random() * 360} 60% 50%)`;
      ctx.fillRect(Math.random() * 3000, Math.random() * 1500, 4 + Math.random() * 30, 4 + Math.random() * 30);
    }
    return canvas.toDataURL('image/jpeg', 0.95);
  });
  return Buffer.from(dataUrl.split(',')[1], 'base64');
}

async function saveMap(page: Page, kmz: Buffer): Promise<void> {
  await page.locator('#cm-file-input').setInputFiles({ name: 'e2e.kmz', mimeType: KMZ_TYPE, buffer: kmz });
  await expect(page.locator('.leaflet-container')).toBeVisible();
  await page.goto('/');
}

async function shareLink(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'More actions for E2E Test Map' }).click();
  await page.getByRole('menuitem', { name: 'Share link' }).click();
}

// Fake store: `stored` ids exist (HEAD/GET 200), everything else is 404
async function stubStore(page: Page, stored: Record<string, Buffer> = {}): Promise<void> {
  await page.route('https://maps.test/**', (route) => {
    const id = new URL(route.request().url()).pathname.match(/^\/m\/(\w+)\.kmz$/)?.[1];
    const body = id ? stored[id] : undefined;
    return body ? route.fulfill({ status: 200, contentType: KMZ_TYPE, body }) : route.fulfill({ status: 404 });
  });
}

// Fake token function + Blob upload API; returns what was uploaded
async function stubUpload(page: Page, tokenStatus = 200): Promise<{ tokenRequests: Request[]; uploads: Request[] }> {
  const seen = { tokenRequests: [] as Request[], uploads: [] as Request[] };
  await page.route('**/api/upload', (route) => {
    seen.tokenRequests.push(route.request());
    return tokenStatus === 200
      ? route.fulfill({ json: { type: 'blob.generate-client-token', clientToken: 'vercel_blob_client_teststore_x' } })
      : route.fulfill({ status: tokenStatus, json: { error: 'Link sharing is full' } });
  });
  await page.route('https://vercel.com/api/blob/**', (route) => {
    seen.uploads.push(route.request());
    const pathname = new URL(route.request().url()).searchParams.get('pathname')!;
    return route.fulfill({ json: {
      url: `https://maps.test/${pathname}`, downloadUrl: `https://maps.test/${pathname}?download=1`,
      pathname, contentType: KMZ_TYPE, contentDisposition: 'inline',
    } });
  });
  return seen;
}

test.beforeEach(async ({ page }) => {
  await page.route('https://tile.openstreetmap.org/**', (route) =>
    route.fulfill({ status: 200, contentType: 'image/png', body: PNG_2x2 }));
  // Capture what reaches the phone's share sheet
  await page.addInitScript(() => {
    navigator.canShare = () => true;
    navigator.share = async (data) => {
      (window as unknown as { shared: unknown }).shared = { url: data?.url, files: data?.files?.map((f) => f.name) };
    };
  });
  await page.goto('/');
});

test('opening a short link shows the shared map and keeps it in the library', async ({ page }) => {
  await stubStore(page, { abcd2345: await buildKmz() });
  await page.goto('/?m=abcd2345');
  await expect(page.locator('.leaflet-container')).toBeVisible();
  expect(new URL(page.url()).search).toBe(''); // a reload won't import it again

  await page.goto('/');
  await expect(page.getByRole('button', { name: 'E2E Test Map', exact: true })).toBeVisible();
});

test('a short link to a map that no longer exists says so', async ({ page }) => {
  await stubStore(page);
  await page.goto('/?m=abcd2345');
  await expect(page.locator('wa-toast-item', { hasText: 'Could not open the shared map: it no longer exists' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Create map' })).toBeVisible();
});

test('sharing a link uploads a smaller copy and shows its short link', async ({ page, browserName }) => {
  await stubStore(page);
  const { uploads } = await stubUpload(page);
  await saveMap(page, await buildKmz({ name: 'map.jpg', bytes: await bigJpeg(page), width: 3000, height: 1500 }));

  await shareLink(page);
  const dialog = page.locator('wa-dialog[label="Share link"]');
  await expect(dialog).toHaveAttribute('open');
  const link = dialog.getByRole('textbox', { name: 'Link' });
  await expect(link).toHaveValue(/^http:\/\/localhost:4173\/m\/[a-hj-km-np-z2-9]{8}$/);
  const id = (await link.inputValue()).split('/').pop();

  // Uploaded as m/<id>.kmz: image scaled to 2560 px wide, tiepoints scaled with it
  expect(uploads).toHaveLength(1);
  expect(new URL(uploads[0].url()).searchParams.get('pathname')).toBe(`m/${id}.kmz`);
  // Playwright's WebKit doesn't expose binary request bodies; Chromium checks the contents
  if (browserName !== 'webkit') {
    const uploaded = await JSZip.loadAsync(uploads[0].postDataBuffer()!);
    expect(await uploaded.file('doc.kml')!.async('string')).toContain('<tie:image>2560,1280</tie:image>');
    expect(uploaded.file('map.jpg')).not.toBeNull();
    expect(uploads[0].postDataBuffer()!.length).toBeLessThan(3 * 1024 * 1024);
  }

  await dialog.getByRole('button', { name: 'Share' }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { shared: unknown }).shared))
    .toEqual({ url: `http://localhost:4173/m/${id}` });
});

test('sharing a map that was shared before reuses its link without uploading', async ({ page }) => {
  const kmz = await buildKmz(); // small: shared as-is, so its id is the hash of these bytes
  const { tokenRequests } = await stubUpload(page);
  await stubStore(page);
  await saveMap(page, kmz);
  await shareLink(page);
  const link = page.locator('wa-dialog[label="Share link"]').getByRole('textbox', { name: 'Link' });
  await expect(link).toHaveValue(/\/m\/\w{8}$/);
  const id = (await link.inputValue()).split('/').pop()!;
  expect(tokenRequests).toHaveLength(1);

  await page.unroute('https://maps.test/**');
  await stubStore(page, { [id]: kmz }); // now it's in the store
  await page.goto('/');
  await shareLink(page);
  await expect(link).toHaveValue(new RegExp(`/m/${id}$`));
  expect(tokenRequests).toHaveLength(1);
});

test('when link sharing is refused, the file can be shared instead', async ({ page }) => {
  await stubStore(page);
  await stubUpload(page, 400);
  await saveMap(page, await buildKmz());
  await shareLink(page);

  const dialog = page.locator('wa-dialog[label="Share link"]');
  await expect(dialog.getByText("Couldn't create a link")).toBeVisible();
  await dialog.getByRole('button', { name: 'Share file instead' }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { shared: unknown }).shared))
    .toEqual({ url: undefined, files: ['E2E_Test_Map.kmz'] });
});

test('the QR code stays black on white in dark mode, so cameras can read it', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await stubStore(page);
  await stubUpload(page);
  await saveMap(page, await buildKmz());
  await shareLink(page);
  await expect(page.locator('wa-dialog[label="Share link"]').getByRole('textbox', { name: 'Link' })).toHaveValue(/\/m\//);
  // Centre of the top-left finder square, which must be black
  await expect.poll(() => page.evaluate(() => {
    const canvas = document.querySelector('wa-qr-code')!.shadowRoot!.querySelector('canvas')!;
    const s = Math.round(canvas.width * 0.1);
    return Array.from(canvas.getContext('2d')!.getImageData(s, s, 1, 1).data.slice(0, 3));
  })).toEqual([0, 0, 0]);
});

import { expect, test, type Page } from '@playwright/test';
import JSZip from 'jszip';

// Reading KMZ files: the formats the app must open, and the ones it must refuse.
const KMZ_TYPE = 'application/vnd.google-earth.kmz';
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGP8z8DAwMDAxMDAwMDAAAANHQEDasKb6QAAAABJRU5ErkJggg==',
  'base64',
);

// Verbatim shape of what the Android app writes (MapEditor.java LATLONBOX_KML_TEMPLATE):
// CDATA name, image in a subfolder, a LatLonBox and tiepoints with lon,lat order.
const ANDROID_KML = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2"
     xmlns:gx="http://www.google.com/kml/ext/2.2">
<GroundOverlay>
  <name><![CDATA[Old City]]></name>
  <description><![CDATA[]]></description>
  <Icon>
    <href>images/old_city.png</href>
  </Icon>
  <LatLonBox>
    <north>31.780000</north>
    <south>31.770000</south>
    <east>35.240000</east>
    <west>35.225000</west>
    <rotation>1.50</rotation>
  </LatLonBox>
  <ExtendedData xmlns:tie="urn:tiepoints">
    <tie:tiepoint>
      <tie:image>0,0</tie:image>
      <tie:geo>35.225000,31.780000</tie:geo>
    </tie:tiepoint>
    <tie:tiepoint>
      <tie:image>2,2</tie:image>
      <tie:geo>35.240000,31.770000</tie:geo>
    </tie:tiepoint>
  </ExtendedData>
</GroundOverlay>
</kml>`;

async function kmz(kml: string, image = 'map.png'): Promise<Buffer> {
  const zip = new JSZip();
  zip.file('doc.kml', kml);
  zip.file(image, PNG);
  return zip.generateAsync({ type: 'nodebuffer' });
}

async function importKmz(page: Page, buffer: Buffer): Promise<void> {
  await page.locator('#cm-file-input').setInputFiles({ name: 'import.kmz', mimeType: KMZ_TYPE, buffer });
}

test.beforeEach(async ({ page }) => {
  await page.route('https://tile.openstreetmap.org/**', (r) => r.fulfill({ contentType: 'image/png', body: PNG }));
  await page.goto('/');
});

test('opens a map made by the Android app', async ({ page }) => {
  await importKmz(page, await kmz(ANDROID_KML, 'images/old_city.png'));
  await expect(page.locator('.leaflet-overlay-pane img')).toBeVisible();
  await page.getByRole('button', { name: 'Back to maps' }).click();
  await expect(page.getByRole('button', { name: 'Old City', exact: true })).toBeVisible();
});

test('a standard KML overlay with only a LatLonBox is stretched to fill the box', async ({ page }) => {
  // A square image in a 0.1° × 0.1° box at lat 32, which the map draws taller than wide
  await importKmz(page, await kmz(`<kml xmlns="http://www.opengis.net/kml/2.2"><GroundOverlay>
    <name>Box</name><Icon><href>map.png</href></Icon>
    <LatLonBox><north>32.1</north><south>32.0</south><east>34.8</east><west>34.7</west></LatLonBox>
  </GroundOverlay></kml>`));
  const img = page.locator('.leaflet-overlay-pane img');
  await expect(img).toBeVisible();
  const box = (await img.boundingBox())!;
  // Web Mercator stretches latitude by 1 / cos(lat): ≈ 1.18 here, where a square would be 1
  expect(box.height / box.width).toBeCloseTo(1 / Math.cos((32.05 * Math.PI) / 180), 1);
  await page.getByRole('button', { name: 'Back to maps' }).click();
  await expect(page.getByRole('button', { name: 'Box', exact: true })).toBeVisible();
});

test.describe('a LatLonBox with <rotation>', () => {
  test.use({ permissions: ['geolocation'], geolocation: { latitude: 0, longitude: 0 } });

  test('is turned counter-clockwise, as KML specifies', async ({ page }) => {
    // A box twice as wide as tall on the map (Web Mercator), turned 90°: it becomes twice as tall
    // as wide, and the image's top-left corner swings round to its bottom-left
    const merc = (lat: number) => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
    const lat = (y: number) => (Math.atan(Math.exp(y)) * 360) / Math.PI - 90;
    const south = 32.0, north = 32.05, west = 34.7;
    const h = merc(north) - merc(south); // box height in Mercator radians
    const east = west + (2 * h * 180) / Math.PI;
    await importKmz(page, await kmz(`<kml xmlns="http://www.opengis.net/kml/2.2"><GroundOverlay>
      <name>Turned</name><Icon><href>map.png</href></Icon>
      <LatLonBox><north>${north}</north><south>${south}</south><east>${east}</east><west>${west}</west>
        <rotation>90</rotation></LatLonBox>
    </GroundOverlay></kml>`));
    const img = page.locator('.leaflet-overlay-pane img');
    await expect(img).toBeVisible();

    // Where the image's top-left pixel should be: half a box-height west of centre, a full box-height
    // south (clockwise would put it east and north instead)
    const cy = (merc(north) + merc(south)) / 2, cLon = (west + east) / 2;
    const corner = { latitude: lat(cy - h), longitude: cLon - ((h / 2) * 180) / Math.PI };
    await page.context().setGeolocation(corner);
    await page.getByRole('button', { name: 'Show my location' }).click();
    const dot = page.locator('.leaflet-control-locate-location');
    await expect.poll(async () => {
      const box = (await img.boundingBox())!, d = (await dot.boundingBox())!;
      // The image's own pixel (0, 0): its CSS transform's translation, from its pane's origin
      const topLeft = await img.evaluate((el) => {
        const m = new DOMMatrix(getComputedStyle(el).transform), pane = el.parentElement!.getBoundingClientRect();
        return { x: pane.x + m.e, y: pane.y + m.f };
      });
      return {
        tallerThanWide: Math.abs(box.height / box.width - 2) < 0.05,
        dotOnTopLeftPixel: Math.hypot(d.x + d.width / 2 - topLeft.x, d.y + d.height / 2 - topLeft.y) < 2,
      };
    }, { timeout: 10_000 }).toEqual({ tallerThanWide: true, dotOnTopLeftPixel: true });
  });
});

for (const [label, kml, error] of [
  ['malformed XML', '<kml><GroundOverlay>', /Invalid KML/],
  ['no GroundOverlay', '<kml xmlns="http://www.opengis.net/kml/2.2"><Document/></kml>', /No GroundOverlay/],
  ['no image', '<kml><GroundOverlay><name>n</name></GroundOverlay></kml>', /No image href/],
] as const) {
  test(`refuses a KMZ with ${label}, saving nothing`, async ({ page }) => {
    await importKmz(page, await kmz(kml));
    await expect(page.locator('wa-toast-item', { hasText: error })).toBeVisible();
    await page.reload();
    await expect(page.getByText('No maps yet')).toBeVisible();
  });
}

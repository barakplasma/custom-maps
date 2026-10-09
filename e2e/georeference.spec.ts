import { expect, test, type Page } from '@playwright/test';
import JSZip from 'jszip';

// Georeferencing, checked the way a user would: stand somewhere, and the GPS dot must sit on the
// pixel of the map image that shows that spot. This exercises the tiepoint fit (GeoToImageConverter,
// DMatrix) end to end, including the Web Mercator fit that keeps 2-tiepoint maps upright.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGP8z8DAwMDAxMDAwMDAAAANHQEDasKb6QAAAABJRU5ErkJggg==',
  'base64',
);

type Tiepoint = { x: number; y: number; lat: number; lon: number };

async function openMap(page: Page, width: number, height: number, tiepoints: Tiepoint[]): Promise<void> {
  const image = await page.evaluate(([w, h]) => {
    const canvas = Object.assign(document.createElement('canvas'), { width: w, height: h });
    canvas.getContext('2d')!.fillRect(0, 0, w, h);
    return canvas.toDataURL('image/png').split(',')[1];
  }, [width, height]);
  const zip = new JSZip();
  zip.file('doc.kml', `<kml xmlns="http://www.opengis.net/kml/2.2"><GroundOverlay>
    <name>Survey</name><Icon><href>map.png</href></Icon>
    <ExtendedData xmlns:tie="urn:tiepoints">${tiepoints.map((t) =>
      `<tie:tiepoint><tie:image>${t.x},${t.y}</tie:image><tie:geo>${t.lon},${t.lat}</tie:geo></tie:tiepoint>`).join('')}
    </ExtendedData></GroundOverlay></kml>`);
  zip.file('map.png', Buffer.from(image, 'base64'));
  await page.locator('#cm-file-input').setInputFiles({
    name: 'survey.kmz', mimeType: 'application/vnd.google-earth.kmz', buffer: await zip.generateAsync({ type: 'nodebuffer' }),
  });
  await expect(page.locator('.leaflet-overlay-pane img')).toBeVisible();
}

// Stands at `where`, then returns how far (screen px) the GPS dot is from image pixel (x, y).
async function dotOffsetFromPixel(page: Page, where: { latitude: number; longitude: number },
  pixel: { x: number; y: number }, size: { width: number; height: number }): Promise<number> {
  await page.context().setGeolocation(where);
  await page.getByRole('button', { name: 'Show my location' }).click();
  const dot = page.locator('.leaflet-control-locate-location');
  await expect(dot).toBeVisible();
  let offset = Infinity;
  // Poll until the view settles (the map pans to the user)
  await expect.poll(async () => {
    const img = (await page.locator('.leaflet-overlay-pane img').boundingBox())!;
    const d = (await dot.boundingBox())!;
    offset = Math.hypot(
      d.x + d.width / 2 - (img.x + (pixel.x / size.width) * img.width),
      d.y + d.height / 2 - (img.y + (pixel.y / size.height) * img.height));
    return offset;
  }, { timeout: 10_000 }).toBeLessThan(2);
  return offset;
}

// Latitude at a fraction of the way between two latitudes in Web Mercator (how the map is drawn)
function mercatorLat(north: number, south: number, fraction: number): number {
  const y = (lat: number) => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
  const yy = y(north) + (y(south) - y(north)) * fraction;
  return (Math.atan(Math.exp(yy)) * 360) / Math.PI - 90;
}

test.use({ permissions: ['geolocation'], geolocation: { latitude: 0, longitude: 0 } });

test.beforeEach(async ({ page }) => {
  await page.route('https://tile.openstreetmap.org/**', (r) => r.fulfill({ contentType: 'image/png', body: PNG }));
  await page.goto('/');
});

test.describe('a map placed with 3 tiepoints (1000 × 800 px, Tel Aviv)', () => {
  const size = { width: 1000, height: 800 };
  const tiepoints = [
    { x: 0, y: 0, lat: 32.10, lon: 34.75 },
    { x: 1000, y: 800, lat: 32.05, lon: 34.80 },
    { x: 1000, y: 0, lat: 32.10, lon: 34.80 },
  ];

  test('standing on a tiepoint puts the dot on its pixel', async ({ page }) => {
    await openMap(page, size.width, size.height, tiepoints);
    await dotOffsetFromPixel(page, { latitude: 32.05, longitude: 34.80 }, { x: 1000, y: 800 }, size);
  });

  test('standing between tiepoints puts the dot on the matching pixel', async ({ page }) => {
    await openMap(page, size.width, size.height, tiepoints);
    // A quarter across, three quarters down
    await dotOffsetFromPixel(page,
      { latitude: mercatorLat(32.10, 32.05, 0.75), longitude: 34.7625 }, { x: 250, y: 600 }, size);
  });
});

test.describe('a map placed with 2 tiepoints (the wizard default)', () => {
  // A north-up 1 km × 1 km area in Oslo (lat 60, where a degree of longitude is half as long as a
  // degree of latitude), 1000 × 1000 px. Fit in raw degrees, this would come out squashed or mirrored.
  const size = { width: 1000, height: 1000 };
  const lat0 = 59.9, lon0 = 10.7;
  const north = lat0 + 1000 / 111_320;
  const east = lon0 + 1000 / (111_320 * Math.cos((lat0 * Math.PI) / 180));
  const tiepoints = [
    { x: 0, y: 0, lat: north, lon: lon0 },
    { x: 1000, y: 1000, lat: lat0, lon: east },
  ];

  test('the image is upright and unmirrored: the north-east corner is top-right', async ({ page }) => {
    await openMap(page, size.width, size.height, tiepoints);
    await dotOffsetFromPixel(page, { latitude: north, longitude: east }, { x: 1000, y: 0 }, size);
  });

  test('and the south-west corner is bottom-left', async ({ page }) => {
    await openMap(page, size.width, size.height, tiepoints);
    await dotOffsetFromPixel(page, { latitude: lat0, longitude: lon0 }, { x: 0, y: 1000 }, size);
  });
});

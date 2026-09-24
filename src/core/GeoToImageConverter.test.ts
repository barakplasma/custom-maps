import { describe, expect, it } from 'vitest';
import { GeoToImageConverter } from './GeoToImageConverter';
import type { Tiepoint } from './Tiepoint';

// A 1000×800 px image covering a small area near Tel Aviv, north-up.
const tiepoints: Tiepoint[] = [
  { xPixel: 0,    yPixel: 0,   lat: 32.10, lon: 34.75 },
  { xPixel: 1000, yPixel: 800, lat: 32.05, lon: 34.80 },
  { xPixel: 1000, yPixel: 0,   lat: 32.10, lon: 34.80 },
];

describe('GeoToImageConverter', () => {
  it('rejects fewer than 2 tiepoints', () => {
    expect(new GeoToImageConverter().setFromTiepoints(tiepoints.slice(0, 1))).toBe(false);
  });

  it.each([2, 3])('reproduces each of %i tiepoints exactly', (n) => {
    const conv = new GeoToImageConverter();
    expect(conv.setFromTiepoints(tiepoints.slice(0, n))).toBe(true);
    for (const tp of tiepoints.slice(0, n)) {
      const [lat, lon] = conv.imageToLatLon(tp.xPixel, tp.yPixel);
      expect(lat).toBeCloseTo(tp.lat, 9);
      expect(lon).toBeCloseTo(tp.lon, 9);
      const [x, y] = conv.latLonToImage(tp.lat, tp.lon);
      expect(x).toBeCloseTo(tp.xPixel, 6);
      expect(y).toBeCloseTo(tp.yPixel, 6);
    }
  });

  it('round-trips image → geo → image for an arbitrary pixel', () => {
    const conv = new GeoToImageConverter();
    conv.setFromTiepoints(tiepoints);
    const [lat, lon] = conv.imageToLatLon(123.4, 567.8);
    const [x, y] = conv.latLonToImage(lat, lon);
    expect(x).toBeCloseTo(123.4, 6);
    expect(y).toBeCloseTo(567.8, 6);
  });

  it('interpolates the image centre to the geographic centre', () => {
    const conv = new GeoToImageConverter();
    conv.setFromTiepoints(tiepoints);
    const [lat, lon] = conv.imageToLatLon(500, 400);
    // Mercator spaces latitudes slightly non-linearly: within ~1 m of the linear midpoint
    expect(lat).toBeCloseTo(32.075, 5);
    expect(lon).toBeCloseTo(34.775, 9);
  });
});

describe('GeoToImageConverter with 2 tiepoints (the wizard default)', () => {
  // A north-up image of a 1 km × 1 km area in Oslo (lat 60, where a degree of longitude is
  // half as long as a degree of latitude). 1000 × 1000 px, so 1 px ≈ 1 m in both directions.
  const lat0 = 59.9, lon0 = 10.7;
  const dLat = 1000 / 111_320;                               // 1 km north
  const dLon = 1000 / (111_320 * Math.cos((lat0 * Math.PI) / 180)); // 1 km east
  const topLeft = { xPixel: 0, yPixel: 0, lat: lat0 + dLat, lon: lon0 };
  const bottomRight = { xPixel: 1000, yPixel: 1000, lat: lat0, lon: lon0 + dLon };

  it('keeps the image upright and unmirrored: the other corners land in the right places', () => {
    const conv = new GeoToImageConverter();
    expect(conv.setFromTiepoints([topLeft, bottomRight])).toBe(true);
    const [trLat, trLon] = conv.imageToLatLon(1000, 0); // top-right corner: north-east
    const [blLat, blLon] = conv.imageToLatLon(0, 1000); // bottom-left corner: south-west
    expect(trLat).toBeCloseTo(topLeft.lat, 5);
    expect(trLon).toBeCloseTo(bottomRight.lon, 5);
    expect(blLat).toBeCloseTo(bottomRight.lat, 5);
    expect(blLon).toBeCloseTo(topLeft.lon, 5);
  });

  it('round-trips through the inverse', () => {
    const conv = new GeoToImageConverter();
    conv.setFromTiepoints([topLeft, bottomRight]);
    const [lat, lon] = conv.imageToLatLon(250, 750);
    const [x, y] = conv.latLonToImage(lat, lon);
    expect(x).toBeCloseTo(250, 6);
    expect(y).toBeCloseTo(750, 6);
  });
});

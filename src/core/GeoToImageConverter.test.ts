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
    expect(lat).toBeCloseTo(32.075, 9);
    expect(lon).toBeCloseTo(34.775, 9);
  });
});

// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { parseKml } from './KmzReader';
import { buildKml } from './KmzWriter';
import type { Tiepoint } from '../core/Tiepoint';

const tiepoints: Tiepoint[] = [
  { xPixel: 10,  yPixel: 20,  lat: 31.7767, lon: 35.2345 },
  { xPixel: 900, yPixel: 700, lat: 31.7601, lon: 35.2512 },
];

// Verbatim shape of what the Android app writes (MapEditor.java LATLONBOX_KML_TEMPLATE).
const ANDROID_KML = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2"
     xmlns:gx="http://www.google.com/kml/ext/2.2">
<GroundOverlay>
  <name><![CDATA[Old City]]></name>
  <description><![CDATA[]]></description>
  <Icon>
    <href>images/old_city.jpg</href>
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
      <tie:image>12,34</tie:image>
      <tie:geo>35.230000,31.778000</tie:geo>
    </tie:tiepoint>
    <tie:tiepoint>
      <tie:image>800,600</tie:image>
      <tie:geo>35.238000,31.771000</tie:geo>
    </tie:tiepoint>
  </ExtendedData>
</GroundOverlay>
</kml>`;

describe('buildKml / parseKml', () => {
  it('round-trips name, image href and tiepoints', () => {
    const kml = buildKml({ name: 'Trail <A> & "B"', imageFilename: 'map.jpg', tiepoints });
    const parsed = parseKml(kml);
    expect(parsed.name).toBe('Trail <A> & "B"');
    expect(parsed.imageFilename).toBe('map.jpg');
    expect(parsed.tiepoints).toEqual(tiepoints);
  });

  it('writes tiepoints in the Android format', () => {
    const kml = buildKml({ name: 'x', imageFilename: 'map.jpg', tiepoints });
    expect(kml).toContain('<ExtendedData xmlns:tie="urn:tiepoints">');
    expect(kml).toContain('<tie:image>10,20</tie:image>');
    expect(kml).toContain('<tie:geo>35.2345,31.7767</tie:geo>');
    expect(kml.indexOf('<tie:image>')).toBeLessThan(kml.indexOf('<tie:geo>'));
  });

  it('reads KML written by the Android app', () => {
    const parsed = parseKml(ANDROID_KML);
    expect(parsed.name).toBe('Old City');
    expect(parsed.imageFilename).toBe('images/old_city.jpg');
    expect(parsed.tiepoints).toEqual([
      { xPixel: 12,  yPixel: 34,  lon: 35.23,  lat: 31.778 },
      { xPixel: 800, yPixel: 600, lon: 35.238, lat: 31.771 },
    ]);
    expect(parsed.latLonBox).toEqual({ north: 31.78, south: 31.77, east: 35.24, west: 35.225, rotation: 1.5 });
  });

  it('reads a plain LatLonBox overlay with no tiepoints', () => {
    const parsed = parseKml(`<kml xmlns="http://www.opengis.net/kml/2.2"><GroundOverlay>
      <name>Box</name><Icon><href>a.png</href></Icon>
      <LatLonBox><north>1</north><south>0</south><east>1</east><west>0</west></LatLonBox>
    </GroundOverlay></kml>`);
    expect(parsed.tiepoints).toEqual([]);
    expect(parsed.latLonBox).toMatchObject({ north: 1, south: 0, east: 1, west: 0, rotation: 0 });
  });

  it.each([
    ['malformed XML', '<kml><GroundOverlay>', /Invalid KML/],
    ['no GroundOverlay', '<kml xmlns="http://www.opengis.net/kml/2.2"><Document/></kml>', /No GroundOverlay/],
    ['no image href', '<kml><GroundOverlay><name>n</name></GroundOverlay></kml>', /No image href/],
  ])('rejects %s', (_label, kml, err) => {
    expect(() => parseKml(kml)).toThrow(err);
  });
});

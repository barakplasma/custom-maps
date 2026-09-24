import JSZip from 'jszip';
import type { Tiepoint } from '../core/Tiepoint';

export interface NewMapInput {
  name: string;
  imageBlob: Blob;
  imageFilename: string;
  imageWidth: number;
  imageHeight: number;
  tiepoints: Tiepoint[];
}

export async function writeKmz(input: NewMapInput): Promise<Blob> {
  const zip = new JSZip();
  zip.file('doc.kml', buildKml(input));
  zip.file(input.imageFilename, input.imageBlob);

  return zip.generateAsync({ type: 'blob', compression: 'STORE', mimeType: 'application/vnd.google-earth.kmz' });
}

// Builds doc.kml. Tiepoint markup mirrors the Android app's writer exactly
// (xmlns:tie="urn:tiepoints", comma-separated, image before geo) — see docs/KMZ_FORMAT.md.
export function buildKml(input: Pick<NewMapInput, 'name' | 'imageFilename' | 'tiepoints'>): string {
  const { name, imageFilename, tiepoints } = input;

  // Derive a LatLonBox from tiepoint extents for compatibility with standard KML readers
  const lats = tiepoints.map(t => t.lat);
  const lons = tiepoints.map(t => t.lon);
  const north = Math.max(...lats), south = Math.min(...lats);
  const east  = Math.max(...lons), west  = Math.min(...lons);

  const tiepointsXml = tiepoints.map(t =>
    `        <tie:tiepoint>\n` +
    `          <tie:image>${Math.round(t.xPixel)},${Math.round(t.yPixel)}</tie:image>\n` +
    `          <tie:geo>${t.lon},${t.lat}</tie:geo>\n` +
    `        </tie:tiepoint>`
  ).join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <GroundOverlay>
      <name>${escapeXml(name)}</name>
      <Icon><href>${escapeXml(imageFilename)}</href></Icon>
      <LatLonBox>
        <north>${north}</north>
        <south>${south}</south>
        <east>${east}</east>
        <west>${west}</west>
        <rotation>0</rotation>
      </LatLonBox>
      <ExtendedData xmlns:tie="urn:tiepoints">
${tiepointsXml}
      </ExtendedData>
    </GroundOverlay>
  </Document>
</kml>`;
}

function escapeXml(s: string): string {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;');
}

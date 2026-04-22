import JSZip from 'jszip';
import { GeoToImageConverter } from '../core/GeoToImageConverter';
import type { GroundOverlay, LatLonBox } from '../core/GroundOverlay';
import type { Tiepoint } from '../core/Tiepoint';

export async function readKmz(blob: Blob): Promise<GroundOverlay> {
  const zip = await JSZip.loadAsync(blob);

  // Find .kml entry
  const kmlEntry = Object.values(zip.files).find(f => !f.dir && f.name.toLowerCase().endsWith('.kml'));
  if (!kmlEntry) throw new Error('No .kml file found in KMZ');

  const kmlText = await kmlEntry.async('string');
  const dom = new DOMParser().parseFromString(kmlText, 'application/xml');

  const parseError = dom.querySelector('parsererror');
  if (parseError) throw new Error('Invalid KML XML');

  const overlayEl = dom.getElementsByTagName('GroundOverlay')[0];
  if (!overlayEl) throw new Error('No GroundOverlay found in KML');

  const name = overlayEl.getElementsByTagName('name')[0]?.textContent?.trim() ?? 'Untitled map';

  const hrefEl = overlayEl.querySelector('Icon href') ?? overlayEl.querySelector('Icon > href');
  const imageFilename = hrefEl?.textContent?.trim() ?? '';
  if (!imageFilename) throw new Error('No image href in GroundOverlay');

  // Parse tiepoints (namespace-agnostic: match by local name)
  const tiepoints: Tiepoint[] = [];
  const allEls = overlayEl.getElementsByTagName('*');
  for (let i = 0; i < allEls.length; i++) {
    const el = allEls[i];
    if (el.localName === 'tiepoint') {
      const geoEl = findChildByLocalName(el, 'geo');
      const imgEl = findChildByLocalName(el, 'image');
      if (!geoEl || !imgEl) continue;
      const geoParts = geoEl.textContent?.trim().split(/[\s,]+/) ?? [];
      const imgParts = imgEl.textContent?.trim().split(/[\s,]+/) ?? [];
      if (geoParts.length < 2 || imgParts.length < 2) continue;
      tiepoints.push({
        lon: parseFloat(geoParts[0]),
        lat: parseFloat(geoParts[1]),
        xPixel: parseFloat(imgParts[0]),
        yPixel: parseFloat(imgParts[1]),
      });
    }
  }

  // LatLonBox fallback
  let latLonBox: LatLonBox | undefined;
  const boxEl = overlayEl.getElementsByTagName('LatLonBox')[0];
  if (boxEl) {
    latLonBox = {
      north:    parseFloat(boxEl.getElementsByTagName('north')[0]?.textContent ?? '0'),
      south:    parseFloat(boxEl.getElementsByTagName('south')[0]?.textContent ?? '0'),
      east:     parseFloat(boxEl.getElementsByTagName('east')[0]?.textContent ?? '0'),
      west:     parseFloat(boxEl.getElementsByTagName('west')[0]?.textContent ?? '0'),
      rotation: parseFloat(boxEl.getElementsByTagName('rotation')[0]?.textContent ?? '0'),
    };
  }

  // Load image blob from ZIP
  const imageBlob = await loadImageFromZip(zip, imageFilename, kmlEntry.name);

  // Decode image dimensions
  const { width: imageWidth, height: imageHeight } = await getImageDimensions(imageBlob);

  // If no tiepoints, synthesize from LatLonBox
  if (tiepoints.length === 0 && latLonBox) {
    tiepoints.push(
      { xPixel: 0,          yPixel: 0,           lon: latLonBox.west, lat: latLonBox.north },
      { xPixel: imageWidth, yPixel: imageHeight,  lon: latLonBox.east, lat: latLonBox.south },
    );
  }

  if (tiepoints.length < 2) throw new Error('Not enough tiepoints to georeference this map');

  // Validate the converter can be constructed
  const conv = new GeoToImageConverter();
  if (!conv.setFromTiepoints(tiepoints)) throw new Error('Failed to compute georeferencing transform');

  return { name, imageFilename, imageBlob, imageWidth, imageHeight, tiepoints, latLonBox };
}

function findChildByLocalName(parent: Element, localName: string): Element | null {
  for (let i = 0; i < parent.children.length; i++) {
    if (parent.children[i].localName === localName) return parent.children[i];
  }
  return null;
}

async function loadImageFromZip(zip: JSZip, href: string, kmlPath: string): Promise<Blob> {
  // Try exact path first
  let entry = zip.file(href);

  // Try relative to kml directory
  if (!entry) {
    const kmlDir = kmlPath.includes('/') ? kmlPath.substring(0, kmlPath.lastIndexOf('/') + 1) : '';
    entry = zip.file(kmlDir + href);
  }

  // Case-insensitive basename match
  if (!entry) {
    const basename = href.split('/').pop()!.toLowerCase();
    entry = Object.values(zip.files).find(
      f => !f.dir && f.name.split('/').pop()!.toLowerCase() === basename
    ) ?? null;
  }

  if (!entry) throw new Error(`Image not found in KMZ: ${href}`);

  const data = await entry.async('arraybuffer');
  const mime = guessMime(href);
  return new Blob([data], { type: mime });
}

function guessMime(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  return { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp' }[ext] ?? 'image/jpeg';
}

function getImageDimensions(blob: Blob): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload  = () => { URL.revokeObjectURL(url); resolve({ width: img.naturalWidth, height: img.naturalHeight }); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not decode image')); };
    img.src = url;
  });
}

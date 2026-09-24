import { DMatrix } from './DMatrix';
import type { Tiepoint } from './Tiepoint';

// Convention (matching Android reference): geo-space uses (lon, lat) as (x, y).
// imageToGeo maps image pixel (x,y) → (lon, lat).
// geoToImage maps (lon, lat) → image pixel (x,y).
export class GeoToImageConverter {
  private imageToGeo = new DMatrix();
  private geoToImage = new DMatrix();
  private valid = false;

  setFromTiepoints(tps: Tiepoint[]): boolean {
    if (tps.length < 2) return false;
    const count = Math.min(tps.length, 3);
    const src: number[] = [];
    const dst: number[] = [];
    for (let i = 0; i < count; i++) {
      src.push(tps[i].xPixel, tps[i].yPixel);
      dst.push(tps[i].lon, tps[i].lat);
    }
    if (!this.imageToGeo.setPolyToPoly(src, dst, count)) return false;
    if (!this.imageToGeo.invert(this.geoToImage)) return false;
    this.valid = true;
    return true;
  }

  isValid(): boolean { return this.valid; }

  // Returns [lat, lon] for the given image pixel.
  imageToLatLon(x: number, y: number): [number, number] {
    const out = [0, 0];
    this.imageToGeo.mapPoints(out, [x, y]);
    return [out[1], out[0]]; // out is [lon, lat] → return [lat, lon]
  }

  // Returns [xPixel, yPixel] for the given lat/lon.
  latLonToImage(lat: number, lon: number): [number, number] {
    const out = [0, 0];
    this.geoToImage.mapPoints(out, [lon, lat]);
    return [out[0], out[1]];
  }
}

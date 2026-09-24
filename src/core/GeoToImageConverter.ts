import { DMatrix } from './DMatrix';
import type { Tiepoint } from './Tiepoint';

// The image is fitted to Web Mercator coordinates, not raw degrees — as the Android editor did
// (it fitted to projected screen pixels). Mercator is conformal and, like image pixels, has y
// pointing down, so a 2-point rotation + uniform scale keeps the image upright and unstretched.
// In raw degrees it would come out mirrored (latitude grows upwards) and squashed (a degree of
// longitude is cos(lat) shorter than a degree of latitude).
//
// imageToMerc maps image pixel (x, y) → Mercator (x, y); mercToImage is its inverse.
export class GeoToImageConverter {
  private imageToMerc = new DMatrix();
  private mercToImage = new DMatrix();
  private valid = false;

  setFromTiepoints(tps: Tiepoint[]): boolean {
    if (tps.length < 2) return false;
    const count = Math.min(tps.length, 3);
    const src: number[] = [];
    const dst: number[] = [];
    for (let i = 0; i < count; i++) {
      src.push(tps[i].xPixel, tps[i].yPixel);
      dst.push(...toMercator(tps[i].lat, tps[i].lon));
    }
    if (!this.imageToMerc.setPolyToPoly(src, dst, count)) return false;
    if (!this.imageToMerc.invert(this.mercToImage)) return false;
    this.valid = true;
    return true;
  }

  isValid(): boolean { return this.valid; }

  // Returns [lat, lon] for the given image pixel.
  imageToLatLon(x: number, y: number): [number, number] {
    const out = [0, 0];
    this.imageToMerc.mapPoints(out, [x, y]);
    return fromMercator(out[0], out[1]);
  }

  // Returns [xPixel, yPixel] for the given lat/lon.
  latLonToImage(lat: number, lon: number): [number, number] {
    const out = [0, 0];
    this.mercToImage.mapPoints(out, toMercator(lat, lon));
    return [out[0], out[1]];
  }
}

const RAD = Math.PI / 180;

// Spherical Web Mercator in radians, y pointing south (down) like image rows.
function toMercator(lat: number, lon: number): [number, number] {
  return [lon * RAD, -Math.log(Math.tan(Math.PI / 4 + (lat * RAD) / 2))];
}

function fromMercator(x: number, y: number): [number, number] {
  return [(2 * Math.atan(Math.exp(-y)) - Math.PI / 2) / RAD, x / RAD];
}

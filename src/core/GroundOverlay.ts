import type { Tiepoint } from './Tiepoint';

export interface LatLonBox {
  north: number;
  south: number;
  east: number;
  west: number;
  rotation: number;
}

export interface GroundOverlay {
  name: string;
  imageFilename: string;
  imageBlob: Blob;
  imageWidth: number;
  imageHeight: number;
  tiepoints: Tiepoint[];
  latLonBox?: LatLonBox;
}

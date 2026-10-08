// The parts of leaflet-rotate (map rotation) that the app uses.
import 'leaflet';

declare module 'leaflet' {
  interface MapOptions {
    rotate?: boolean;
    bearing?: number;
    touchRotate?: boolean;
    rotateControl?: boolean | { position?: ControlPosition; closeOnZeroBearing?: boolean };
  }
  interface Map {
    getBearing(): number;
    setBearing(degrees: number): void;
    rotateControl?: Control;
  }
}

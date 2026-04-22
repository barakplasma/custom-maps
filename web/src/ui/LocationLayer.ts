import L from 'leaflet';
import type { LocationUpdate } from '../location/LocationTracker';

export class LocationLayer {
  private dot: L.CircleMarker | null = null;
  private ring: L.Circle | null = null;
  lastLatLon: [number, number] | undefined;

  constructor(private map: L.Map) {}

  update(u: LocationUpdate): void {
    this.lastLatLon = [u.lat, u.lon];
    const latlng: L.LatLngExpression = [u.lat, u.lon];
    if (!this.dot) {
      this.dot = L.circleMarker(latlng, {
        radius: 8, color: '#fff', weight: 2,
        fillColor: '#2563eb', fillOpacity: 1,
      }).addTo(this.map);
      this.ring = L.circle(latlng, {
        radius: u.accuracy, color: '#2563eb', weight: 1,
        fillColor: '#2563eb', fillOpacity: 0.1,
      }).addTo(this.map);
    } else {
      this.dot.setLatLng(latlng);
      this.ring!.setLatLng(latlng);
      this.ring!.setRadius(u.accuracy);
    }
  }

  destroy(): void {
    this.dot?.remove();
    this.ring?.remove();
    this.dot = null;
    this.ring = null;
  }
}

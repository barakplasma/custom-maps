export interface LocationUpdate {
  lat: number;
  lon: number;
  accuracy: number;
}

export class LocationTracker {
  private watchId: number | null = null;

  start(
    onUpdate: (u: LocationUpdate) => void,
    onError: (e: GeolocationPositionError) => void,
  ): void {
    if (!navigator.geolocation) {
      onError({ code: 2, message: 'Geolocation not supported', PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 });
      return;
    }
    this.watchId = navigator.geolocation.watchPosition(
      pos => onUpdate({ lat: pos.coords.latitude, lon: pos.coords.longitude, accuracy: pos.coords.accuracy }),
      onError,
      { enableHighAccuracy: true, maximumAge: 1000, timeout: 10000 },
    );
  }

  stop(): void {
    if (this.watchId !== null) {
      navigator.geolocation.clearWatch(this.watchId);
      this.watchId = null;
    }
  }
}

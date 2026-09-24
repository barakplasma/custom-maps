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

  isActive(): boolean { return this.watchId !== null; }

  stop(): void {
    if (this.watchId !== null) {
      navigator.geolocation.clearWatch(this.watchId);
      this.watchId = null;
    }
  }
}

// One-shot position fix. Only call from a user gesture, or after
// geolocationAlreadyGranted() resolves true (then no prompt is shown).
// maxAgeMs defaults to 0: a tap on "locate" must reflect where the user is now, not a cached fix.
export function getCurrentLocation(maxAgeMs = 0): Promise<LocationUpdate> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('Geolocation is not supported by this browser'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      pos => resolve({ lat: pos.coords.latitude, lon: pos.coords.longitude, accuracy: pos.coords.accuracy }),
      err => reject(new Error(err.message || 'Location unavailable')),
      { enableHighAccuracy: true, maximumAge: maxAgeMs, timeout: 10_000 },
    );
  });
}

// True when the user has already allowed location for this site, so reading it
// will not show a permission prompt. Safari < 16 has no Permissions API → false.
export async function geolocationAlreadyGranted(): Promise<boolean> {
  try {
    const status = await navigator.permissions?.query({ name: 'geolocation' });
    return status?.state === 'granted';
  } catch {
    return false;
  }
}

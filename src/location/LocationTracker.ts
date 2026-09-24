export interface LocationUpdate {
  lat: number;
  lon: number;
  accuracy: number;
}

// Watches the position and keeps the screen awake while tracking, so the GPS map
// doesn't go dark in the user's hand. Browsers drop the wake lock when the page is
// hidden, so it is re-requested when the page becomes visible again.
export class LocationTracker {
  private watchId: number | null = null;
  private wakeLock: WakeLockSentinel | null = null;
  private onVisibilityChange = () => {
    if (document.visibilityState === 'visible' && this.isActive()) void this.keepScreenOn();
  };

  start(
    onUpdate: (u: LocationUpdate) => void,
    onError: (e: GeolocationPositionError) => void,
  ): void {
    this.watchId = navigator.geolocation.watchPosition(
      pos => onUpdate({ lat: pos.coords.latitude, lon: pos.coords.longitude, accuracy: pos.coords.accuracy }),
      onError,
      { enableHighAccuracy: true, maximumAge: 1000, timeout: 10000 },
    );
    void this.keepScreenOn();
    document.addEventListener('visibilitychange', this.onVisibilityChange);
  }

  isActive(): boolean { return this.watchId !== null; }

  private async keepScreenOn(): Promise<void> {
    try {
      this.wakeLock = await navigator.wakeLock.request('screen');
    } catch {
      // Refused (e.g. battery saver): tracking still works, the screen may just dim.
    }
  }

  stop(): void {
    if (this.watchId !== null) {
      navigator.geolocation.clearWatch(this.watchId);
      this.watchId = null;
      document.removeEventListener('visibilitychange', this.onVisibilityChange);
      void this.wakeLock?.release();
      this.wakeLock = null;
    }
  }
}

// One-shot position fix. Only call from a user gesture, or after
// geolocationAlreadyGranted() resolves true (then no prompt is shown).
// maxAgeMs defaults to 0: a tap on "locate" must reflect where the user is now, not a cached fix.
export function getCurrentLocation(maxAgeMs = 0): Promise<LocationUpdate> {
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(
      pos => resolve({ lat: pos.coords.latitude, lon: pos.coords.longitude, accuracy: pos.coords.accuracy }),
      err => reject(new Error(err.message || 'Location unavailable')),
      { enableHighAccuracy: true, maximumAge: maxAgeMs, timeout: 10_000 },
    );
  });
}

// True when the user has already allowed location for this site, so reading it
// will not show a permission prompt.
export async function geolocationAlreadyGranted(): Promise<boolean> {
  const status = await navigator.permissions.query({ name: 'geolocation' });
  return status.state === 'granted';
}

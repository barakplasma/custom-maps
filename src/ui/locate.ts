import type L from 'leaflet';
import { LocateControl, type LocateOptions } from 'leaflet.locatecontrol';
import 'leaflet.locatecontrol/dist/L.Control.Locate.min.css';
import { showToast } from './toast';

// "Show my location" via leaflet.locatecontrol: watches the position, draws the dot, accuracy
// circle and compass heading arrow (incl. the iOS compass permission prompt on tap), and
// follows the user until they pan. Tapping again always re-centres rather than switching off.
export function createLocateControl(options: LocateOptions = {}): LocateControl {
  return new LocateControl({
    position: 'bottomright',
    showCompass: true,
    showPopup: false,
    clickBehavior: { inView: 'setView', outOfView: 'setView', inViewNotFollowing: 'setView' },
    strings: { title: 'Show my location' },
    // Replaces (not merges) the plugin's defaults, so watch/setView must be restated:
    // watch keeps the position live while walking; the plugin does the view changes itself.
    locateOptions: { watch: true, setView: false, enableHighAccuracy: true, maxZoom: 16 },
    onLocationError: (err, control) => {
      // The plugin stops on any error except timeouts. Walking under trees or between buildings
      // briefly loses the fix (POSITION_UNAVAILABLE): keep trying quietly instead of silently
      // dropping out of navigation. The button shows a spinner meanwhile.
      if ((err as unknown as GeolocationPositionError).code === GeolocationPositionError.POSITION_UNAVAILABLE) {
        setTimeout(() => control.start(), 2000);
        return;
      }
      showToast(`Location error: ${err.message}`);
    },
    ...options,
  });
}

// Keep the screen on while location is being shown, so the map doesn't go dark in the
// user's hand while navigating. Browsers drop the lock when the page is hidden, so it is
// re-requested when the page becomes visible again.
export function keepScreenOnWhileLocating(map: L.Map): void {
  let lock: WakeLockSentinel | null = null;
  let locating = false;
  const acquire = async () => {
    try {
      lock = await navigator.wakeLock.request('screen');
    } catch {
      // Refused (e.g. battery saver): location still works, the screen may just dim.
    }
  };
  const release = () => { void lock?.release(); lock = null; };
  const onVisible = () => { if (locating && document.visibilityState === 'visible') void acquire(); };

  map.on('locateactivate', () => { locating = true; void acquire(); });
  map.on('locatedeactivate', () => { locating = false; release(); });
  document.addEventListener('visibilitychange', onVisible);
  map.on('unload', () => { release(); document.removeEventListener('visibilitychange', onVisible); });
}

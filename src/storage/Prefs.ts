// Small settings persisted in localStorage. Never store binary data here.
// localStorage can be unavailable (private mode, blocked storage), so every access is guarded.

export interface MapViewPref {
  lat: number;
  lon: number;
  zoom: number;
}

const EDITOR_VIEW_KEY = 'cm.editorView';

export function getEditorView(storage: Storage | undefined = safeLocalStorage()): MapViewPref | null {
  try {
    const raw = storage?.getItem(EDITOR_VIEW_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<MapViewPref>;
    if (!isFiniteNum(v.lat) || !isFiniteNum(v.lon) || !isFiniteNum(v.zoom)) return null;
    if (Math.abs(v.lat) > 90) return null;
    return { lat: v.lat, lon: v.lon, zoom: v.zoom };
  } catch {
    return null;
  }
}

export function setEditorView(view: MapViewPref, storage: Storage | undefined = safeLocalStorage()): void {
  try {
    storage?.setItem(EDITOR_VIEW_KEY, JSON.stringify(view));
  } catch {
    // Storage full or blocked: remembering the view is a convenience, not a requirement.
  }
}

function isFiniteNum(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n);
}

function safeLocalStorage(): Storage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

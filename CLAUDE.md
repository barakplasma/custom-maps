# CLAUDE.md — Custom Maps Web App

## What This Is

A **local-first, open source** browser PWA that lets users georeference any raster image and use
it as a live GPS map, with OpenStreetMap as the basemap and the browser Geolocation API for
position tracking. No server, no account, no analytics. Mobile-first UI styled with Pico.css.

Full product requirements are in `PRD.md`. Read it first.

---

## Repository Layout

```
custom-maps/
├── web/                     ← web app source (Vite + TypeScript)
│   ├── src/
│   │   ├── core/            ← pure math, no DOM/Leaflet
│   │   ├── io/              ← KMZ read/write
│   │   ├── location/        ← geolocation + compass
│   │   ├── ui/              ← Leaflet layers, panels, editor wizard
│   │   └── storage/         ← IndexedDB + localStorage wrappers
│   ├── public/
│   │   └── EGM96Geoid1deg.dac  ← geoid grid asset (~130 KB)
│   └── index.html
├── app/                     ← original Android source (reference only)
├── PRD.md
└── CLAUDE.md
```

---

## Domain Concepts

### Tiepoint

The fundamental unit of georeferencing. Pairs an image pixel with a geographic coordinate:

```typescript
interface Tiepoint {
  xPixel: number;  // pixel column in the source image
  yPixel: number;  // pixel row in the source image
  lat: number;     // WGS-84 latitude, degrees N
  lon: number;     // WGS-84 longitude, degrees E
}
```

A map needs at least 2 tiepoints. More tiepoints give a better-fit transform.

### Affine Georeferencing Transform

Given N ≥ 2 tiepoints, fit a 3×3 affine matrix `A` (double precision):

```
[lat ]       [xPixel]
[lon ] = A · [yPixel]
[ 1  ]       [  1   ]
```

- 2 tiepoints → solve analytically (scale + rotation + translation)
- 3 tiepoints → solve exactly
- 4+ tiepoints → least squares

Always invert `A` to get `A⁻¹` for the reverse direction (geo → pixel), used to place the GPS dot.

**Use `number` (64-bit float) everywhere. Never use `Float32Array` — precision loss corrupts
georeferencing.**

### KMZ File Format

A `.kmz` is a ZIP archive with one `.kml` file and the map image as siblings:

```
map.kmz
├── doc.kml
└── map.jpg
```

The KML contains a `<GroundOverlay>` with either:
- `<Tiepoint>` elements (custom extension, preferred format)
- `<LatLonBox>` (standard KML, axis-aligned + optional rotation)

Always **write** `<Tiepoint>` elements. Always **read** both formats.

### EGM96 Altitude Correction

GPS reports WGS-84 ellipsoidal altitude. To display MSL altitude, subtract the geoid height.

`EGM96Geoid1deg.dac` is a flat binary file of 16-bit big-endian integers: a 181×361 grid
(lat −90..+90 in 1° steps, lon 0..360 in 1° steps). Each value is geoid height in centimetres.

```typescript
function geoidHeight(lat: number, lon: number, grid: Int16Array): number {
  const normLon = ((lon % 360) + 360) % 360;
  const row = Math.round(lat + 90);   // 0..180
  const col = Math.round(normLon);    // 0..360
  return grid[row * 361 + col] / 100; // cm → metres
}
// MSL altitude = coords.altitude - geoidHeight(lat, lon, grid)
```

Load once at startup; keep in memory.

---

## Geolocation

```typescript
const watchId = navigator.geolocation.watchPosition(
  (pos) => {
    const { latitude, longitude, accuracy, altitude,
            altitudeAccuracy, heading, speed } = pos.coords;
    // accuracy  — horizontal radius in metres
    // altitude  — WGS-84 ellipsoidal height in metres (null if unavailable)
    // heading   — degrees CW from true North, null when stationary
    // speed     — m/s, null when stationary
  },
  (err) => { /* PERMISSION_DENIED | POSITION_UNAVAILABLE | TIMEOUT */ },
  { enableHighAccuracy: true, maximumAge: 1000, timeout: 10000 }
);
```

**Compass**: listen to `deviceorientationabsolute`, fall back to `deviceorientation`.
`event.alpha` is degrees CW from North.

**iOS Safari 13+ compass permission** — must be called from a user-gesture handler:

```typescript
if (typeof (DeviceOrientationEvent as any).requestPermission === 'function') {
  const result = await (DeviceOrientationEvent as any).requestPermission();
  if (result !== 'granted') throw new Error('compass denied');
}
```

Show an "Enable compass" button; do not request on page load.

---

## Source File Conventions

```
web/src/core/
  GeoToImageConverter.ts   — affine transform, tiepoint fitting
  DMatrix.ts               — double-precision 3×3 matrix (determinant, inverse, multiply)
  GroundOverlay.ts         — data model for a georeferenced map
  Tiepoint.ts              — Tiepoint interface + helpers
  GeoidHeight.ts           — EGM96 lookup

web/src/io/
  KmzReader.ts             — JSZip + DOMParser → GroundOverlay + image Blob
  KmzWriter.ts             — GroundOverlay + image Blob → JSZip Blob download

web/src/location/
  LocationTracker.ts       — watchPosition wrapper, emits LocationUpdate events
  CompassTracker.ts        — deviceorientation wrapper, emits heading degrees

web/src/ui/
  MapView.ts               — main map page, Leaflet map + canvas image overlay
  LocationLayer.ts         — GPS dot, accuracy circle, heading arrow
  ScaleBar.ts              — scale display, updates on zoom
  DetailsPanel.ts          — lat/lon/alt/heading/speed/accuracy panel
  MapLibrary.ts            — IndexedDB-backed map list
  editor/
    MapEditor.ts           — wizard orchestrator
    ImagePointPicker.ts    — pannable canvas, click to pick pixel
    GeoPointPicker.ts      — Leaflet map, click to pick lat/lon
    MapPreview.ts          — image warped over Leaflet for alignment check

web/src/storage/
  MapStore.ts              — IndexedDB wrapper for KMZ blobs
  Prefs.ts                 — localStorage wrapper for settings
```

---

## Key Decisions

- **Leaflet.js** for the OSM map — lightweight, no API key, broad plugin ecosystem.
- **Pico.css** for all UI chrome — classless, semantic HTML; no component framework needed.
- **JSZip** for KMZ — reads and writes ZIP in the browser without a server.
- **PDF.js** for PDF source images — rasterizes a selected page to a canvas before tiepointing.
- **Canvas overlay** for the map image — gives full control over rotation and transform; use a
  custom `L.Layer` that redraws on Leaflet's `viewreset` and `move` events.
- **IndexedDB** (via `idb`) for KMZ storage — binary blobs do not fit in localStorage.
- **Service Worker** for offline — cache app shell and OSM tiles on demand.

---

## UI / Styling Rules

The UI uses **Pico.css** (classless). Follow these rules:

1. Write semantic HTML — Pico styles elements by tag, not class. `<button>`, `<input>`, `<dialog>`,
   `<details>`, `<nav>`, `<article>`, `<progress>` all have opinionated defaults; use them.
2. Use `<dialog>` (native) for modals — settings, wizard steps, safety warning. Open/close via
   `dialog.showModal()` / `dialog.close()`.
3. Use `<details>`/`<summary>` for the collapsible location details panel.
4. Use `<progress value="0.4">` for KMZ download progress.
5. Override only via Pico's CSS custom properties (e.g. `--pico-primary`, `--pico-spacing`).
   Do not write new class-based selectors unless absolutely necessary.
6. The full-screen Leaflet map is `position: fixed; inset: 0` and sits beneath floating UI panels.
   All Pico-styled chrome floats over it with `position: fixed` or `absolute` + appropriate z-index.

**Mobile-first layout**:
- Primary action bar at the bottom (within thumb reach).
- Minimum tap target: 44×44 px.
- `font-size` in `rem` only; never `px` for text.
- Test every screen in 375 px wide portrait — that is the baseline.

---

## Guidelines

- Do not use the Google Maps API anywhere.
- Do not use single-precision floats for coordinate math.
- Do not store binary data in localStorage.
- Call `watchPosition` and `requestPermission` only in response to a user gesture.
- The KMZ files the web app writes must also open in the Android app — preserve the schema exactly.
- No external requests except OSM tile servers and optional user-provided KMZ URLs.
- When unsure about the KMZ schema or feature behaviour, read `PRD.md` or inspect
  `app/src/main/java/com/custommapsapp/android/kml/` for the reference implementation.

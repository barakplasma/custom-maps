# CLAUDE.md — Custom Maps Web App

## What This Is

A **local-first, open source** browser PWA that lets users georeference any raster image and use
it as a live GPS map, with OpenStreetMap as the basemap and the browser Geolocation API for
position tracking. No server, no account, no analytics. Mobile-first UI built with Web Awesome
components, following the system light/dark setting.

Full product requirements are in `PRD.md`. Read it first.

---

## Repository Layout

```
custom-maps/                 ← Vite + TypeScript app at the repo root
├── src/
│   ├── core/                ← pure math, no DOM/Leaflet
│   ├── io/                  ← KMZ read/write
│   ├── location/            ← geolocation + compass
│   ├── ui/                  ← screens, Leaflet layers, editor wizard, Web Awesome setup
│   ├── storage/             ← IndexedDB + localStorage wrappers
│   └── styles.css           ← app-level CSS on Web Awesome tokens
├── e2e/                     ← Playwright smoke tests
├── public/
│   └── EGM96Geoid1deg.dac   ← geoid grid asset (~130 KB)
├── index.html
├── vercel.json
├── docs/KMZ_FORMAT.md       ← KMZ schema + Android compatibility rules
├── .github/workflows/ci.yml ← typecheck, unit, e2e on every PR
├── .claude/                 ← SessionStart hook: installs deps in cloud sessions
├── PRD.md
└── CLAUDE.md
```

The original Android app was removed; it is in git history only. Its KMZ schema is preserved in
`docs/KMZ_FORMAT.md`.

---

## Build, Test, Verify

All commands run from the repo root:

```sh
npm run dev          # dev server on :5173
npm run typecheck    # tsc --noEmit
npm test             # Vitest unit tests: src/**/*.test.ts (fast, run often)
npm run test:e2e     # Playwright: builds, serves on :4173; Android Chrome (Pixel 10, 360 px) + iPhone Safari (WebKit, iPhone SE 375 px)
npm run check        # everything — must pass before pushing
```

Workflow for changes:

1. **Pure logic** (`core/`, KML parsing/building in `io/`): write or extend a `*.test.ts` next to
   the file. `core/` tests run in Node; files touching `DOMParser` use
   `// @vitest-environment jsdom` (not happy-dom — it rejects CDATA, which Android KMLs use).
2. **UI changes**: add or extend a spec in `e2e/`. Tests must be hermetic — stub
   `tile.openstreetmap.org` with `page.route` (see `stubTiles` in `e2e/smoke.spec.ts`).
3. **Seeing the UI**: take a screenshot with Playwright (`await page.screenshot({ path })`) at
   the Pixel 10 profile (`devices['Pixel 10']`, 360×732) and look at it, rather than guessing from the DOM — in **both** color schemes
   (`browser.newContext({ colorScheme: 'dark' })`). Leaflet `flyTo` animations can take several
   seconds; wait before judging map screenshots.
4. Keep logic out of `ui/` where possible — extract pure functions (like `parseKml`/`buildKml`)
   so they can be unit tested without a browser.

In Claude Code on the web, the SessionStart hook runs `npm install` and sets
`PLAYWRIGHT_CHROMIUM_EXECUTABLE` to the preinstalled Chromium, so the commands above work
immediately. The WebKit (iPhone) project runs in CI, or locally with `PW_WEBKIT=1` after
`npx playwright install webkit` (+ `npx playwright install-deps webkit` on Linux).
Elsewhere, run `npx playwright install chromium` once.

Deployment: Vercel builds the repo (see `vercel.json`) on every push; `master` is production at
<https://custom-maps-nu.vercel.app/>. Other `*.vercel.app` aliases are behind Vercel SSO.

---

## Platform: current Android and iOS browsers only

No legacy support. Vite's default build target (`baseline-widely-available`: Chrome 111+,
iOS/Safari 16.4+) is the floor — don't add polyfills, feature checks for baseline APIs, or a
custom `build.target`. Use platform features directly:

- **PWA** via `vite-plugin-pwa` (config in `vite.config.ts`): installable, offline app shell,
  OSM tiles the user has viewed cached for 7 days. Icons are generated from `public/icon.svg`.
  Never prefetch tiles in bulk (OSM tile usage policy).
- **Storage persistence**: `navigator.storage.persist()` after saving a map (Safari evicts
  unpersisted site data). KMZ bytes are stored as `ArrayBuffer`, not `Blob` — Safari private
  browsing rejects Blobs in IndexedDB.
- **Screen Wake Lock** while GPS tracking (`LocationTracker`).
- **Web Share** with files for saved `.kmz` (falls back to a download).
- `100dvh`, safe-area insets, `interactive-widget=resizes-content`, `overscroll-behavior: none`.

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

**Fit in Web Mercator, not raw degrees** (`GeoToImageConverter`, as the Android editor did).
Mercator is conformal and y-down like image rows; in raw lat/lon a 2-tiepoint fit comes out
mirrored and squashed by cos(lat). Tiepoints are still stored as lat/lon.

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
src/core/
  GeoToImageConverter.ts   — affine transform, tiepoint fitting
  DMatrix.ts               — double-precision 3×3 matrix (determinant, inverse, multiply)
  GroundOverlay.ts         — data model for a georeferenced map
  Tiepoint.ts              — Tiepoint interface + helpers
  GeoidHeight.ts           — EGM96 lookup                                   (planned)

src/io/
  KmzReader.ts             — JSZip + DOMParser → GroundOverlay + image Blob (parseKml is pure)
  KmzWriter.ts             — GroundOverlay + image Blob → JSZip Blob (buildKml is pure)

src/location/
  LocationTracker.ts       — watchPosition wrapper, emits LocationUpdate events
  CompassTracker.ts        — deviceorientation wrapper, emits heading degrees (planned)

src/ui/
  MapView.ts               — main map page, Leaflet map + canvas image overlay
  LocationLayer.ts         — GPS dot, accuracy circle, heading arrow
  ScaleBar.ts              — scale display, updates on zoom                  (planned)
  DetailsPanel.ts          — lat/lon/alt/heading/speed/accuracy panel        (planned)
  MapLibrary.ts            — IndexedDB-backed map list
  LocateControl.ts         — Leaflet control (wa-button) centring the map on the user
  webawesome.ts            — component registration + bundled icon list
  colorScheme.ts / toast.ts
  editor/
    MapEditor.ts           — wizard orchestrator
    ImagePointPicker.ts    — canvas with drag, pinch and wheel zoom; tap to pick pixel
    GeoPointPicker.ts      — Leaflet map, click to pick lat/lon             (planned)
    MapPreview.ts          — image warped over Leaflet for alignment check  (planned)

src/storage/
  MapStore.ts              — IndexedDB wrapper for KMZ blobs
  Prefs.ts                 — localStorage wrapper for settings (last editor map view)
```

Files marked *(planned)* do not exist yet. Known gaps vs. this spec: `GeoToImageConverter`
uses only the first 3 tiepoints (no least-squares fit for 4+ yet), and `KmzReader` does not
read `gx:LatLonQuad`.

---

## Key Decisions

- **Leaflet.js** for the OSM map — lightweight, no API key, broad plugin ecosystem.
- **Web Awesome** (MIT, web components) for all UI chrome — works with plain TypeScript, no framework.
  Icons are bundled **Lucide** SVGs (ISC), not Web Awesome's default Font Awesome CDN.
- **JSZip** for KMZ — reads and writes ZIP in the browser without a server.
- **PDF.js** for PDF source images — rasterizes a selected page to a canvas before tiepointing.
- **Canvas overlay** for the map image — gives full control over rotation and transform; use a
  custom `L.Layer` that redraws on Leaflet's `viewreset` and `move` events.
- **IndexedDB** (via `idb`) for KMZ storage — binary blobs do not fit in localStorage.
- **vite-plugin-pwa** (Workbox) for the service worker — app shell precached, OSM tiles cached on view.

---

## UI / Styling Rules

**Priorities, in order:**
1. **Mobile usability comes first.** Thumb-reachable controls, 44 px tap targets, safe-area
   insets, pinch/pan that works with fingers. Custom CSS is fine when it makes mobile work better.
2. **Lean on the component library.** Use a Web Awesome component, layout utility
   (`wa-stack`, `wa-cluster`, `wa-flank`, `wa-grid`, `wa-list-plain`) or text/color utility before
   writing any CSS. Use HTML attributes (`hidden`, `disabled`) over classes.
3. **Write as little custom CSS as possible.** Every rule in `src/styles.css` should say why the
   library can't do it. Before adding one, check whether an existing rule or utility covers it.

The UI uses **Web Awesome** (`@awesome.me/webawesome`). Its package ships agent-oriented docs:
`node_modules/@awesome.me/webawesome/dist/skills/webawesome/references/components/<name>.md` (component
APIs) and `.../skills/webawesome-design/` (layout, theming). Read the component's reference before styling it.

1. **Register components** you use in `src/ui/webawesome.ts` (they are cherry-picked imports; an
   unregistered `<wa-*>` tag renders as nothing).
2. **Icons**: `<wa-icon name="...">` resolves against the bundled Lucide list in
   `src/ui/webawesome.ts`. Add new names there — never point the library at a CDN.
   Icon-only buttons need `label` on the icon for accessibility.
3. **Colors, spacing, radii, fonts: tokens only** (`--wa-color-surface-*`, `--wa-color-text-*`,
   `--wa-space-*`, …) and utility classes (`wa-stack`, `wa-cluster`, `wa-gap-*`, `wa-heading-*`,
   `wa-body-*`). No hex/px literals — they break dark mode.
4. **Light/dark** follows the OS setting: `index.html` sets `wa-light`/`wa-dark` on `<html>` before first
   paint, `src/ui/colorScheme.ts` tracks changes. In dark mode the OSM tile pane is CSS-inverted
   (`src/styles.css`); never filter the user's map image or GPS layers.
5. Dialogs: `<wa-dialog label="…">` toggled with `.open`. Notifications: `showToast()` in
   `src/ui/toast.ts` (one shared `<wa-toast>`), never `alert()`/`confirm()`.
6. Shared layout classes live in `src/styles.css` (`app-screen`, `app-bar`, `app-content`,
   `action-bar`, `float-*`). Prefer them over new per-screen `<style>` blocks or inline styles.
7. The full-screen Leaflet map is `position: fixed; inset: 0` (`.map-fullscreen`) beneath floating
   controls (`.float-top-start`, `.float-bottom-end`, z-index 1000).
8. Testing: Playwright can't compute accessible names for `wa-dialog`, and its host has no box
   (never "visible"); locate it with `page.locator('wa-dialog[label="…"]')` and assert
   `toHaveAttribute('open')` or the visibility of its content. Buttons work with
   `getByRole('button', { name })`.

**Mobile-first layout**:
- Primary action bar at the bottom (within thumb reach).
- Minimum tap target: 44×44 px.
- `font-size` in `rem` only; never `px` for text.
- Test every screen at 360 px wide portrait (Pixel 10, the owner's phone) — that is the baseline.

---

## Guidelines

- Do not use the Google Maps API anywhere.
- Do not use single-precision floats for coordinate math.
- Do not store binary data in localStorage.
- Call `watchPosition`, `getCurrentPosition` and `requestPermission` only in response to a user
  gesture — or after `geolocationAlreadyGranted()` confirms no prompt will appear.
- The KMZ files the web app writes must also open in the Android app — preserve the schema in
  `docs/KMZ_FORMAT.md` exactly (the Android-format fixture in `src/io/Kml.test.ts` guards it).
- No external requests except OSM tile servers and optional user-provided KMZ URLs.
- When unsure about the KMZ schema or feature behaviour, read `docs/KMZ_FORMAT.md` and `PRD.md`.
- Every change ships with a test (unit or e2e) and `npm run check` passing.

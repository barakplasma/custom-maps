# Custom Maps Web App — Product Requirements Document

## Overview

Custom Maps is a browser-based PWA that lets users georeference any raster image — a hand-drawn
trail map, a building floor plan, a scanned paper map — and use it as a live GPS map. The app uses
OpenStreetMap as its basemap and the browser Geolocation API for live position tracking.

Maps are stored as `.kmz` files (ZIP archives containing an image + a KML document), which is an
established open format compatible with Google Earth and the existing Custom Maps Android app.

---

## Core User Flows

### 1. Load an Existing Map

1. User opens the app and sees their saved map library.
2. User taps "Open file" and picks a `.kmz` file from their device, or pastes a URL to fetch one.
3. The map image is displayed on top of the OpenStreetMap basemap, aligned to the correct
   geographic position.
4. The user's live GPS position appears as a dot with an accuracy circle.
5. A compass heading arrow shows which direction the user is facing.

### 2. Create a New Map

1. User taps "Create map" and picks an image (JPEG, PNG, GIF) or a PDF from their device.
2. For PDF: a page-picker lets the user select which page to use; the page is rasterized.
3. The user places at least 2 **tiepoints** by:
   a. Clicking a recognizable feature on the image.
   b. Clicking the same feature on the OpenStreetMap basemap to record its latitude/longitude.
4. A live preview shows the image warped over the basemap so the user can verify alignment.
5. The user saves the map; the app downloads a `.kmz` file and stores it in the in-browser library.

### 3. Navigate with a Map

- The map image fills the screen. The OSM basemap is visible underneath at low zoom or outside
  the map image boundary.
- Live GPS dot + accuracy circle update continuously.
- Optional "follow mode" keeps the GPS dot centred on screen.
- Optional "map-up" mode rotates the display so the user's heading always points up.
- A scale bar shows the current map scale.
- A details panel shows latitude, longitude, altitude, heading, speed, and GPS accuracy.

---

## Features

### Map Display

- Render the map image as a canvas overlay on a Leaflet/OSM map.
- Support image rotation (some maps are stored at an angle relative to North).
- Pan and pinch-to-zoom with inertia. Mouse wheel zoom on desktop.
- Zoom keeps the focus point (pinch midpoint or mouse pointer) stationary.
- Enforce a minimum zoom so the map image stays visible on screen.

### Live Location

- Use `navigator.geolocation.watchPosition()` with `enableHighAccuracy: true`.
- Draw a filled dot at the user's position and a semi-transparent circle of radius `accuracy` metres.
- When `heading` is available (non-null, user is moving), draw a directional arrow.
- When GPS accuracy exceeds a configurable threshold (default 25 m), the arrow blinks to warn the
  user.
- Compass heading from `deviceorientationabsolute` (or `deviceorientation` fallback) rotates the
  arrow even when stationary. On iOS Safari 13+, prompt the user to grant orientation permission
  before listening to the event.
- Altitude displayed as MSL (GPS reports WGS-84 ellipsoidal height; correct using EGM96 geoid
  offset, ~130 KB binary asset bundled with the app).

### Details Panel

Collapsible panel or bottom sheet showing:

| Field | Source |
|-------|--------|
| Latitude | `coords.latitude` |
| Longitude | `coords.longitude` |
| Altitude (MSL) | `coords.altitude` − EGM96 offset |
| Heading | `coords.heading` or `deviceorientation.alpha` |
| Speed | `coords.speed` converted to user's unit preference |
| Accuracy | `coords.accuracy` in metres |

### Scale Bar

Horizontal bar in the corner showing the current map scale in the user's preferred units (km/m,
mi/ft, or nautical miles). Updates on every zoom change.

### Map Library

- List of saved maps stored in IndexedDB (binary KMZ blobs).
- Show map name and a thumbnail.
- Tap to open; swipe or long-press to delete.
- Import from a `.kmz` file or a remote URL.

### Settings

Stored in `localStorage`:

| Setting | Default | Options |
|---------|---------|---------|
| Distance units | Metric | Metric, Imperial, Nautical |
| GPS accuracy warning threshold | 25 m | User-adjustable |
| Show scale bar | On | On / Off |
| Show details panel | On | On / Off |
| Show distance-to-centre | On | On / Off |
| Last opened map | — | Auto-reopen on launch |

---

## Data Format: KMZ / KML

A `.kmz` file is a ZIP archive:

```
map.kmz
├── doc.kml
└── map.jpg          (or .png / .gif)
```

### KML Schema

```xml
<Document>
  <GroundOverlay>
    <name>My Trail Map</name>
    <Icon><href>map.jpg</href></Icon>

    <!-- Format A: tiepoints (preferred, richer) -->
    <Tiepoint>
      <xpixel>245</xpixel>
      <ypixel>312</ypixel>
      <lat>47.6120</lat>
      <lon>-122.3210</lon>
    </Tiepoint>
    <!-- repeat for each tiepoint; minimum 2 -->

    <!-- Format B: axis-aligned bounding box (simpler maps) -->
    <LatLonBox>
      <north>47.6200</north>
      <south>47.5800</south>
      <east>-122.2900</east>
      <west>-122.3400</west>
      <rotation>-3.5</rotation>   <!-- degrees CW from North; optional -->
    </LatLonBox>
  </GroundOverlay>
</Document>
```

The app must read both formats. When writing a new KMZ it must use `<Tiepoint>` elements.

---

## Coordinate Georeferencing Math

A tiepoint pairs an image pixel `(xPixel, yPixel)` with a geographic coordinate `(lat, lon)`.

Given N ≥ 2 tiepoints, fit an affine transform `A` (3×3, double precision) such that:

```
[lat ]       [xPixel]
[lon ] = A · [yPixel]
[ 1  ]       [  1   ]
```

- With 2 tiepoints: solve analytically (scale + rotation + translation, no shear).
- With 3+ tiepoints: solve the 3×3 linear system exactly (3 points) or via least squares (4+).

The inverse `A⁻¹` maps `(lat, lon)` → `(xPixel, yPixel)` — used to place the GPS dot on the image.

**Important**: use 64-bit floats throughout. Geographic coordinates require full double precision;
single-precision causes visible positioning errors.

---

## Technology Stack

| Concern | Choice |
|---------|--------|
| Map tiles | OpenStreetMap (tile.openstreetmap.org) |
| Map library | Leaflet.js |
| ZIP/KMZ read+write | JSZip |
| PDF rasterization | PDF.js |
| Offline tile cache | Service Worker + Cache API |
| Map/KMZ storage | IndexedDB (`idb` wrapper) |
| Settings | localStorage |
| Build | Vite |
| Language | TypeScript |

---

## PWA Requirements

- Works offline after first load (app shell cached by service worker).
- OSM tiles cached on demand in the service worker; no bulk pre-download required for v1.
- Installable (manifest + service worker) so users can add it to their home screen.
- Lighthouse PWA score ≥ 90.

---

## Out of Scope (v1)

- Server-side storage or user accounts
- KMZ sharing / sync between devices
- Editing or deleting individual tiepoints after initial save
- Offline bulk tile download UI
- Placemark / waypoint display (focus is GroundOverlay maps only)

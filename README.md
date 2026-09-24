# custom-maps

Use almost any map image — a trail map, a campus map, a scanned paper map — as a live GPS map in
your browser. Pin a few points on the image to real-world locations, and Custom Maps overlays it
on OpenStreetMap and shows where you are on it.

Built for current Android and iOS browsers. Install it to your home screen ("Add to Home
Screen" / "Install app") and it works offline, keeps the screen on while tracking, and follows
your device's light/dark setting.

Local-first: no server, no account, no tracking cookies (only anonymous, cookieless Vercel Web Analytics page views). Maps are stored in your browser (IndexedDB) and
can be exported as `.kmz` files that are compatible with Google Earth and the original Custom Maps
Android app.

Share a map as a file, or as a short link (`custom-maps-nu.vercel.app/m/k7p2x9qa`, with a QR code)
that opens it straight in the app. Linked maps are stored publicly on Vercel Blob, kept within the
free tier by upload caps.

Live: <https://custom-maps-nu.vercel.app/>

## Develop

Vite + TypeScript + Leaflet, with [Web Awesome](https://webawesome.com) UI components and
[Lucide](https://lucide.dev) icons.

```sh
npm install
npm run dev          # http://localhost:5173
```

| Command | What it does |
|---|---|
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Vitest unit tests (`src/**/*.test.ts`) |
| `npm run test:e2e` | Playwright smoke tests against the production build at 375 px width |
| `npm run check` | All of the above plus `npm run build` — run before pushing |

First time running e2e tests outside Claude Code on the web: `npx playwright install chromium`.
The iPhone (WebKit) project runs in CI; locally use `npx playwright install webkit` and `PW_WEBKIT=1`.

## Docs

- [`PRD.md`](PRD.md) — product requirements
- [`docs/KMZ_FORMAT.md`](docs/KMZ_FORMAT.md) — the `.kmz` schema and Android compatibility rules
- [`CLAUDE.md`](CLAUDE.md) — architecture and conventions (for humans and AI agents alike)

## History

This project started as the Custom Maps Android app by Marko Teittinen. The Android source has
been removed from this branch of the repo in favour of the web port; it remains available in git
history.

## License

Apache 2.0 — see [`COPYING`](COPYING). `src/core/DMatrix.ts` is additionally covered by
[`Skia-LICENSE.txt`](Skia-LICENSE.txt).

---
name: leaflet-map-feature
description: Add or change a feature on the Custom Maps Leaflet map screen (rotation, controls, overlays, compass/GPS behaviour, Leaflet plugins) and ship it verified on both Android Chrome and iPhone Safari. Use for any change to src/ui/MapView.ts or src/ui/locate.ts, adding a Leaflet plugin, or anything using the phone compass.
---

# Leaflet map feature

The recipe used to add map rotation (PR #7). Background reading: `docs/wiki/`.

## Owner's rules

- **No unit tests.** Verify with e2e specs in `e2e/` and screenshots.
- GPL dependencies are fine.
- Explain new concepts in `docs/wiki/` (one short page per concept, mermaid diagrams, no ASCII art).

## Steps

1. **Library first.** Look for a maintained Leaflet plugin before writing map code. Check its
   license (`npm view <pkg> license`), last release, and peer `leaflet` range. Read its source
   in `node_modules/<pkg>/src` for: global `L` use (fine — Leaflet's UMD sets `window.L`),
   map options it adds, controls it auto-adds via `addInitHook` (these also appear on the
   editor's maps — check they stay hidden there).
2. **Types.** Untyped plugin → `declare module '<pkg>';` in `src/vite-env.d.ts`, and augment
   `leaflet`'s `MapOptions`/`Map` with only the members used, in `src/<pkg>.d.ts`.
3. **Check interplay with what's on the map:**
   - `RotatedImageLayer` (MapView.ts) positions with `latLngToLayerPoint` in `overlayPane`.
   - `leaflet.locatecontrol` (locate.ts) draws the GPS dot and a heading arrow as markers;
     anything that rotates the map must keep the arrow pointing north-relative
     (`compassStyle: { rotateWithView: true }` for leaflet-rotate).
4. **Compass input differs per platform** (`docs/wiki/compass-on-phones.md`):
   Android = `deviceorientationabsolute` with counter-clockwise `alpha`;
   iOS = `deviceorientation` with `webkitCompassHeading`, after
   `DeviceOrientationEvent.requestPermission()` from a tap.
5. **Dark mode.** Plugin controls often carry dark inline SVGs or colours. Fix with the
   smallest rule in `src/styles.css` (e.g. `.wa-dark <selector> { filter: invert(1); }`) and say why.
6. **e2e test** in `e2e/mapview.spec.ts`, reusing `openRotatedMap()`. Fire device events in
   the right shape per `browserName` (`webkit` = iOS), repeatedly inside `expect(...).toPass()`
   since plugins throttle them. Assert on computed CSS (e.g. the rotate pane's `transform`
   matrix → angle), not on internals.
7. **Run both browsers locally** — CI runs WebKit too and an Android-only test will fail there:
   ```sh
   export PLAYWRIGHT_CHROMIUM_EXECUTABLE=/opt/pw-browsers/chromium   # web sessions
   npx playwright install webkit && npx playwright install-deps webkit
   PW_WEBKIT=1 npm run check
   ```
8. **Screenshots** at 360×732, light and dark, before and after the interaction, via a
   throwaway `e2e/zz-shot.spec.ts` (delete before committing). Look at them.
9. Update `CLAUDE.md` (file list line for the touched file) and the relevant `docs/wiki/` page.
10. Commit, push, draft PR with a mermaid diagram of any new state/flow; flag license or
    maintenance risks in the PR body.

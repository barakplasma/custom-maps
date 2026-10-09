# Testing on both phones

CI runs every e2e test twice: **Android Chrome** (Pixel 10, 360 px) and **iPhone Safari**
(WebKit, iPhone SE). Locally only Chrome runs by default, which is how an iPhone-only failure
can reach CI.

## Run the iPhone tests locally (Linux / Claude Code on the web)

```sh
npx playwright install webkit
npx playwright install-deps webkit     # system libraries; needs root, ~2 min
PW_WEBKIT=1 npm run test:e2e
```

In a Claude Code web session, also set the Chromium path if the SessionStart hook didn't:
`export PLAYWRIGHT_CHROMIUM_EXECUTABLE=/opt/pw-browsers/chromium`.

## Look at it, don't guess

For any visual change take screenshots at 360 × 732 in **both** colour schemes and look at
them. Rotation bugs (wrong direction, image drifting off the tiles, invisible arrow in dark
mode) are obvious in a picture and invisible in the DOM.

```mermaid
flowchart LR
  change[UI change] --> e2e[e2e test in e2e/*.spec.ts]
  e2e --> chrome[Chrome locally]
  e2e --> webkit["WebKit locally<br/>(PW_WEBKIT=1)"]
  change --> shots[screenshots light + dark]
  chrome & webkit & shots --> push[push → CI runs both]
```

A throwaway screenshot spec (delete it before committing) is the quickest way: open the map,
`page.screenshot({ path })`, then `browser.newContext({ colorScheme: 'dark' })` for the second.

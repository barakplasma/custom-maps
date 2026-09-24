import { defineConfig, devices } from '@playwright/test';

// Runs against the production build (`vite preview`) on current phone browsers.
// CI installs Chromium and WebKit; locally, WebKit runs if it is installed
// (`npx playwright install webkit`) and PW_WEBKIT=1 is set.
// PLAYWRIGHT_CHROMIUM_EXECUTABLE points at a preinstalled Chromium when the bundled
// one isn't downloaded (Claude Code cloud sessions set it in the SessionStart hook).
const withWebKit = !!process.env.CI || !!process.env.PW_WEBKIT;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: 'http://localhost:4173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    // A service worker would serve cached tiles/app shell and bypass page.route stubs
    serviceWorkers: 'block',
  },
  projects: [
    {
      name: 'android-chrome',
      use: {
        ...devices['Pixel 10'],
        launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE },
      },
    },
    ...(withWebKit ? [{ name: 'iphone-safari', use: { ...devices['iPhone SE (3rd gen)'] } }] : []),
  ],
  webServer: {
    command: 'npm run build && npm run preview -- --port 4173 --strictPort',
    url: 'http://localhost:4173',
    // Never reuse: a leftover server on :4173 would silently test a stale build
    reuseExistingServer: false,
    timeout: 120_000,
    // Link sharing on, pointing at a fake store that the tests stub with page.route
    env: { MAPS_URL: 'https://maps.test/' },
  },
});

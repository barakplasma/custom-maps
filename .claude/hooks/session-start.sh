#!/bin/bash
# Installs app dependencies so `npm test` / `npm run test:e2e` work immediately
# in Claude Code on the web, and points Playwright at the preinstalled Chromium.
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "$CLAUDE_PROJECT_DIR"
npm install --no-audit --no-fund

if [ -x /opt/pw-browsers/chromium ] && [ -n "${CLAUDE_ENV_FILE:-}" ]; then
  echo "export PLAYWRIGHT_CHROMIUM_EXECUTABLE=/opt/pw-browsers/chromium" >> "$CLAUDE_ENV_FILE"
fi

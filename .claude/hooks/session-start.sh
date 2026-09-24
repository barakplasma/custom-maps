#!/bin/bash
# Installs web app dependencies so `npm test` / `npm run test:e2e` work immediately
# in Claude Code on the web. Chromium for Playwright is preinstalled there.
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "$CLAUDE_PROJECT_DIR/web"
npm install --no-audit --no-fund

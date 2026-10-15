#!/usr/bin/env bash
# Anila Web — desktop launcher (standalone window, no external browser).
#
# Runs the app inside its own Electron window. Only this script + Node.js 18+ are
# needed; the first run downloads the bundled Electron binary via npm.
#
# Usage:
#   ./start-desktop.sh          # open the desktop app (serves on 127.0.0.1:8789)
#   ANILA_PORT=8787 ./start-desktop.sh              # use a different fixed port
#   ANILA_DESKTOP_NO_SANDBOX=1 ./start-desktop.sh   # containers/VMs that block sandbox
#   ANILA_DESKTOP_DEBUG=1 ./start-desktop.sh        # log OAuth navigation for sign-in issues
#   ANILA_DISCORD_CLIENT_ID=1234... ./start-desktop.sh   # override the Discord app id
#
# Discord Rich Presence is baked in with a fixed Application ID. It is not
# configurable in the UI; for development you can override it via
# ANILA_DISCORD_CLIENT_ID. The optional RPC library is installed automatically on
# first run.
#
# The app always uses the same port so its origin — and therefore your saved
# AniList login, settings, library and progress — persist between launches.
# Only if that port is busy does it fall back to a random one (login won't
# persist that session).
#
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DESKTOP="$DIR/desktop"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js (>=18) is required. Install it from https://nodejs.org/ and retry." >&2
  exit 1
fi

if [[ ! -x "$DESKTOP/node_modules/.bin/electron" ]]; then
  echo "First run: installing Electron…"
  (cd "$DESKTOP" && npm install --no-audit --no-fund)
elif [[ ! -d "$DESKTOP/node_modules/@xhayper/discord-rpc" ]]; then
  echo "Installing optional Discord Rich Presence library…"
  (cd "$DESKTOP" && npm install --no-audit --no-fund @xhayper/discord-rpc@^1.5.1) ||
    echo "  (skipped — Discord Rich Presence will be unavailable)" >&2
fi

export ANILA_DESKTOP_NO_SANDBOX="${ANILA_DESKTOP_NO_SANDBOX:-}"
(cd "$DESKTOP" && exec ./node_modules/.bin/electron .)
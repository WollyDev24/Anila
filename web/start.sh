#!/usr/bin/env bash
# Anila Web — local launcher.
#
# Usage:
#   ./start.sh                 # http://127.0.0.1:8787
#   ./start.sh --port 8080     # custom port
#   ./start.sh --port 80       # enables automatic AniList OAuth redirect
#   ./start.sh --lan           # bind 0.0.0.0 so other devices on your network can connect
#
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PORT="${PORT:-8787}"
HOST="127.0.0.1"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --port)
      PORT="${2:?--port needs a value}"
      shift 2
      ;;
    --port=*)
      PORT="${1#*=}"
      shift
      ;;
    --lan)
      HOST="0.0.0.0"
      shift
      ;;
    -h|--help)
      grep '^#' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      exit 1
      ;;
  esac
done

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js (>=18) is required. Install it from https://nodejs.org/ and retry." >&2
  exit 1
fi

NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [[ "$NODE_MAJOR" -lt 18 ]]; then
  echo "Node.js 18 or newer is required (found $(node -v))." >&2
  exit 1
fi

echo "Starting Anila Web on http://${HOST}:${PORT} ..."
PORT="$PORT" HOST="$HOST" node "$DIR/server/server.mjs"

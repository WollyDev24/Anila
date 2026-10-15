# Anila Web

A locally-hosted web client for [Anila](https://github.com/), the Kotlin/Compose
anime app. Vanilla JS frontend + a dependency-free Node.js server that proxies
AniList and streaming providers, so no build step or npm install is required.

## Run

Requirements: **Node.js 18+** (no other dependencies — hls.js is vendored under
`public/vendor/`).

```bash
cd web
./start.sh              # http://127.0.0.1:8787
./start.sh --port 80    # automatic AniList sign-in (uses http://localhost redirect)
./start.sh --port 8080  # any custom port
./start.sh --lan        # bind 0.0.0.0 so other devices on your LAN can connect
```

Open the printed URL.

## Download prebuilt binaries

Prebuilt installers are built by GitHub Actions (see
[`.github/workflows/build-desktop.yml`](../.github/workflows/build-desktop.yml))
and attached to [Releases](https://github.com/WollyDev24/Anila/releases):

- **Linux** — `Anila-<version>.AppImage` (portable, `chmod +x` and run) or
  `anila-desktop_<version>_amd64.deb` (install with your package manager).
- **Windows** — `Anila Setup <version>.exe` (installer; per-user, choose the
  install folder).
- **macOS** — `Anila-<version>.dmg` (unsigned: on first launch, right-click →
  Open, or allow it in System Settings → Privacy & Security).

To build them yourself instead of using the launcher:

```bash
cd web/desktop
npm install
npm run build:linux   # or build:win / build:mac (mac requires macOS)
# output: web/desktop/release/
```

`npm run pack` produces an unpacked app in `release/` for quick local testing.
The packaged app bundles the Node server and static assets as extra resources
(`resources/server`, `resources/public`), so it runs standalone.

## Desktop app (standalone window)

Run Anila in its own window — no external browser needed. It launches the same
Node server in-process and shows it inside an [Electron](https://www.electronjs.org/)
window, so all provider proxying and AniList sign-in behave exactly like the
browser version.

```bash
cd web
./start-desktop.sh
```

- First run downloads the bundled Electron binary (via `npm install`, automatic).
- Everything else is unchanged — local data lives in the app's `localStorage`.
- The app always serves on the same port (`127.0.0.1:8789`), so its origin is
  stable and your **AniList login, settings, library and progress persist**
  between launches. (A random port would change the origin each run and reset
  them.) If that port is busy it falls back to a random one for that session.
- Optional env vars (prefix to `./start-desktop.sh`):
  - `ANILA_PORT=8787` — use a different fixed port.
  - `ANILA_DESKTOP_NO_SANDBOX=1` — for containers/VMs whose kernel blocks Chromium's sandbox.
  - `ANILA_DESKTOP_GPU=0` — disable hardware acceleration (some virtual machines).
  - `ANILA_DESKTOP_DEBUG=1` — log OAuth navigations and renderer console.
  - `ANILA_DISCORD_CLIENT_ID=123…` — override the built-in Discord Application ID for Rich Presence.

Source lives in `web/desktop/` (`main.mjs`, `preload.cjs`, `electron` dev
dependency). AniList's OAuth redirect to `http://localhost` is intercepted and
played back against the app's own origin so the token lands where the rest of
the app reads it.

### Prebuilt binaries

Installable builds are produced by CI (`.github/workflows/build-desktop.yml`):

- **Linux** — `.AppImage` (portable; `chmod +x` and run) and `.deb`.
- **Windows** — NSIS installer (`.exe`).
- **macOS** — `.dmg` (unsigned; right-click → *Open* the first time).

Download the latest from the **Releases** page, or trigger the workflow manually
(*Actions → Build desktop binaries → Run workflow*) and grab the artifacts. To
build locally for your current OS:

```bash
cd web/desktop
npm install
npm run build          # current OS; or build:linux / build:win / build:mac
```

Output lands in `web/desktop/release/`. macOS packages can only be built on
macOS.

### Discord Rich Presence (desktop)

The desktop app can show what you're doing on your Discord profile. The first
line, **"Watching Anila"**, comes from the Discord application's name; the two
lines under it are ours — **"Anila"** followed by what you're doing, e.g.
*Watching Frieren · Episode 5 · 12:04 / 24:00*, with the cover art.

Rich Presence is on by default — toggle it under **Settings → Discord Rich
Presence**. The status line shows `Connected` once the Discord desktop app is
running.

Anila's Application ID is baked in, so there is nothing to configure. For
development you can point it at your own Discord app instead with
`ANILA_DISCORD_CLIENT_ID=123… ./start-desktop.sh`. The optional
`@xhayper/discord-rpc` library is installed on first run; if it's missing,
presence stays off and the rest of the app works normally. Rich Presence requires
the Discord desktop app to be running; if it isn't, Anila keeps retrying and
connects when it appears.

## Features

- **Home** — trending, recently aired, popular, movies, top-rated rails + hero
  carousel, and a "Continue watching" rail from local progress.
- **Browse / Search** — filters (genre, year, format, status, score) and sorting;
  deep links like `#/search?q=one+piece` and `#/browse?genre=Comedy`.
- **Details** — synopsis, stats, related rail, save locally, add to your AniList
  list.
- **Watch** — HLS playback via [hls.js](https://github.com/video-dev/hls.js),
  provider/episode picker, sub/dub tabs, subtitles, skip intro/outro, autoplay
  next, resume position.
- **Schedule** — next week of airing episodes grouped by day.
- **Library** — AniList lists *or* a local-only mode ("Save" hearts).
- **Settings** — AniList sign-in, provider preference (Miruro pipes, AniBD,
  Senshi), playback toggles, subtitle language, adult-content filter, Discord
  Rich Presence (desktop).

## AniList sign-in

AniList authenticates API requests with an **OAuth bearer token** — it does not
use cookies for the API (the browser session cookie is HttpOnly and only works
on the anilist.co website, so it can't be used here). Anila uses AniList's
implicit grant, whose registered redirect is `http://localhost`.

**Desktop app (recommended):** one click.

1. **Settings → Sign in with AniList**.
2. A window opens at AniList — approve access.
3. You're signed in automatically. The wrapper captures the redirect for you.

**Browser:**

- Easiest: run the server on port 80 so the redirect lands back in the app:
  ```bash
  sudo ./start.sh --port 80
  ```
- Otherwise click **Sign in with AniList**, approve, and you'll land on
  `http://localhost/#access_token=…`. That page is blank/fails to load (nothing
  is listening on port 80) — that's expected. Copy the whole address bar into
  the paste box; the token is read and stripped automatically.

If desktop sign-in doesn't complete, run the launcher with navigation logging to
see exactly what the OAuth window does:

```bash
ANILA_DESKTOP_DEBUG=1 ./start-desktop.sh
```

It prints each navigation of the sign-in window (`[oauth] nav: …`), the captured
redirect (`[oauth] redirect captured: …`), any AniList error
(`[oauth] AniList returned an error: …`), and the renderer console (`[renderer] …`).

## How it works

| Route | Purpose |
| --- | --- |
| `GET /` … | Static files from `public/` |
| `POST /api/anilist` | Forwards GraphQL to `https://graphql.anilist.co` |
| `POST /api/episodes` | Episode lists from the configured providers |
| `POST /api/sources` | Resolves a specific episode to streams/subtitles/skip times |
| `GET /api/media?url=…` | Reverse proxy for HLS manifests/segments; rewrites child URIs and injects Referer/Origin |

The server never stores your AniList token; it is kept in `localStorage` and
sent only as a bearer header through the `/api/anilist` proxy.

## Providers

- **Miruro** (`bonk`, `kiwi`, `pewe`, `bee`, `ally`, `moo`, `hop` …) — the
  private "pipe" API. Messages are base64url + optional XOR + gzip, and CDN
  tokens are bound to the IP that requested them.
- **AniBD** (`anibd`) — says it needs a token; currently still exposes full
  episode lists and playable HLS + WebVTT subtitles from its player pages.
- **Senshi** (`senshi`) — catalog/embeds; best-effort, may be unreachable.

### ⚠️ Residential IP required

Cloudflare-protected origins (Miruro `*.to/.bz/.ru`, AniBD CDN
`play.anien.top`) block datacenter IPs, so playback **will not work from a VPS
or cloud shell**. Run this on your home network — the HTTP proxy keeps the
provider requests coming from your IP while the browser can stay on any
origin-independent setup. If a source fails, the watch page lists each
provider's error so you know which one to avoid.

## Local data

Stored in browser `localStorage` under the `anila.*` keys:
settings, library (local saves), progress (episodes + resume position for the
Continue-watching rail), token, viewer profile, search history. Clearing site
data resets everything (your AniList account is unaffected).

## Development

No build step. Edit `public/` and restart the server. Run
`node --check` on any file you change to catch syntax errors. The frontend is
plain ES modules; views live in `public/js/views/` and register nothing —
`app.js` imports each view module and routes by hash. See `server/providers/`
for how each provider is resolved.
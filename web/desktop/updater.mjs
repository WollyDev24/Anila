// Anila desktop — update checking and installation.
//
// Two engines, one state machine:
//
//   • electron-updater (bundled with the app) checks the GitHub release feed and
//     downloads the new build in the background. It can install in place on
//     Windows (NSIS) and Linux AppImage builds — the platforms where updates can
//     be applied without code signing.
//   • A lightweight GitHub Releases API check backs everything else (macOS,
//     Linux .deb, dev builds). It only reports availability; the user downloads
//     the new build from the release page.
//
// This module deliberately imports nothing from Electron so its version logic
// can be unit-tested in plain Node. The Electron wiring is injected by main.mjs.
import {
  normalizeVersion,
  releaseUrlFor,
  isNewerVersion,
  REPO_OWNER,
  REPO_NAME,
  RELEASES_PAGE,
} from "./updater-version.mjs";

export { compareVersions, isNewerVersion, normalizeVersion, releaseUrlFor } from "./updater-version.mjs";
export { REPO_OWNER, REPO_NAME, RELEASES_PAGE } from "./updater-version.mjs";

// Kept as an "idle" baseline; every field the renderer reads lives here so the
// UI never has to guard against missing keys.
export const INITIAL_STATE = Object.freeze({
  currentVersion: "",
  status: "idle", // idle | checking | available | downloading | downloaded | up-to-date | error
  version: null,
  releaseUrl: null,
  notes: "",
  canAutoInstall: false,
  percent: 0,
  message: null,
  checkedAt: null,
});

// Query GitHub for the newest published (non-prerelease) release. Uses global
// fetch so it works in both Electron and plain Node ≥18.
export async function fetchLatestRelease({
  fetchImpl = globalThis.fetch,
  owner = REPO_OWNER,
  repo = REPO_NAME,
  timeoutMs = 8000,
} = {}) {
  if (typeof fetchImpl !== "function") throw new Error("fetch is unavailable");
  const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    const res = await fetchImpl(`https://api.github.com/repos/${owner}/${repo}/releases/latest`, {
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "Anila-Updater",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      signal: controller ? controller.signal : undefined,
    });
    if (!res.ok) throw new Error(`GitHub responded ${res.status}`);
    const data = await res.json();
    return {
      version: normalizeVersion(data.tag_name || data.name || ""),
      url: data.html_url || RELEASES_PAGE,
      notes: typeof data.body === "string" ? data.body : "",
      publishedAt: data.published_at || null,
    };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function createUpdater({
  currentVersion = "",
  canAutoUpdate = false,
  openExternal = () => {},
  loadAutoUpdater = async () => null,
  fetchLatest = () => fetchLatestRelease(),
  send = () => {},
  log = () => {},
  now = () => Date.now(),
} = {}) {
  let state = { ...INITIAL_STATE, currentVersion };
  let autoUpdater = null;
  let wired = false;
  let inFlight = null;

  function broadcast() {
    try {
      send({ ...state });
    } catch (err) {
      log(`updates: state broadcast failed (${err?.message || err})`);
    }
  }

  function setState(patch) {
    state = { ...state, ...patch };
    broadcast();
  }

  function wireAutoUpdater(au) {
    if (wired) return;
    wired = true;
    au.autoDownload = true;
    au.autoInstallOnAppQuit = true;

    au.on("checking-for-update", () => setState({ status: "checking", message: null }));
    au.on("update-available", (info) => {
      const version = normalizeVersion(info?.version || "");
      setState({
        status: "available",
        version,
        releaseUrl: releaseUrlFor(version),
        canAutoInstall: true,
        percent: 0,
        message: null,
        checkedAt: now(),
      });
    });
    au.on("update-not-available", () =>
      setState({
        status: "up-to-date",
        version: currentVersion,
        canAutoInstall: false,
        message: null,
        checkedAt: now(),
      }),
    );
    au.on("download-progress", (p) =>
      setState({
        status: "downloading",
        percent: Math.max(0, Math.min(100, Math.round(Number(p?.percent) || 0))),
      }),
    );
    au.on("update-downloaded", (info) => {
      const version = normalizeVersion(info?.version || state.version || "");
      setState({
        status: "downloaded",
        version,
        canAutoInstall: true,
        percent: 100,
        message: null,
        checkedAt: now(),
      });
    });
    au.on("error", (err) => {
      const message = err?.message ? String(err.message) : "Update error";
      // An error after a successful download shouldn't undo the "ready" state.
      if (state.status === "downloaded") {
        log(`updates: ${message}`);
        return;
      }
      setState({ status: "error", message, checkedAt: now() });
    });
  }

  async function getAutoUpdater() {
    if (autoUpdater) return autoUpdater;
    const au = await loadAutoUpdater();
    if (!au) return null;
    autoUpdater = au;
    wireAutoUpdater(au);
    return au;
  }

  async function githubCheck() {
    let latest;
    try {
      latest = await fetchLatest();
    } catch (err) {
      setState({
        status: "error",
        message: `Could not check for updates (${err?.message || err})`,
        checkedAt: now(),
      });
      return { ...state };
    }
    const version = normalizeVersion(latest?.version || "");
    if (!version) {
      setState({ status: "error", message: "Could not read the latest version.", checkedAt: now() });
      return { ...state };
    }
    if (!isNewerVersion(version, currentVersion)) {
      setState({
        status: "up-to-date",
        version: currentVersion,
        releaseUrl: latest?.url || RELEASES_PAGE,
        canAutoInstall: false,
        message: null,
        checkedAt: now(),
      });
      return { ...state };
    }
    setState({
      status: "available",
      version,
      releaseUrl: latest?.url || releaseUrlFor(version),
      notes: latest?.notes || "",
      canAutoInstall: false,
      percent: 0,
      message: null,
      checkedAt: now(),
    });
    return { ...state };
  }

  async function check() {
    if (inFlight) return inFlight;
    setState({ status: "checking", message: null, percent: 0 });
    inFlight = (async () => {
      try {
        if (canAutoUpdate) {
          try {
            const au = await getAutoUpdater();
            if (au) {
              await au.checkForUpdates();
              return { ...state };
            }
          } catch (err) {
            log(`updates: electron-updater check failed (${err?.message || err}); using GitHub fallback`);
          }
        }
        return await githubCheck();
      } finally {
        inFlight = null;
      }
    })();
    return inFlight;
  }

  function openRelease(url) {
    const target = url || state.releaseUrl || RELEASES_PAGE;
    try {
      openExternal(target);
    } catch (err) {
      log(`updates: openExternal failed (${err?.message || err})`);
    }
  }

  // Quit and install the downloaded update; on platforms without in-place
  // updates (or before a download finished) fall back to the release page.
  function install() {
    if (state.status === "downloaded" && state.canAutoInstall) {
      try {
        autoUpdater?.quitAndInstall();
        return;
      } catch (err) {
        log(`updates: quitAndInstall failed (${err?.message || err})`);
      }
    }
    openRelease(state.releaseUrl);
  }

  return {
    getState: () => ({ ...state }),
    check,
    install,
    openRelease,
    canAutoUpdate,
  };
}

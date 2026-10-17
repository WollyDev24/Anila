// Anila desktop auto-update glue (renderer side).
//
// Talks to the desktop wrapper over IPC (see web/desktop/preload.cjs). Every
// function is a safe no-op in the browser, where window.desktop.updates does not
// exist, so the Settings view can call it unconditionally.

const FALLBACK_STATE = Object.freeze({
  currentVersion: "",
  status: "idle",
  version: null,
  releaseUrl: null,
  notes: "",
  canAutoInstall: false,
  percent: 0,
  message: null,
  checkedAt: null,
});

function api() {
  return (typeof window !== "undefined" && window.desktop && window.desktop.updates) || null;
}

export function updatesAvailable() {
  return !!api();
}

function merge(state) {
  return { ...FALLBACK_STATE, ...(state || {}) };
}

export async function getUpdateState() {
  const u = api();
  if (!u) return { ...FALLBACK_STATE };
  try {
    return merge(await u.getState());
  } catch {
    return { ...FALLBACK_STATE };
  }
}

export async function checkForUpdates() {
  const u = api();
  if (!u) return { ...FALLBACK_STATE };
  try {
    return merge(await u.check());
  } catch {
    return { ...FALLBACK_STATE, status: "error", message: "Could not check for updates." };
  }
}

export function installUpdate() {
  api()?.install();
}

export function openRelease(url) {
  api()?.openRelease(url);
}

export function onUpdateStatus(cb) {
  const u = api();
  if (!u) return () => {};
  return u.onStatus((state) => cb(merge(state)));
}

// ---- presentation helpers (pure; unit-tested) ----

export function updateStatusText(state = {}) {
  const v = state.version ? `Anila v${state.version}` : "An update";
  switch (state.status) {
    case "checking":
      return "Checking for updates…";
    case "available":
      return state.canAutoInstall
        ? `Downloading ${v}…`
        : `${v} is available — download it from the release page.`;
    case "downloading":
      return `Downloading ${v}… ${state.percent || 0}%`;
    case "downloaded":
      return `${v} is ready — restart to finish.`;
    case "up-to-date":
      return `You're on the latest version${state.currentVersion ? ` (v${state.currentVersion})` : ""}.`;
    case "error":
      return state.message || "Could not check for updates.";
    default:
      return "";
  }
}

export function updateActions(state = {}) {
  const status = state.status || "idle";
  return {
    check: status === "idle" || status === "up-to-date" || status === "error" || (status === "available" && !state.canAutoInstall),
    download: status === "available" && !state.canAutoInstall,
    install: status === "downloaded",
    progress: status === "downloading",
  };
}

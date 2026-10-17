// Discord Rich Presence glue (renderer side).
//
// Builds the "activity" payload from the current route / media / playback and
// hands it to the desktop wrapper over IPC. Everything no-ops in the browser,
// where window.desktop.discord does not exist.
import { getSettings } from "./store.js";

const MAX_TEXT = 128;
const MAX_IMAGE = 256;

function api() {
  return (typeof window !== "undefined" && window.desktop && window.desktop.discord) || null;
}

// The Settings window is secondary chrome: it must never clobber the activity
// the main window is broadcasting.
function secondaryWindow() {
  return typeof window !== "undefined" && !!window.desktop && window.desktop.isSettingsWindow === true;
}

export function discordAvailable() {
  return !!api();
}

function clip(value, max = MAX_TEXT) {
  if (value == null) return undefined;
  const s = String(value);
  if (!s) return undefined;
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

function imageUrl(url) {
  if (!url) return undefined;
  const s = String(url);
  return s.length <= MAX_IMAGE ? s : undefined;
}

function formatTime(seconds) {
  const s = Math.max(0, Math.floor(Number(seconds) || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = h ? String(m).padStart(2, "0") : String(m);
  const ss = String(sec).padStart(2, "0");
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

// Discord shows "Playing <application name>" on the first line; that name comes
// from the Discord app you register, so name it "Anila". The two text lines
// below are ours: details is always "Anila", state is what you're doing.
const APP_NAME = "Anila";

// Discord activity type 3 = "Watching", so the header reads "Watching Anila"
// instead of the default "Playing Anila". (ActivityType: 0 Playing, 1 Streaming,
// 2 Listening, 3 Watching, 4 Custom, 5 Competing.)
const ACTIVITY_TYPE = 3;

// Fixed once at module load and reused for every navigation/detail activity.
// Without an explicit startTimestamp Discord starts a fresh elapsed timer each
// time the activity changes, so switching pages would reset the clock. Pinning
// it to a stable point in the past keeps the counter running across pages.
const SESSION_START = Date.now();

// ---- pure builders (unit-tested) ----

export function routeActivity(route, params = {}) {
  let state;
  switch (route) {
    case "browse":
      state = params.genre ? `Browsing · ${params.genre}` : "Browsing";
      break;
    case "search":
      state = params.q ? `Searching · ${params.q}` : "Searching";
      break;
    case "schedule":
      state = "Airing schedule";
      break;
    case "library":
      state = "My library";
      break;
    case "settings":
      state = "Settings";
      break;
    case "profile":
      state = "Profile";
      break;
    case "anime":
      state = "Looking at an anime";
      break;
    case "watch":
      state = "Picking an episode";
      break;
    case "home":
    default:
      state = "Browsing home";
      break;
  }
  return { type: ACTIVITY_TYPE, details: APP_NAME, state: clip(state), startTimestamp: SESSION_START };
}

export function viewingActivity({ title, cover, url } = {}) {
  const activity = {
    type: ACTIVITY_TYPE,
    details: APP_NAME,
    state: clip(`Viewing ${title || "an anime"}`),
    startTimestamp: SESSION_START,
  };
  const img = imageUrl(cover);
  if (img) {
    activity.largeImageKey = img;
    activity.largeImageText = clip(title);
  }
  if (url) activity.buttons = [{ label: "View on AniList", url: String(url) }];
  return activity;
}

export function watchingActivity({
  title,
  cover,
  url,
  episode,
  position = 0,
  duration = 0,
  paused = false,
} = {}) {
  const ep = episode != null && episode !== "" ? `Episode ${episode}` : null;
  const progress = duration > 0 ? `${formatTime(position)} / ${formatTime(duration)}` : null;
  const stateParts = [paused ? "Paused" : null, ep].filter(Boolean);
  const state = stateParts.length ? clip(stateParts.join(" · ")) : paused ? "Paused" : undefined;

  const activity = { type: ACTIVITY_TYPE, details: clip(title || "Anime"), state };


  const img = imageUrl(cover);
  if (img) {
    activity.largeImageKey = img;
    activity.largeImageText = clip(title);
  }

  if (!paused) {
    const now = Date.now();
    const start = now - Math.max(0, position) * 1000;
    activity.startTimestamp = start;
    if (duration > 0) activity.endTimestamp = start + duration * 1000;
  }

  if (url) activity.buttons = [{ label: "View on AniList", url: String(url) }];
  return activity;
}

// ---- runtime glue ----

let routeAct = null;
let richAct = null;
let lastSent = "";

function effectiveActivity() {
  return richAct || routeAct;
}

function send(activity) {
  const d = api();
  if (!d || secondaryWindow()) return;
  const payload = activity ? JSON.stringify(activity) : "";
  if (payload === lastSent) return;
  lastSent = payload;
  if (activity) d.setActivity(activity);
  else d.clear();
}

function refresh() {
  send(effectiveActivity());
}

// Router calls this on every navigation; it clears any per-view override.
export function setRouteActivity(route, params) {
  routeAct = routeActivity(route, params);
  richAct = null;
  refresh();
}

// Detail / watch views call this for a richer presence.
export function setRichActivity(activity) {
  richAct = activity || null;
  refresh();
}

export function clearPresence() {
  routeAct = null;
  richAct = null;
  lastSent = "";
  const d = api();
  if (d) d.clear();
}

// Push the current settings to the desktop wrapper.
export function applyDiscordConfig() {
  const d = api();
  if (!d) return;
  const enabled = getSettings().discordRpc !== false;
  const clientId = String(d.defaultClientId || "").trim();
  d.configure({ enabled, clientId });
}

export function onDiscordStatus(cb) {
  const d = api();
  if (!d) {
    cb("unavailable");
    return () => {};
  }
  return d.onStatus(cb);
}

export async function getDiscordStatus() {
  const d = api();
  if (!d) return "unavailable";
  try {
    const info = await d.getStatus();
    return info?.supported === false ? "unavailable" : info?.status || "disabled";
  } catch {
    return "unavailable";
  }
}

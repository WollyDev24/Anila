// Local persistence: settings, library, watch progress, and the AniList token.

const KEYS = {
  settings: "anila.settings",
  library: "anila.library",
  progress: "anila.progress",
  token: "anila.token",
  viewer: "anila.viewer",
  searchHistory: "anila.searchHistory",
  sidebarCollapsed: "anila.sidebarCollapsed",
};

export const DEFAULT_SETTINGS = {
  hideAdult: true,
  preferredProvider: "bonk",
  fallbackProviders: [],
  autoplayNext: true,
  skipIntro: true,
  skipOutro: false,
  subtitleLanguage: "en",
  discordRpc: true,
};

function read(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* ignore quota errors */
  }
}

const listeners = new Set();
export function onChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
function emit() {
  for (const fn of listeners) fn();
}

// ---------- settings ----------
let settings = { ...DEFAULT_SETTINGS, ...read(KEYS.settings, {}) };
export function getSettings() {
  return settings;
}
export function setSetting(key, value) {
  settings = { ...settings, [key]: value };
  write(KEYS.settings, settings);
  emit();
}

// ---------- token / viewer ----------
export function getToken() {
  const token = localStorage.getItem(KEYS.token);
  if (!token) return null;
  try {
    const payload = JSON.parse(atob(token.split(".")[1] || ""));
    if (payload.exp && payload.exp * 1000 < Date.now()) {
      clearToken();
      return null;
    }
    return token;
  } catch {
    return token;
  }
}
export function setToken(token) {
  localStorage.setItem(KEYS.token, token);
  emit();
}
export function clearToken() {
  localStorage.removeItem(KEYS.token);
  localStorage.removeItem(KEYS.viewer);
  emit();
}
export function getViewer() {
  return read(KEYS.viewer, null);
}
export function setViewer(viewer) {
  write(KEYS.viewer, viewer);
  emit();
}

// ---------- library (saved anime) ----------
let library = read(KEYS.library, {});

function libraryKey(media) {
  return String(media.id || media.mediaId || media.idMal);
}

export function getLibrary() {
  return library;
}
export function isSaved(media) {
  return Boolean(library[libraryKey(media)]);
}
export function toggleSaved(media) {
  const key = libraryKey(media);
  let saved;
  if (library[key]) {
    delete library[key];
    saved = false;
  } else {
    library[key] = {
      id: media.id,
      idMal: media.idMal,
      title: media.title,
      coverImage: media.coverImage,
      bannerImage: media.bannerImage,
      format: media.format,
      seasonYear: media.seasonYear,
      episodes: media.episodes,
      addedAt: Date.now(),
    };
    saved = true;
  }
  write(KEYS.library, library);
  emit();
  return saved;
}

// ---------- progress ----------
let progress = read(KEYS.progress, {});

export function getProgress(mediaId) {
  return progress[String(mediaId)] || null;
}
export function getContinueWatching() {
  return Object.values(progress)
    .filter((p) => p && p.mediaId)
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}
export function setProgress(mediaId, entry) {
  progress[String(mediaId)] = {
    ...(progress[String(mediaId)] || {}),
    mediaId,
    updatedAt: Date.now(),
    ...entry,
  };
  write(KEYS.progress, progress);
  emit();
}
export function removeProgress(mediaId) {
  delete progress[String(mediaId)];
  write(KEYS.progress, progress);
  emit();
}

// ---------- search history ----------
export function getSearchHistory() {
  return read(KEYS.searchHistory, []);
}
export function pushSearchHistory(term) {
  const term2 = String(term || "").trim();
  if (!term2) return;
  const list = getSearchHistory().filter((t) => t !== term2);
  list.unshift(term2);
  write(KEYS.searchHistory, list.slice(0, 12));
}

// ---------- ui preferences ----------
export function getSidebarCollapsed() {
  return read(KEYS.sidebarCollapsed, false) === true;
}
export function setSidebarCollapsed(collapsed) {
  write(KEYS.sidebarCollapsed, Boolean(collapsed));
}

// Keep cached state fresh when another window (e.g. the desktop Settings
// window) writes to localStorage. The storage event only fires cross-window,
// so this never re-triggers for the writer.
if (typeof window !== "undefined" && window.addEventListener) {
  window.addEventListener("storage", (event) => {
    if (!event || !event.key || !event.key.startsWith("anila.")) return;
    if (event.key === KEYS.settings) settings = { ...DEFAULT_SETTINGS, ...read(KEYS.settings, {}) };
    else if (event.key === KEYS.library) library = read(KEYS.library, {});
    else if (event.key === KEYS.progress) progress = read(KEYS.progress, {});
    emit();
  });
}

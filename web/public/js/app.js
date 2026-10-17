import * as home from "./views/home.js";
import * as browse from "./views/browse.js";
import * as detail from "./views/detail.js";
import * as watch from "./views/watch.js";
import * as schedule from "./views/schedule.js";
import * as library from "./views/library.js";
import * as profile from "./views/profile.js";
import * as downloads from "./views/downloads.js";
import * as settings from "./views/settings.js";
import { escapeHtml, toast } from "./ui.js";
import { initRailFades } from "./rail-fade.js";
import {
  getToken,
  getViewer,
  clearToken,
  pushSearchHistory,
  getSidebarCollapsed,
  setSidebarCollapsed,
  onChange,
} from "./store.js";
import { captureRedirectToken } from "./oauth.js";
import { setRouteActivity, applyDiscordConfig } from "./presence.js";
import { updatesAvailable, getUpdateState, onUpdateStatus } from "./updates.js";

const view = document.getElementById("view");
const searchForm = document.getElementById("searchForm");
const searchInput = document.getElementById("searchInput");
const accountBtn = document.getElementById("accountBtn");
const accountMenu = document.getElementById("accountMenu");
const accountMenuHead = document.getElementById("accountMenuHead");
const accountSignout = document.getElementById("accountSignout");
const accountSignin = document.getElementById("accountSignin");
const sideToggle = document.getElementById("sideToggle");

const desktop = typeof window !== "undefined" ? window.desktop : null;
const isDesktop = desktop?.isDesktop === true;

let currentView = null;
let routeToken = 0;

function parseHash() {
  const hash = location.hash.replace(/^#/, "") || "/";
  const [pathPart, queryPart] = hash.split("?");
  const segments = pathPart.split("/").filter(Boolean);
  const params = Object.fromEntries(new URLSearchParams(queryPart || ""));
  return { segments, params };
}

function renderView(viewModule, container, params) {
  if (currentView?.cleanup) {
    try {
      currentView.cleanup();
    } catch {
      /* ignore */
    }
  }
  currentView = viewModule;
  const myToken = ++routeToken;
  container.__viewToken = myToken;
  Promise.resolve(viewModule.render(container, params)).catch((err) => {
    if (myToken !== routeToken) return;
    container.innerHTML = `<div class="error-box">Something went wrong: ${escapeHtml(err.message)}</div>`;
  });
}

async function router() {
  const { segments, params } = parseHash();
  const root = segments[0] || "";
  window.scrollTo({ top: 0 });
  setRouteActivity(root || "home", params);

  switch (root) {
    case "":
      setActiveNav("home");
      renderView(home, view, params);
      break;
    case "browse":
      setActiveNav("browse");
      if (params.genre) {
        browse.resetForSearch("");
        renderView(browse, view, { ...params });
      } else {
        renderView(browse, view, params);
      }
      break;
    case "search": {
      setActiveNav(null);
      const q = params.q || "";
      searchInput.value = q;
      if (q) pushSearchHistory(q);
      renderView(browse, view, { q });
      break;
    }
    case "anime":
      setActiveNav(null);
      renderView(detail, view, { id: segments[1] });
      break;
    case "watch":
      setActiveNav(null);
      renderView(watch, view, { id: segments[1], ep: segments[2] });
      break;
    case "schedule":
      setActiveNav("schedule");
      renderView(schedule, view, params);
      break;
    case "library":
      setActiveNav("library");
      renderView(library, view, params);
      break;
    case "downloads":
      setActiveNav("downloads");
      renderView(downloads, view, params);
      break;
    case "settings":
      setActiveNav("settings");
      renderView(settings, view, params);
      break;
    case "profile":
      setActiveNav(null);
      renderView(profile, view, params);
      break;
    default:
      setActiveNav(null);
      view.innerHTML = `<div class="empty">Page not found. <a href="#/">Go home</a></div>`;
      view.__viewToken = ++routeToken;
  }
}

function setActiveNav(route) {
  document.querySelectorAll("#mainNav a").forEach((a) => {
    a.classList.toggle("active", a.dataset.route === route);
  });
}

// Sidebar collapse: a manual, persisted state that mirrors the responsive icon
// rail (icons only, labels hidden).
const appEl = document.querySelector(".app");

function applySidebarCollapsed(collapsed) {
  appEl?.classList.toggle("sidebar-collapsed", collapsed);
  if (sideToggle) {
    sideToggle.setAttribute("aria-expanded", String(!collapsed));
    sideToggle.setAttribute("aria-label", collapsed ? "Expand sidebar" : "Collapse sidebar");
    sideToggle.title = collapsed ? "Expand sidebar" : "Collapse sidebar";
  }
}

sideToggle?.addEventListener("click", () => {
  const collapsed = !appEl?.classList.contains("sidebar-collapsed");
  setSidebarCollapsed(collapsed);
  applySidebarCollapsed(collapsed);
});

function updateAccountButton() {
  const viewer = getViewer();
  const signedIn = Boolean(getToken());
  const avatar = signedIn && viewer?.avatar?.large
    ? `<img src="${viewer.avatar.large}" alt="" />`
    : `<span class="account-avatar">${escapeHtml(
        (signedIn ? viewer?.name || "?" : "?").slice(0, 1).toUpperCase(),
      )}</span>`;
  const label = signedIn ? viewer?.name || "AniList user" : "Sign in";
  accountBtn.innerHTML = `${avatar}<span class="account-name">${escapeHtml(label)}</span>`;
  accountBtn.title = signedIn ? `Signed in as ${viewer?.name || "AniList user"}` : "Account";

  const name = signedIn ? viewer?.name || "AniList user" : "Not signed in";
  const menuAvatar = signedIn && viewer?.avatar?.large
    ? `<img src="${viewer.avatar.large}" alt="" />`
    : `<span class="account-menu-avatar">${escapeHtml((signedIn ? name : "?").slice(0, 1).toUpperCase())}</span>`;
  accountMenuHead.innerHTML = `<span class="account-menu-ava">${menuAvatar}</span><span class="account-menu-name">${escapeHtml(
    name,
  )}</span>`;
  if (accountSignin) accountSignin.hidden = signedIn;
  if (accountSignout) accountSignout.hidden = !signedIn;
}

function openAccountMenu() {
  accountMenu.hidden = false;
  accountBtn.setAttribute("aria-expanded", "true");
}

function closeAccountMenu() {
  accountMenu.hidden = true;
  accountBtn.setAttribute("aria-expanded", "false");
}

function toggleAccountMenu() {
  if (accountMenu.hidden) openAccountMenu();
  else closeAccountMenu();
}

accountBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  toggleAccountMenu();
});

accountMenu.addEventListener("click", (e) => {
  e.stopPropagation();
  if (e.target.closest(".account-menu-item")) closeAccountMenu();
});

document.addEventListener("click", () => {
  if (!accountMenu.hidden) closeAccountMenu();
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !accountMenu.hidden) closeAccountMenu();
});

accountSignout?.addEventListener("click", () => {
  clearToken();
  toast("Signed out of AniList");
  closeAccountMenu();
});

accountSignin?.addEventListener("click", () => {
  closeAccountMenu();
  settings.startSignIn(document.getElementById("view"));
});

// In the desktop app, Settings lives in its own window. Intercept the menu
// link so it opens that window instead of navigating the current one.
accountMenu.querySelector('[data-menu="settings"]')?.addEventListener("click", (e) => {
  if (isDesktop && typeof desktop.openSettings === "function") {
    e.preventDefault();
    desktop.openSettings();
    closeAccountMenu();
  }
});

// ---- global wiring ----
async function handleHashChange() {
  closeAccountMenu();
  await captureRedirectToken();
  await router();
}

window.addEventListener("hashchange", handleHashChange);

// Netflix-style topbar: transparent over the page, frosted once scrolled.
const topbar = document.getElementById("topbar");
const syncTopbar = () => topbar?.classList.toggle("scrolled", window.scrollY > 8);
window.addEventListener("scroll", syncTopbar, { passive: true });
syncTopbar();

searchForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const q = searchInput.value.trim();
  if (!q) return;
  location.hash = `#/search?q=${encodeURIComponent(q)}`;
});

(async function bootstrap() {
  await captureRedirectToken();
  updateAccountButton();
  applySidebarCollapsed(getSidebarCollapsed());
  onChange(updateAccountButton);
  applyDiscordConfig();
  initRailFades();
  if (!location.hash) location.hash = "#/";
  else await router();
  announceUpdate();
})();

// Tell the user once per version when an update is found. The desktop main
// process runs the actual check on launch; we also pull the current state in
// case it already finished before this listener attached.
function announceUpdate() {
  if (!updatesAvailable()) return;
  const NOTIFY_KEY = "anila.updateNotified";
  const announce = (state) => {
    if ((state.status === "available" || state.status === "downloaded") && state.version) {
      let seen = null;
      try {
        seen = localStorage.getItem(NOTIFY_KEY);
      } catch {
        /* storage may be unavailable */
      }
      if (seen === state.version) return;
      try {
        localStorage.setItem(NOTIFY_KEY, state.version);
      } catch {
        /* ignore */
      }
      toast(`Anila v${state.version} is available — open Settings to update.`);
    }
  };
  onUpdateStatus(announce);
  getUpdateState()
    .then(announce)
    .catch(() => {});
}

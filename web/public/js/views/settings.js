import {
  authorizeUrl,
  ANILIST_CLIENT_ID,
  extractTokenFromHash,
  viewer as fetchViewer,
} from "../anilist.js";
import {
  getSettings,
  setSetting,
  getToken,
  setToken,
  clearToken,
  getViewer,
  setViewer,
} from "../store.js";
import { escapeHtml, toast, openModal, closeModal } from "../ui.js";
import { dropdownHtml, initDropdowns } from "../dropdown.js";
import { clearCache } from "../cache.js";
import {
  applyDiscordConfig,
  onDiscordStatus,
  getDiscordStatus,
} from "../presence.js";
import {
  updatesAvailable,
  getUpdateState,
  checkForUpdates,
  onUpdateStatus,
  installUpdate,
  openRelease,
  updateStatusText,
  updateActions,
} from "../updates.js";

// The Electron wrapper exposes window.desktop (see web/desktop/preload.cjs) and
// captures the AniList OAuth redirect for us, so sign-in needs no copy-pasting.
const isDesktop = typeof window !== "undefined" && window.desktop?.isDesktop === true;
const hasDiscordApi = typeof window !== "undefined" && !!window.desktop?.discord;

const DISCORD_STATUS = {
  disabled: "Off",
  unavailable: "Not available (RPC library missing)",
  connecting: "Connecting…",
  connected: "Connected",
  "not-running": "Waiting for the Discord app",
};

let unsubDiscordStatus = null;
let unsubUpdateStatus = null;

export function cleanup() {
  if (unsubDiscordStatus) {
    unsubDiscordStatus();
    unsubDiscordStatus = null;
  }
  if (unsubUpdateStatus) {
    unsubUpdateStatus();
    unsubUpdateStatus = null;
  }
}

const PROVIDERS = [
  ["bonk", "Miruro · bonk"],
  ["kiwi", "Miruro · kiwi"],
  ["pewe", "Miruro · pewe"],
  ["bee", "Miruro · bee"],
  ["ally", "Miruro · ally"],
  ["moo", "Miruro · moo"],
  ["hop", "Miruro · hop"],
  ["anibd", "AniBD"],
  ["senshi", "Senshi"],
];

const SUBTITLE_LANGS = [
  ["en", "English"],
  ["es", "Spanish"],
  ["pt", "Portuguese"],
  ["fr", "French"],
  ["de", "German"],
  ["ar", "Arabic"],
  ["und", "Any"],
];

export async function render(container, params = {}) {
  if (params.signin) {
    toast(`AniList sign-in failed: ${params.signin}`, "error");
    history.replaceState(null, "", `${location.pathname}${location.search}#/settings`);
  }
  const settings = getSettings();
  const viewer = getViewer();

  container.innerHTML = `
    <h1 class="page-title">Settings</h1>
    <div class="settings-grid">
      <section class="panel">
        <h3>Account</h3>
        <div id="accountSection">${accountHtml(viewer)}</div>
      </section>

      <section class="panel">
        <h3>Playback</h3>
        ${switchField("skipIntro", "Skip intros", "Show a Skip Intro button when the provider reports one.", settings.skipIntro)}
        ${switchField("skipOutro", "Skip outros", "Show a Skip Outro button when available.", settings.skipOutro)}
        ${switchField("autoplayNext", "Autoplay next episode", "Continue to the next episode automatically.", settings.autoplayNext)}
        <div class="field">
          <div><div class="label">Subtitle language</div><div class="hint">Preferred track when multiple exist.</div></div>
          ${dropdownHtml("subtitleLanguage", SUBTITLE_LANGS, settings.subtitleLanguage, { label: "Subtitle language" })}
        </div>
      </section>

      <section class="panel">
        <h3>Sources</h3>
        <div class="field">
          <div><div class="label">Preferred provider</div><div class="hint">Tried first when resolving an episode.</div></div>
          ${dropdownHtml("preferredProvider", PROVIDERS, settings.preferredProvider, { label: "Preferred provider" })}
        </div>
        ${switchField("hideAdult", "Hide adult content", "Filter adult titles and providers from catalogs.", settings.hideAdult)}
      </section>

      <section class="panel">
        <h3>Data</h3>
        <div class="field">
          <div><div class="label">Clear cached API responses</div><div class="hint">Forces fresh data from AniList and providers next time.</div></div>
          <button class="btn small ghost" id="clearCache">Clear</button>
        </div>
        <div class="field">
          <div><div class="label">Clear local library & progress</div><div class="hint">Does not affect your AniList account.</div></div>
          <button class="btn small ghost" id="clearData">Clear</button>
        </div>
      </section>

      ${discordPanel(settings)}
      ${updatesPanel()}
    </div>
  `;

  container.querySelectorAll("[data-toggle]").forEach((input) => {
    input.addEventListener("change", () => setSetting(input.dataset.toggle, input.checked));
  });
  initDropdowns(container, {
    subtitleLanguage: (value) => setSetting("subtitleLanguage", value),
    preferredProvider: (value) => setSetting("preferredProvider", value),
  });
  container.querySelector("#clearData")?.addEventListener("click", () => {
    localStorage.removeItem("anila.library");
    localStorage.removeItem("anila.progress");
    localStorage.removeItem("anila.searchHistory");
    toast("Local data cleared");
  });
  container.querySelector("#clearCache")?.addEventListener("click", async () => {
    clearCache();
    try {
      await fetch("/api/cache/clear");
    } catch {
      /* server cache clear is best-effort */
    }
    toast("Cache cleared");
  });

  container.querySelector('[data-toggle="discordRpc"]')?.addEventListener("change", applyDiscordConfig);
  if (hasDiscordApi) {
    const statusEl = container.querySelector("#discordStatus");
    const paint = (s) => {
      if (!statusEl) return;
      statusEl.textContent = DISCORD_STATUS[s] || s;
      statusEl.dataset.status = s;
    };
    if (unsubDiscordStatus) unsubDiscordStatus();
    unsubDiscordStatus = onDiscordStatus(paint);
    getDiscordStatus().then(paint);
  }

  wireUpdatesPanel(container);

  const accountSection = container.querySelector("#accountSection");
  accountSection.querySelector("#signInBtn")?.addEventListener("click", () => startSignIn(container));
  accountSection.querySelector("#signOutBtn")?.addEventListener("click", () => {
    clearToken();
    toast("Signed out of AniList");
    render(container);
  });
}

export function startSignIn(container) {
  if (isDesktop) {
    try {
      sessionStorage.setItem("anila.oauth.return", location.hash || "#/settings");
    } catch {
      /* sessionStorage may be unavailable */
    }
    window.open(authorizeUrl(ANILIST_CLIENT_ID), "anila-anilist", "width=520,height=720");
    toast("Approve access in the AniList window — you'll be signed in automatically.");
    return;
  }
  openSignInModal(container);
}

function accountHtml(viewer) {
  if (getToken() && viewer) {
    return `<div class="field">
      <div style="display:flex;gap:12px;align-items:center">
        <img src="${viewer.avatar?.large || ""}" alt="" style="width:44px;height:44px;border-radius:50%;object-fit:cover;background:var(--bg-elev-2)" />
        <div>
          <div class="label">${escapeHtml(viewer.name || "AniList user")}</div>
          <div class="hint">${
            viewer.statistics?.anime
              ? `${viewer.statistics.anime.count} anime · ${viewer.statistics.anime.episodesWatched} episodes`
              : "Connected"
          }</div>
        </div>
      </div>
      <button class="btn small ghost" id="signOutBtn">Sign out</button>
    </div>`;
  }
  if (getToken() && !viewer) {
    return `<div class="field"><div class="label">Connected, but the profile did not load.</div></div>
      <button class="btn small" id="signInBtn">Reconnect</button>`;
  }
  const hint = isDesktop
    ? "Sign in to sync your AniList list, scores, and watch progress. The desktop app handles the redirect for you."
    : "Sign in to sync your AniList list, scores, and watch progress.";
  return `<div class="hint" style="margin-bottom:14px">${hint}</div>
    <button class="btn primary" id="signInBtn">Sign in with AniList</button>`;
}

function switchField(key, label, hint, checked) {
  return `<div class="field">
    <div><div class="label">${escapeHtml(label)}</div><div class="hint">${escapeHtml(hint)}</div></div>
    <label class="switch"><input type="checkbox" data-toggle="${key}" ${checked ? "checked" : ""} /><span class="slider"></span></label>
  </div>`;
}

function discordPanel(settings) {
  if (!isDesktop || !hasDiscordApi) {
    return `<section class="panel">
      <h3>Discord Rich Presence</h3>
      <div class="hint">Available in the desktop app (<code>./start-desktop.sh</code>).</div>
    </section>`;
  }
  return `<section class="panel">
    <h3>Discord Rich Presence</h3>
    ${switchField(
      "discordRpc",
      "Show what I'm watching",
      "Share browsing and watching activity, with cover art, on your Discord profile.",
      settings.discordRpc,
    )}
    <div class="hint">Status: <span id="discordStatus" data-status="disabled">…</span></div>
  </section>`;
}

function updatesPanel() {
  if (!updatesAvailable()) {
    return `<section class="panel">
      <h3>Updates</h3>
      <div class="hint">Available in the desktop app (<code>./start-desktop.sh</code>).</div>
    </section>`;
  }
  return `<section class="panel" id="updatesPanel">
    <h3>Updates</h3>
    <div class="field">
      <div>
        <div class="label">Anila <span id="updateVersion" class="update-version"></span></div>
        <div class="hint" id="updateStatus" data-status="idle">Checking for updates…</div>
      </div>
      <div class="update-actions">
        <button class="btn small ghost" id="updateCheck" type="button">Check now</button>
        <button class="btn small" id="updateDownload" type="button" hidden>Download</button>
        <button class="btn small primary" id="updateInstall" type="button" hidden>Restart to install</button>
      </div>
    </div>
    <div class="update-progress" id="updateProgress" hidden>
      <div class="update-bar"><i id="updateBar"></i></div>
    </div>
  </section>`;
}

function wireUpdatesPanel(container) {
  const panel = container.querySelector("#updatesPanel");
  if (!panel) return;
  const versionEl = panel.querySelector("#updateVersion");
  const statusEl = panel.querySelector("#updateStatus");
  const checkBtn = panel.querySelector("#updateCheck");
  const downloadBtn = panel.querySelector("#updateDownload");
  const installBtn = panel.querySelector("#updateInstall");
  const progressEl = panel.querySelector("#updateProgress");
  const barEl = panel.querySelector("#updateBar");

  const paint = (s) => {
    const actions = updateActions(s);
    if (versionEl) versionEl.textContent = s.currentVersion ? `v${s.currentVersion}` : "";
    if (statusEl) {
      statusEl.textContent = updateStatusText(s);
      statusEl.dataset.status = s.status;
    }
    if (checkBtn) {
      checkBtn.hidden = !actions.check;
      checkBtn.disabled = s.status === "checking";
      checkBtn.textContent = s.status === "checking" ? "Checking…" : "Check now";
    }
    if (downloadBtn) downloadBtn.hidden = !actions.download;
    if (installBtn) installBtn.hidden = !actions.install;
    if (progressEl) progressEl.hidden = !actions.progress;
    if (barEl && actions.progress) barEl.style.width = `${s.percent || 0}%`;
  };

  if (unsubUpdateStatus) unsubUpdateStatus();
  unsubUpdateStatus = onUpdateStatus(paint);

  checkBtn?.addEventListener("click", async () => {
    paint(await checkForUpdates());
  });
  downloadBtn?.addEventListener("click", () => openRelease());
  installBtn?.addEventListener("click", () => installUpdate());

  getUpdateState().then(paint).catch(() => {});
}

function openSignInModal(container) {
  const body = `
    <p style="color:var(--muted);margin-top:0">
      AniList sends you back to <code>http://localhost/#access_token=…</code>. Run the server on
      port 80 (<code>sudo ./start.sh --port 80</code>) and it's fully automatic — otherwise the
      redirect page won't load, which is expected; just copy its address below.
      The desktop app (<code>./start-desktop.sh</code>) signs in with one click instead.
    </p>
    <ol style="color:var(--muted);padding-left:18px;font-size:13.5px">
      <li>Click <b>Open AniList login</b> and approve access.</li>
      <li>You land on <code>http://localhost/#access_token=…</code> (this page may look blank or fail — that's fine).</li>
      <li>Copy the whole address bar and paste it here. The token is read and stripped automatically.</li>
    </ol>
    <div style="display:flex;gap:10px;margin:12px 0">
      <button class="btn small" id="openAuth">Open AniList login</button>
    </div>
    <textarea id="tokenInput" placeholder="Paste http://localhost/#access_token=... or just the token"
      style="width:100%;height:90px;border-radius:10px;border:1px solid var(--line);background:var(--bg-elev-2);color:var(--text);padding:10px"></textarea>
  `;
  const modal = openModal({
    title: "Sign in with AniList",
    body,
    actions: [
      { label: "Cancel" },
      {
        label: "Connect",
        primary: true,
        onClick: async () => {
          const raw = modal.querySelector("#tokenInput").value.trim();
          const token = parseToken(raw);
          if (!token) {
            toast("Could not find a token in that text.", "error");
            return;
          }
          await connect(token, container);
          closeModal();
        },
      },
    ],
  });
  modal.querySelector("#openAuth").addEventListener("click", () => {
    window.open(authorizeUrl(ANILIST_CLIENT_ID), "anila-anilist", "width=520,height=720");
  });
}

function parseToken(raw) {
  if (!raw) return null;
  if (!raw.includes("#") && !raw.includes("access_token")) return raw.trim();
  const frag = raw.includes("#") ? raw.slice(raw.indexOf("#")) : `#${raw}`;
  return extractTokenFromHash(frag, null);
}

async function connect(token, container) {
  setToken(token);
  try {
    const viewer = await fetchViewer();
    setViewer(viewer);
    toast(`Signed in as ${viewer?.name || "AniList user"}`);
  } catch (err) {
    toast(`Token saved, but profile load failed: ${err.message}`, "error");
  }
  render(container);
}

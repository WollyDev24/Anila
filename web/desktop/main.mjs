// Anila desktop — Electron wrapper.
// Embeds the Node server (server/server.mjs) in-process and shows the app in
// its own window, so no external browser is needed. Same code, same APIs.
import { app, BrowserWindow, ipcMain, session, shell, webContents, dialog } from "electron";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import fs from "node:fs";
import https from "node:https";
import http from "node:http";
import { wireOAuthRedirects } from "./oauth.mjs";
import { DiscordPresence } from "./rpc.mjs";
import { ProviderBridge } from "./bridge.mjs";
import { createUpdater } from "./updater.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// In a packaged build the server + static assets ship as extra resources
// (resources/server, resources/public). During development they're siblings of
// this folder (web/server, web/public). Resolve once, then load from there.
const SERVER_DIR = app.isPackaged
  ? path.join(process.resourcesPath, "server")
  : path.join(__dirname, "..", "server");
const { startAppServer } = await import(
  pathToFileURL(path.join(SERVER_DIR, "server.mjs")).href
);
const { setTransport } = await import(
  pathToFileURL(path.join(SERVER_DIR, "providers", "util.mjs")).href
);

// Containers/VMs often block the Chromium sandbox; opt in explicitly.
if (process.env.ANILA_DESKTOP_NO_SANDBOX) {
  app.commandLine.appendSwitch("no-sandbox");
}
if (process.env.ANILA_DESKTOP_GPU === "0") {
  app.disableHardwareAcceleration();
}

let server = null;
let port = null;
let mainWindow = null;
let settingsWindow = null;

// A fixed port keeps the app origin (http://127.0.0.1:<port>) stable across
// launches, which is what makes localStorage — the AniList login, settings,
// library and progress — persist. A random port would change the origin every
// run and silently reset all of that.
const DESKTOP_PORT = Number(process.env.ANILA_PORT) || 8789;

function originPath(pathAndHash = "") {
  return `http://127.0.0.1:${port}/${pathAndHash.replace(/^\//, "")}`;
}

const DEBUG = !!process.env.ANILA_DESKTOP_DEBUG;

// ---- Discord Rich Presence ----
const presence = new DiscordPresence({
  log: (msg) => {
    if (DEBUG) console.log(`[discord] ${msg}`);
  },
});
presence.onStatus = (status) => {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send("discord:status", status);
  }
};

// ---- Miruro / Cloudflare bridge ----
// Node's HTTP client gets 403'd by Cloudflare on the Miruro pipe even from a
// home IP. When embedded in Electron we can drive those requests through a
// real Chromium page instead (see bridge.mjs). Everything else keeps using the
// Node transport.
const MIRURO_HOST = /(^|\.)miruro\.(tv|bz|to|ru)$/i;
const bridge = new ProviderBridge({
  log: (msg) => {
    if (DEBUG) console.log(`[bridge] ${msg}`);
  },
});

setTransport(async (url, options, fallback) => {
  let host;
  try {
    host = new URL(url).hostname;
  } catch {
    host = "";
  }
  if (MIRURO_HOST.test(host)) {
    try {
      return await bridge.request(url, options);
    } catch (err) {
      console.warn(`Anila desktop: Miruro bridge failed (${err.message}); using Node transport.`);
      return fallback(url, options);
    }
  }
  // Media/segments from stream CDNs often reject the Node client's fingerprint;
  // use Chromium's network stack (with the provider session) when asked.
  if (options && options.preferBrowser) {
    try {
      return await bridge.netFetch(url, options);
    } catch (err) {
      console.warn(`Anila desktop: browser fetch failed for ${host} (${err.message}); using Node transport.`);
      return fallback(url, options);
    }
  }
  return fallback(url, options);
});

ipcMain.on("discord:configure", (_e, cfg) => presence.configure(cfg));
ipcMain.on("discord:set-activity", (_e, activity) => presence.setActivity(activity));
ipcMain.on("discord:clear-activity", () => presence.clearActivity());
ipcMain.handle("discord:get-status", () => ({
  supported: presence.supported,
  status: presence.status,
}));

// ---- Auto-update ----
// electron-updater can install in place on Windows (NSIS) and Linux AppImage
// builds; everywhere else (macOS, .deb, dev) we fall back to a GitHub Releases
// check that points at the download page.
const isAppImage = process.platform === "linux" && !!process.env.APPIMAGE;
const canAutoUpdate = app.isPackaged && (process.platform === "win32" || isAppImage);

const updater = createUpdater({
  currentVersion: app.getVersion(),
  canAutoUpdate,
  openExternal: (url) => shell.openExternal(url),
  send: (state) => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send("updates:status", state);
    }
  },
  log: (msg) => {
    if (DEBUG) console.log(`[updates] ${msg}`);
  },
  loadAutoUpdater: async () => {
    try {
      const mod = await import("electron-updater");
      const au = mod.autoUpdater || mod.default?.autoUpdater;
      if (!au) throw new Error("autoUpdater export missing");
      if (DEBUG) {
        au.logger = {
          info: (m) => console.log(`[updater] ${m}`),
          warn: (m) => console.warn(`[updater] ${m}`),
          error: (m) => console.error(`[updater] ${m}`),
          debug: () => {},
        };
      }
      return au;
    } catch (err) {
      console.warn(`Anila desktop: electron-updater unavailable (${err.message})`);
      return null;
    }
  },
});

ipcMain.handle("updates:get-state", () => updater.getState());
ipcMain.handle("updates:check", () => updater.check());
ipcMain.on("updates:install", () => updater.install());
ipcMain.on("updates:open-release", (_e, url) =>
  updater.openRelease(typeof url === "string" ? url : undefined),
);

function vttToSrt(vtt) {
  let s = String(vtt || "");
  s = s.replace(/^WEBVTT[^\n]*\n*/i, "");
  s = s.replace(/(\d{2}):(\d{2}):(\d{2})\.(\d{3})/g, "$1:$2:$3,$4");
  s = s.replace(/\r\n/g, "\n");
  s = s.trim();
  return s;
}

function downloadHttp(url, out, onProgress) {
  const client = url.startsWith("https:") ? https : http;
  return new Promise((resolve, reject) => {
    const req = client.get(url, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 307 || res.statusCode === 308) {
        res.destroy();
        return downloadHttp(res.headers.location, out, onProgress).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        res.destroy();
        return reject(new Error(`Download failed: ${res.statusCode}`));
      }
      const total = Number(res.headers["content-length"]) || 0;
      let received = 0;
      const ws = fs.createWriteStream(out);
      res.on("data", (chunk) => {
        received += chunk.length;
        if (total > 0 && onProgress) onProgress(Math.min(100, Math.round((received / total) * 100)));
      });
      res.pipe(ws);
      ws.on("finish", () => ws.close(() => resolve()));
      ws.on("error", (e) => {
        try { ws.close(); } catch {}
        reject(e);
      });
    });
    req.on("error", reject);
  });
}

function anilaMoviesDir() {
  return path.join(app.getPath("videos"), "Anila");
}

ipcMain.handle("downloads:list", () => {
  try {
    if (!fs.existsSync(anilaMoviesDir())) return { dir: anilaMoviesDir(), files: [] };
    const dirents = fs.readdirSync(anilaMoviesDir(), { withFileTypes: true });
    const files = dirents
      .filter((d) => d.isFile() && /\.(mp4|mkv|webm|mov|m4v|srt|vtt)$/i.test(d.name))
      .map((d) => {
        const st = fs.statSync(path.join(anilaMoviesDir(), d.name));
        return { name: d.name, size: st.size, mtimeMs: st.mtimeMs };
      })
      .sort((a, b) => b.mtimeMs - a.mtimeMs);
    return { dir: anilaMoviesDir(), files };
  } catch (err) {
    console.warn(`Anila desktop: list downloads failed (${err.message})`);
    return { dir: anilaMoviesDir(), files: [], error: err.message };
  }
});

ipcMain.handle("downloads:open-folder", async () => {
  const dir = anilaMoviesDir();
  if (!fs.existsSync(dir)) {
    try { fs.mkdirSync(dir, { recursive: true }); } catch {}
  }
  await shell.openPath(dir);
  return { ok: true };
});

ipcMain.handle("downloads:choose-save", async (_e, opts = {}) => {

  const { title = "Anila", defaultName = "download.mp4" } = opts;
  const result = await dialog.showSaveDialog({
    title,
    defaultPath: defaultName,
    filters: [
      { name: "MP4", extensions: ["mp4"] },
      { name: "All Files", extensions: ["*"] },
    ],
  });
  if (result.canceled || !result.filePath) return { canceled: true };
  return { canceled: false, filePath: result.filePath };
});

ipcMain.handle("downloads:download", async (e, payload = {}) => {
  const { videoUrl, subtitleUrl, subtitleLang = "en", filePath } = payload;
  if (!filePath || !videoUrl) throw new Error("Missing filePath or videoUrl");
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  await downloadHttp(videoUrl, filePath, (pct) => {
    try { e.sender.send("downloads:progress", { filePath, pct }); } catch {}
  });
  if (subtitleUrl) {
    try {
      const subPath = filePath.replace(/\.[^.]+$/, `.${subtitleLang || "en"}.srt`);
      const tmp = await new Promise((resolve, reject) => {
        const client = subtitleUrl.startsWith("https:") ? https : http;
        const req = client.get(subtitleUrl, (res) => {
          if (res.statusCode !== 200) { res.destroy(); return reject(new Error(`Subtitle failed: ${res.statusCode}`)); }
          let data = "";
          res.setEncoding("utf8");
          res.on("data", (c) => { data += c; });
          res.on("end", () => resolve(data));
        });
        req.on("error", reject);
      });
      fs.writeFileSync(subPath, vttToSrt(tmp));
    } catch (err) {
      console.warn(`Anila desktop: subtitle download failed (${err.message})`);
    }
  }
  return { ok: true };
});

function wireOAuth(contents) {
  const closeIfPopup = () => {
    const win = BrowserWindow.fromWebContents(contents);
    if (win && win !== mainWindow && win !== settingsWindow) win.close();
  };
  // Prefer the window that actually started the sign-in (the frame that opened
  // the AniList popup) so a token grabbed in the Settings window lands there.
  const target = () => {
    const openerFrame = contents.opener;
    if (openerFrame) {
      const openerContents = webContents.fromFrame(openerFrame);
      const fromOpener = openerContents ? BrowserWindow.fromWebContents(openerContents) : null;
      if (fromOpener && !fromOpener.isDestroyed()) return fromOpener;
    }
    if (mainWindow && !mainWindow.isDestroyed()) return mainWindow;
    return null;
  };

  if (DEBUG) {
    contents.on("console-message", (...args) => {
      // Skip the hidden provider-bridge windows; they're very chatty.
      const win = BrowserWindow.fromWebContents(contents);
      if (win && !win.isVisible()) return;
      const first = args[0];
      const msg =
        first && typeof first === "object" && "message" in first ? first.message : args[2];
      console.log(`[renderer] ${msg}`);
    });
  }

  // Replay the captured OAuth payload into whichever window initiated sign-in,
  // preserving its page (index.html for the main window, settings.html for the
  // Settings window) so the dedicated page keeps its chrome.
  const replay = (win, hash) => {
    if (!win || win.isDestroyed() || !win.webContents) return;
    let base = `http://127.0.0.1:${port}/`;
    try {
      const u = new URL(win.webContents.getURL());
      base = `${u.origin}${u.pathname}`;
    } catch {
      /* keep the default */
    }
    win.loadURL(`${base}#${hash}`);
  };

  wireOAuthRedirects(contents, {
    log: (msg) => {
      if (DEBUG || msg.includes("localhost")) console.log(`[oauth] ${msg}`);
    },
    onToken: (found) => {
      closeIfPopup();
      const hash =
        `access_token=${encodeURIComponent(found.token)}` +
        (found.state ? `&state=${encodeURIComponent(found.state)}` : "");
      replay(target(), hash);
    },
    onError: (found) => {
      closeIfPopup();
      const win = target();
      if (!win) return;
      console.warn(`[oauth] AniList returned an error: ${found.error}`);
      replay(win, `/settings?signin=${encodeURIComponent(found.error || "failed")}`);
    },
  });
}

// Wire every webContents (main window + OAuth popups) from the start.
app.on("web-contents-created", (_event, contents) => wireOAuth(contents));

// Diagnostic: load the real Miruro watch page in a hidden window and print
// every /api/ call it makes. Enable with ANILA_MIRURO_PROBE=<anilistId|url>.
function startMiruroProbe(value) {
  const url = /^https?:\/\//i.test(value)
    ? value
    : `https://www.miruro.tv/watch/${value}?ep=1`;
  const probeUa =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
    "(KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36";
  const win = new BrowserWindow({
    show: false,
    width: 1000,
    height: 800,
    webPreferences: {
      session: session.fromPartition("persist:anila-providers"),
      preload: path.join(__dirname, "probe-preload.cjs"),
      contextIsolation: false,
      nodeIntegration: false,
    },
  });
  win.webContents.setUserAgent(probeUa, "en-US,en;q=0.9");
  win.webContents.on("console-message", (...args) => {
    const first = args[0];
    const msg =
      first && typeof first === "object" && "message" in first ? first.message : args[2];
    console.log(`[probe] ${msg}`);
  });
  win.webContents.on("did-navigate", (_e, u) => console.log(`[probe] navigated ${u}`));
  console.log(`[probe] opening ${url}`);
  win.loadURL(url);
}

// AniList sign-in opens a popup; let it through, send everything else external.
function applyWindowOpenHandler(win) {
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://anilist.co/")) return { action: "allow" };
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });
}

function baseWindowOptions({ webPreferences = {}, ...rest } = {}) {
  return {
    backgroundColor: "#0d1117",
    icon: path.join(__dirname, "icon.png"),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      ...webPreferences,
    },
    ...rest,
  };
}

function createWindow() {
  const win = new BrowserWindow(
    baseWindowOptions({
      width: 1080,
      height: 760,
      minWidth: 420,
      minHeight: 560,
      title: "Anila",
    }),
  );

  applyWindowOpenHandler(win);
  win.loadURL(originPath());
  return win;
}

function spawnMainWindow() {
  mainWindow = createWindow();
  mainWindow.on("closed", () => {
    mainWindow = null;
    // Hidden provider-bridge windows would keep the process alive, so quit
    // explicitly instead of waiting for `window-all-closed`.
    app.quit();
  });
  // Warm the Settings window once the main window has settled, so opening it
  // later is instant without competing with startup for resources.
  mainWindow.webContents.once("did-finish-load", () => {
    setTimeout(() => prewarmSettingsWindow(), 800);
  });
  return mainWindow;
}

// Settings opens in its own window (per the account menu). It is created once
// as a warm, hidden window and revealed on demand, so opening it is instant.
function createSettingsWindow() {
  const win = new BrowserWindow(
    baseWindowOptions({
      width: 760,
      height: 780,
      minWidth: 480,
      minHeight: 520,
      title: "Anila — Settings",
      show: false,
      parent: mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined,
      webPreferences: {
        additionalArguments: ["--anila-settings-window"],
        // Keep the hidden, warmed window painting so its first reveal is instant
        // instead of waiting for a throttled renderer to catch up.
        backgroundThrottling: false,
      },
    }),
  );
  settingsWindow = win;
  applyWindowOpenHandler(win);
  win.loadURL(originPath("settings.html"));
  win.on("closed", () => {
    clearTimeout(win.__revealTimer);
    if (settingsWindow === win) settingsWindow = null;
  });
  return win;
}

// Build the Settings window ahead of time (hidden, fully rendered) so the first
// open doesn't wait on a cold renderer process.
function prewarmSettingsWindow() {
  if (settingsWindow && !settingsWindow.isDestroyed()) return settingsWindow;
  return createSettingsWindow();
}

function openSettingsWindow() {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    // Warm window: refresh its contents (account/settings may have changed
    // since it was rendered) and reveal immediately.
    settingsWindow.webContents.send("settings:refresh");
    revealSettingsWindow(settingsWindow);
    return settingsWindow;
  }
  // Cold path (e.g. reopened right after being closed): reveal once painted.
  const win = createSettingsWindow();
  win.once("ready-to-show", () => revealSettingsWindow(win));
  win.__revealTimer = setTimeout(() => revealSettingsWindow(win), 3000);
  return win;
}

// Show (and focus) the settings window, restoring it if it was minimized.
function revealSettingsWindow(win) {
  if (!win || win.isDestroyed()) return;
  clearTimeout(win.__revealTimer);
  win.__revealed = true;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

ipcMain.on("settings:open", () => openSettingsWindow());

async function start() {
  const cacheDir = path.join(app.getPath("userData"), "http-cache");
  try {
    const started = await startAppServer({ port: DESKTOP_PORT, cacheDir });
    server = started.server;
    port = started.port;
  } catch (err) {
    if (err && err.code === "EADDRINUSE" && !process.env.ANILA_PORT) {
      console.warn(
        `Anila desktop: port ${DESKTOP_PORT} is already in use; using a random port. ` +
          "Your AniList login won't persist this session.",
      );
      try {
        const started = await startAppServer({ port: 0, cacheDir });
        server = started.server;
        port = started.port;
      } catch (err2) {
        console.error(`Anila desktop: failed to start the local server: ${err2.message}`);
        app.quit();
        return;
      }
    } else {
      console.error(`Anila desktop: failed to start the local server: ${err.message}`);
      app.quit();
      return;
    }
  }
  console.log(`Anila desktop serving http://127.0.0.1:${port}`);

  // Local app: always load the current assets, never a stale disk cache.
  try {
    await session.defaultSession.clearCache();
  } catch {
    /* ignore */
  }

  spawnMainWindow();

  // Check for updates shortly after launch, once the UI has settled. Errors
  // (offline, rate-limited) just surface as a status in Settings.
  setTimeout(() => {
    updater.check().catch(() => {});
  }, 4000);

  // Warm the Miruro bridge in the background so the first playback doesn't wait
  // on the Cloudflare challenge round-trip. Failures are non-fatal.
  bridge.windowFor("https://www.miruro.tv").catch(() => {});

  if (process.env.ANILA_MIRURO_PROBE) {
    startMiruroProbe(process.env.ANILA_MIRURO_PROBE);
  }
}

app.whenReady().then(start);

app.on("activate", () => {
  if ((!mainWindow || mainWindow.isDestroyed()) && port) {
    spawnMainWindow();
  }
});

app.on("window-all-closed", () => app.quit());

app.on("will-quit", () => {
  try {
    server?.close();
  } catch {
    /* ignore */
  }
  presence.destroy();
  bridge.destroy();
});
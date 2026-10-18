// Chromium-backed provider bridge.
//
// Some providers (notably Miruro's pipe) sit behind Cloudflare bot management
// that rejects plain Node HTTP clients with a 403, even from a residential IP,
// because the TLS/HTTP fingerprint and cookie set don't look like a browser.
//
// The desktop app embeds Chromium, so we open a hidden window on the provider
// origin and issue the request from *inside that page* with a same-origin
// `fetch`. That gives Cloudflare a real browser fingerprint, the right
// Referer/Origin, and any challenge cookies, which the Node client can't.
import { BrowserWindow, net, session } from "electron";

// A dedicated persistent partition keeps provider challenge cookies isolated
// from the app window's origin (127.0.0.1) and lets them survive restarts.
const PARTITION = "persist:anila-providers";

const LOAD_TIMEOUT_MS = 30000;
const FETCH_TIMEOUT_MS = 60000;
const CLEARANCE_TRIES = 12;
const CLEARANCE_INTERVAL_MS = 1500;
const MAX_LOG_BODY = 180;

// Cloudflare bot management flags Electron's default UA ("... Electron/37 ...").
// Present as an ordinary Chrome so the challenge behaves like a real browser.
const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36";

export class ProviderBridge {
  constructor({ log = () => {} } = {}) {
    this.log = log;
    this.windows = new Map(); // origin -> Promise<BrowserWindow|null>
  }

  partitionSession() {
    return session.fromPartition(PARTITION);
  }

  windowFor(origin) {
    if (!this.windows.has(origin)) {
      this.windows.set(origin, this.createWindow(origin));
    }
    return this.windows.get(origin);
  }

  async createWindow(origin) {
    let win;
    try {
      // Apply the browser-like UA to the whole partition so both the page and
      // its same-origin fetches (and any Cloudflare cookie bound to the UA) agree.
      this.partitionSession().setUserAgent(BROWSER_UA, "en-US,en;q=0.9");
      win = new BrowserWindow({
        show: false,
        width: 900,
        height: 700,
        webPreferences: {
          session: this.partitionSession(),
          contextIsolation: true,
          nodeIntegration: false,
          backgroundThrottling: false,
        },
      });
    } catch (err) {
      this.log(`cannot create window for ${origin}: ${err.message}`);
      return null;
    }

    win.on("closed", () => this.windows.delete(origin));

    await new Promise((resolve) => {
      let settled = false;
      const done = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve();
      };
      const timer = setTimeout(done, LOAD_TIMEOUT_MS);
      win.webContents.once("did-finish-load", done);
      win.webContents.once("did-fail-load", done);
      win.loadURL(`${origin}/`).catch(() => done());
    });

    await this.waitForClearance(win, origin);
    this.log(`ready for ${origin}`);
    return win;
  }

  // Cloudflare serves a JS challenge on first hit; poll a cheap same-origin
  // request until it stops returning 403/503 so the page (and its cookie jar)
  // is actually "let through" before we call the pipe.
  async waitForClearance(win, origin) {
    for (let attempt = 1; attempt <= CLEARANCE_TRIES; attempt++) {
      let res = null;
      try {
        res = await this.execInPage(win, "/");
      } catch (err) {
        this.log(`clearance probe error for ${origin}: ${err.message}`);
      }
      if (res && res.status < 400) {
        this.log(`clearance ok for ${origin} (attempt ${attempt})`);
        return true;
      }
      const status = res ? res.status : "err";
      const title = res ? res.title : "";
      this.log(`waiting for clearance on ${origin} (attempt ${attempt}, status ${status}, title "${title}")`);
      await delay(CLEARANCE_INTERVAL_MS);
    }
    this.log(`clearance never confirmed for ${origin}`);
    return false;
  }

  async execInPage(win, pathAndSearch) {
    if (!win || win.isDestroyed()) {
      throw new Error("no window");
    }
    const script = `(async () => {
      try {
        const r = await fetch(${JSON.stringify(pathAndSearch)}, { credentials: "include" });
        const bytes = new Uint8Array(await r.arrayBuffer());
        let bin = "";
        for (let i = 0; i < bytes.length; i += 0x8000) {
          bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
        }
        let preview = "";
        try { preview = new TextDecoder().decode(bytes.subarray(0, 2048)); } catch (e) {}
        const headers = {};
        r.headers.forEach((v, k) => { headers[k] = v; });
        return JSON.stringify({ ok: true, status: r.status, headers, bodyBase64: btoa(bin), body: preview, title: document.title, href: location.href });
      } catch (e) {
        return JSON.stringify({ ok: false, error: String((e && e.message) || e) });
      }
    })()`;

    const raw = await Promise.race([
      win.webContents.executeJavaScript(script, true),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("fetch timed out")), FETCH_TIMEOUT_MS),
      ),
    ]);

    const parsed = JSON.parse(raw);
    if (!parsed.ok) throw new Error(parsed.error || "fetch failed");
    return parsed;
  }

  // Drop-in replacement for util.request()'s result shape. These endpoints are
  // GET-only JSON, so request bodies are not supported here; providers that use
  // POST fall through to the Node transport instead.
  async request(url, options = {}) {
    const target = new URL(url);
    if (options.method && options.method !== "GET") {
      throw new Error("only GET is supported");
    }
    if (options.body) {
      throw new Error("request body not supported");
    }

    const pathAndSearch = `${target.pathname}${target.search}`;
    let res = await this.fetchInPage(target.origin, pathAndSearch);

    if (res.status >= 400) {
      this.log(
        `${res.status} from ${target.origin}${target.pathname} ` +
          `[title "${res.title}"] body="${snippet(res.body)}"`,
      );
      // One recovery attempt: reload and re-clear the challenge.
      await this.reload(target.origin);
      res = await this.fetchInPage(target.origin, pathAndSearch);
      if (res.status >= 400) {
        this.log(`${res.status} again after reload; body="${snippet(res.body)}"`);
      }
    }

    return {
      status: res.status,
      headers: res.headers,
      body: Buffer.from(res.bodyBase64 || "", "base64"),
      url,
    };
  }

  async fetchInPage(origin, pathAndSearch) {
    const win = await this.windowFor(origin);
    if (!win || win.isDestroyed()) {
      throw new Error(`no window for ${origin}`);
    }
    return this.execInPage(win, pathAndSearch);
  }

  // Chromium-backed fetch for arbitrary hosts (stream CDNs, subtitles) that
  // reject the Node client's TLS/HTTP fingerprint. Uses the provider session so
  // cookies/UA are shared, and bypasses renderer CORS restrictions.
  netFetch(url, options = {}) {
    const method = options.method || "GET";
    const headers = options.headers || {};
    const timeout = options.timeout || 60000;
    return new Promise((resolve, reject) => {
      let req;
      try {
        req = net.request({
          url,
          method,
          session: this.partitionSession(),
          useSessionCookies: true,
          redirect: "follow",
        });
      } catch (err) {
        reject(err);
        return;
      }
      for (const [key, value] of Object.entries(headers)) {
        if (value === undefined || value === null) continue;
        try {
          req.setHeader(key, String(value));
        } catch {
          /* skip invalid header */
        }
      }
      const timer = setTimeout(() => {
        try {
          req.abort();
        } catch {
          /* ignore */
        }
        reject(new Error("net request timed out"));
      }, timeout);
      req.on("response", (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          clearTimeout(timer);
          resolve({
            status: res.statusCode,
            headers: normalizeHeaders(res.headers),
            body: Buffer.concat(chunks),
            url,
          });
        });
        res.on("error", (err) => {
          clearTimeout(timer);
          reject(err);
        });
      });
      req.on("error", (err) => {
        clearTimeout(timer);
        reject(err);
      });
      if (options.body) req.write(options.body);
      req.end();
    });
  }

  async reload(origin) {
    const win = await this.windowFor(origin).catch(() => null);
    if (!win || win.isDestroyed()) return;
    await new Promise((resolve) => {
      let settled = false;
      const done = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve();
      };
      const timer = setTimeout(done, LOAD_TIMEOUT_MS);
      win.webContents.once("did-finish-load", done);
      win.webContents.once("did-fail-load", done);
      win.webContents.reloadIgnoringCache();
    });
    await this.waitForClearance(win, origin);
  }

  destroy() {
    for (const pending of this.windows.values()) {
      pending
        .then((win) => {
          try {
            if (win && !win.isDestroyed()) win.destroy();
          } catch {
            /* ignore */
          }
        })
        .catch(() => {});
    }
    this.windows.clear();
  }
}

function snippet(text) {
  const clean = String(text || "").replace(/\s+/g, " ").trim();
  return clean.length > MAX_LOG_BODY ? `${clean.slice(0, MAX_LOG_BODY)}…` : clean;
}

function normalizeHeaders(headers) {
  const out = {};
  for (const [key, value] of Object.entries(headers || {})) {
    out[String(key).toLowerCase()] = Array.isArray(value)
      ? value.join(", ")
      : String(value);
  }
  return out;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

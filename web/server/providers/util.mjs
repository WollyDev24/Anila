import http from "node:http";
import https from "node:https";
import zlib from "node:zlib";

export const DESKTOP_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

export const FIREFOX_UA =
  "Mozilla/5.0 (X11; Linux x86_64; rv:146.0) Gecko/20100101 Firefox/146.0";

// Optional transport override. When the desktop app injects a Chromium-backed
// transport, provider requests that need a real browser fingerprint (e.g. the
// Cloudflare-protected Miruro pipe) can be routed through it. It receives the
// Node implementation as the third argument so it can fall back for everything
// else.
let transport = null;

export function setTransport(fn) {
  transport = fn;
}

/**
 * HTTP(S) request. By default uses the Node stdlib (see nodeRequest). The
 * desktop wrapper may replace this with an Electron/Chromium-backed transport.
 * Returns { status, headers, body } where body is a Buffer.
 */
export function request(url, options = {}) {
  if (transport) return transport(url, options, nodeRequest);
  return nodeRequest(url, options);
}

function nodeRequest(url, options = {}) {
  const {
    method = "GET",
    headers = {},
    body,
    timeout = 30000,
    maxRedirects = 5,
    rejectUnauthorized = true,
  } = options;

  return new Promise((resolve, reject) => {
    let target;
    try {
      target = new URL(url);
    } catch (err) {
      reject(new Error(`Invalid URL: ${url}`));
      return;
    }
    const lib = target.protocol === "https:" ? https : http;
    const req = lib.request(
      {
        protocol: target.protocol,
        hostname: target.hostname,
        port: target.port || (target.protocol === "https:" ? 443 : 80),
        path: `${target.pathname}${target.search}`,
        method,
        headers: { ...headers },
        rejectUnauthorized,
      },
      (res) => {
        if (
          res.statusCode >= 300 &&
          res.statusCode < 400 &&
          res.headers.location &&
          maxRedirects > 0
        ) {
          const next = new URL(res.headers.location, target).toString();
          res.resume();
          resolve(nodeRequest(next, { ...options, maxRedirects: maxRedirects - 1 }));
          return;
        }
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () =>
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: Buffer.concat(chunks),
            url: target.toString(),
          }),
        );
      },
    );
    req.setTimeout(timeout, () => req.destroy(new Error(`Request timed out: ${url}`)));
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

export async function getText(url, options = {}) {
  const res = await request(url, options);
  if (res.status >= 400) {
    throw new Error(`HTTP ${res.status} for ${url}`);
  }
  return res.body.toString("utf8");
}

export async function getJson(url, options = {}) {
  const text = await getText(url, options);
  return JSON.parse(text);
}

export function base64UrlEncode(input) {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(String(input), "utf8");
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function base64UrlDecode(str) {
  const norm = String(str).replace(/-/g, "+").replace(/_/g, "/");
  const padded = norm + "=".repeat((4 - (norm.length % 4)) % 4);
  return Buffer.from(padded, "base64");
}

export function xor(data, key) {
  const out = Buffer.alloc(data.length);
  for (let i = 0; i < data.length; i++) out[i] = data[i] ^ key[i % key.length];
  return out;
}

export function gunzip(data) {
  return zlib.gunzipSync(data);
}

export function hexToBuffer(hex) {
  return Buffer.from(hex, "hex");
}

export function originOf(url) {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

export function cleanTitle(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export async function mapWithConcurrency(items, limit, worker) {
  const results = new Array(items.length);
  let index = 0;
  async function run() {
    while (index < items.length) {
      const current = index++;
      try {
        results[current] = await worker(items[current], current);
      } catch (err) {
        results[current] = null;
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return results;
}

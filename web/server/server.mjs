import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { request, DESKTOP_UA } from "./providers/util.mjs";
import { TtlCache, hashKey, remember } from "./cache.mjs";
import * as miruro from "./providers/miruro.mjs";
import * as anibd from "./providers/anibd.mjs";
import * as senshi from "./providers/senshi.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, "..", "public");
const ANILIST_URL = "https://graphql.anilist.co";

// Short-lived caches for slow-changing upstream data. Keep the TTLs in one place
// so callers and the settings "clear cache" action stay in sync.
export const CACHE_TTL = {
  anilist: 5 * 60 * 1000,
  episodes: 6 * 60 * 60 * 1000,
  sources: 15 * 60 * 1000,
  manifest: 20 * 1000,
};

const DEFAULT_CACHE_DIR =
  process.env.ANILA_CACHE_DIR || path.join(os.tmpdir(), "anila-cache");

let caches = null;

function makeCaches(dir) {
  const sub = (name, opts) =>
    new TtlCache({ ...opts, dir: dir ? path.join(dir, name) : null });
  return {
    anilist: sub("anilist", { maxEntries: 300, defaultTtl: CACHE_TTL.anilist }),
    episodes: sub("episodes", { maxEntries: 500, defaultTtl: CACHE_TTL.episodes }),
    sources: sub("sources", { maxEntries: 500, defaultTtl: CACHE_TTL.sources }),
    // Manifests are volatile; keep in memory only.
    manifest: new TtlCache({ maxEntries: 300, defaultTtl: CACHE_TTL.manifest }),
  };
}

function getCaches() {
  if (!caches) caches = makeCaches(DEFAULT_CACHE_DIR);
  return caches;
}

export function configureCache(dir) {
  caches = makeCaches(dir);
}

export function clearCaches() {
  for (const cache of Object.values(getCaches())) cache.clear();
}

export function cacheStats() {
  const current = getCaches();
  const out = {};
  for (const [name, cache] of Object.entries(current)) {
    out[name] = cache.size;
  }
  return out;
}


const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webp": "image/webp",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".map": "application/json",
};

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Access-Control-Allow-Origin": "*",
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

// ---------- static files ----------
function serveStatic(req, res, pathname) {
  let rel = decodeURIComponent(pathname);
  if (rel === "/" || rel === "") rel = "/index.html";
  const filePath = path.join(PUBLIC_DIR, path.normalize(rel));
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      // SPA fallback to index.html for unknown non-asset routes.
      if (!path.extname(rel)) {
        fs.readFile(path.join(PUBLIC_DIR, "index.html"), (e2, html) => {
          if (e2) {
            res.writeHead(404);
            res.end("Not found");
          } else {
            res.writeHead(200, { "Content-Type": MIME[".html"] });
            res.end(html);
          }
        });
        return;
      }
      res.writeHead(404);
      res.end("Not found");
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      "Content-Type": MIME[ext] || "application/octet-stream",
      "Cache-Control": "no-cache",
    });
    res.end(data);
  });
}

// ---------- AniList proxy ----------
async function handleAniList(req, res) {
  const raw = await readBody(req);
  const headers = {
    "Content-Type": "application/json",
    Accept: "application/json",
    "User-Agent": "Anila-Web/0.1 (+local)",
  };
  if (req.headers.authorization) headers.Authorization = req.headers.authorization;
  const bodyStr = raw.toString("utf8");
  const cache = getCaches().anilist;
  // Public (unauthenticated) read queries are safe to cache; never cache
  // mutations or authed requests (viewer/list are per-user).
  const auth = Boolean(req.headers.authorization);
  const cacheable = !auth && !/\bmutation\b/i.test(bodyStr);
  const key = cacheable ? `anilist:${hashKey(bodyStr)}` : null;
  if (cacheable) {
    const hit = cache.get(key);
    if (hit !== undefined) {
      res.writeHead(200, {
        "Content-Type": "application/json; charset=utf-8",
        "Access-Control-Allow-Origin": "*",
        "X-Anila-Cache": "HIT",
      });
      res.end(hit);
      return;
    }
  }
  try {
    const upstream = await request(ANILIST_URL, {
      method: "POST",
      headers,
      body: raw,
      timeout: 30000,
      maxRedirects: 0,
    });
    // If AniList is rate-limiting or erroring, serve the last good copy rather
    // than surfacing a failure (the home view re-requests on every navigation).
    if (cacheable && (upstream.status === 429 || upstream.status >= 500)) {
      const stale = cache.getStale(key);
      if (stale !== undefined) {
        res.writeHead(200, {
          "Content-Type": "application/json; charset=utf-8",
          "Access-Control-Allow-Origin": "*",
          "X-Anila-Cache": "STALE",
        });
        res.end(stale);
        return;
      }
    }
    const body = upstream.body.toString("utf8");
    if (cacheable && upstream.status === 200) cache.set(key, body, CACHE_TTL.anilist);
    res.writeHead(upstream.status, {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "X-Anila-Cache": cacheable ? "MISS" : "BYPASS",
      "X-RateLimit-Limit": upstream.headers["x-ratelimit-limit"] || "",
      "X-RateLimit-Remaining": upstream.headers["x-ratelimit-remaining"] || "",
      "X-RateLimit-Reset": upstream.headers["x-ratelimit-reset"] || "",
      "Retry-After": upstream.headers["retry-after"] || "",
    });
    res.end(body);
  } catch (err) {
    if (cacheable) {
      const stale = cache.getStale(key);
      if (stale !== undefined) {
        res.writeHead(200, {
          "Content-Type": "application/json; charset=utf-8",
          "Access-Control-Allow-Origin": "*",
          "X-Anila-Cache": "STALE",
        });
        res.end(stale);
        return;
      }
    }
    sendJson(res, 502, { error: `AniList unreachable: ${err.message}` });
  }
}

// ---------- episodes ----------
async function handleEpisodes(req, res, query) {
  const anilistId = Number(query.get("anilistId"));
  const malId = query.get("malId") ? Number(query.get("malId")) : null;
  const cache = getCaches().episodes;
  const key = `episodes:${anilistId}:${malId}`;
  const result = await remember(
    cache,
    key,
    CACHE_TTL.episodes,
    async () => {
      const tasks = [];
      if (Number.isFinite(anilistId)) {
        tasks.push(
          miruro
            .getEpisodes(anilistId)
            .then((providers) => ({ source: "miruro", providers }))
            .catch((err) => ({ source: "miruro", error: err.message })),
        );
        tasks.push(
          anibd
            .getEpisodes(anilistId)
            .then((providers) => ({ source: "anibd", providers }))
            .catch((err) => ({ source: "anibd", error: err.message })),
        );
      }
      if (Number.isFinite(malId)) {
        tasks.push(
          senshi
            .getEpisodes(malId)
            .then((providers) => ({ source: "senshi", providers }))
            .catch((err) => ({ source: "senshi", error: err.message })),
        );
      }
      const results = await Promise.all(tasks);
      const providers = [];
      const errors = {};
      for (const item of results) {
        if (item.error) {
          errors[item.source] = item.error;
          continue;
        }
        providers.push(...item.providers);
      }
      return { providers, errors };
    },
    // Cache only when at least one provider succeeded.
    (value) => value.providers && value.providers.length > 0,
  );
  sendJson(res, 200, result);
}

// ---------- sources ----------
async function handleSources(req, res, query) {
  const provider = query.get("provider");
  const category = query.get("category") === "dub" ? "dub" : "sub";
  const episode = query.get("episode") ? Number(query.get("episode")) : null;
  const anilistId = query.get("anilistId") ? Number(query.get("anilistId")) : null;
  const malId = query.get("malId") ? Number(query.get("malId")) : null;
  const pipeId = query.get("pipeId");
  const source = query.get("source");

  try {
    const cache = getCaches().sources;
    const key = `sources:${provider}:${source}:${anilistId}:${malId}:${episode}:${category}`;
    const result = await remember(
      cache,
      key,
      CACHE_TTL.sources,
      async () => {
        if (
          source === "miruro" ||
          provider === "miruro" ||
          (pipeId && provider && !["anibd", "senshi"].includes(provider))
        ) {
          return miruro.getSources({ pipeId, provider, category, anilistId, episode });
        }
        if (provider === "anibd" || source === "anibd") {
          return anibd.getSources({ anilistId, episode, category });
        }
        if (provider === "senshi" || source === "senshi") {
          return senshi.getSources({ malId, episode, category });
        }
        throw new Error(`Unknown provider: ${provider}`);
      },
      (value) => value && value.streams && value.streams.length > 0,
    );
    // Rewrite stream/subtitle URLs through the media proxy so the browser can
    // play them with the right Referer and without CORS problems.
    const proxied = {
      ...result,
      streams: result.streams.map((s) => ({
        ...s,
        originalUrl: s.url,
        proxyUrl: mediaProxyUrl(s.url, s.referer),
      })),
      subtitles: result.subtitles.map((s) => ({
        ...s,
        proxyUrl: mediaProxyUrl(s.url, s.referer || providerReferer(provider)),
      })),
    };
    sendJson(res, 200, proxied);
  } catch (err) {
    sendJson(res, 502, { error: err.message });
  }
}

function providerReferer(provider) {
  if (provider === "senshi") return "https://senshi.live/";
  if (provider === "anibd") return "https://epeng.animeapps.top/";
  return "https://www.miruro.to/";
}

function mediaProxyUrl(url, referer) {
  const params = new URLSearchParams({ url });
  if (referer) params.set("referer", referer);
  return `/api/media?${params.toString()}`;
}

// ---------- media proxy (HLS + segments + subtitles) ----------
function proxiedChildUrl(childUrl, referer) {
  const params = new URLSearchParams({ url: childUrl });
  if (referer) params.set("referer", referer);
  return `/api/media?${params.toString()}`;
}

function rewriteManifest(text, baseUrl, referer) {
  const rewriteUri = (uri) => {
    if (!uri || uri.startsWith("data:")) return uri;
    let abs;
    try {
      abs = new URL(uri, baseUrl).toString();
    } catch {
      return uri;
    }
    return proxiedChildUrl(abs, referer);
  };
  const lines = text.split(/\r?\n/);
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith("#")) {
      out.push(
        line.replace(/URI="([^"]+)"/g, (_, uri) => `URI="${rewriteUri(uri)}"`),
      );
      // Map / I-Frame-Stream / Key tags use URI="", already handled.
      continue;
    }
    if (line.trim() === "") {
      out.push(line);
      continue;
    }
    out.push(rewriteUri(line.trim()));
  }
  return out.join("\n");
}

async function handleMedia(req, res, query) {
  const url = query.get("url");
  if (!url) {
    sendJson(res, 400, { error: "Missing url" });
    return;
  }
  let target;
  try {
    target = new URL(url);
  } catch {
    sendJson(res, 400, { error: "Invalid url" });
    return;
  }
  const referer = query.get("referer") || `${target.origin}/`;
  const headers = {
    "User-Agent": DESKTOP_UA,
    Referer: referer,
    Origin: new URL(referer).origin,
    Accept: "*/*",
  };
  if (req.headers.range) headers.Range = req.headers.range;
  if (req.headers["if-none-match"]) headers["If-None-Match"] = req.headers["if-none-match"];
  if (req.headers["if-modified-since"]) {
    headers["If-Modified-Since"] = req.headers["if-modified-since"];
  }

  let upstream;
  try {
    upstream = await request(target.toString(), {
      headers,
      timeout: 30000,
      preferBrowser: true,
    });
  } catch (err) {
    console.warn(`[media] fetch failed: ${target.origin}${target.pathname} — ${err.message}`);
    sendJson(res, 502, { error: err.message });
    return;
  }
  if (upstream.status >= 400) {
    console.warn(`[media] upstream ${upstream.status}: ${target.origin}${target.pathname}`);
  }

  const contentType = upstream.headers["content-type"] || "";
  const isManifest =
    target.pathname.endsWith(".m3u8") ||
    target.href.includes(".m3u8") ||
    contentType.includes("mpegurl") ||
    contentType.includes("application/vnd.apple.mpegurl");

  const outHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "*",
    "Access-Control-Expose-Headers": "*",
    "Accept-Ranges": "bytes",
  };

  if (isManifest && upstream.status < 400) {
    const cache = getCaches().manifest;
    const key = `manifest:${hashKey(`${target.toString()}|${referer}`)}`;
    let text = cache.get(key);
    if (text === undefined) {
      text = rewriteManifest(upstream.body.toString("utf8"), upstream.url, referer);
      cache.set(key, text, CACHE_TTL.manifest);
    }
    const body = Buffer.from(text, "utf8");
    res.writeHead(upstream.status, {
      ...outHeaders,
      "Content-Type": "application/vnd.apple.mpegurl",
      "Content-Length": body.length,
      "Cache-Control": "no-cache",
    });
    res.end(body);
    return;
  }

  if (upstream.headers["content-type"]) outHeaders["Content-Type"] = upstream.headers["content-type"];
  if (upstream.headers["content-length"]) outHeaders["Content-Length"] = upstream.headers["content-length"];
  if (upstream.headers["content-range"]) outHeaders["Content-Range"] = upstream.headers["content-range"];
  if (upstream.headers["etag"]) outHeaders["ETag"] = upstream.headers["etag"];
  outHeaders["Cache-Control"] = upstream.headers["cache-control"] || "public, max-age=60";
  res.writeHead(upstream.status, outHeaders);
  if (req.method === "HEAD") {
    res.end();
  } else {
    res.end(upstream.body);
  }
}

// ---------- router ----------
export function createAppServer(options = {}) {
  if (options.cacheDir !== undefined) configureCache(options.cacheDir);
  return http.createServer(async (req, res) => {
    const parsed = new URL(req.url, `http://${req.headers.host || "localhost"}`);
    const { pathname } = parsed;

    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
        "Access-Control-Allow-Headers": "*",
      });
      res.end();
      return;
    }

    try {
      if (pathname === "/api/anilist" && req.method === "POST") {
        await handleAniList(req, res);
        return;
      }
      if (pathname === "/api/episodes") {
        await handleEpisodes(req, res, parsed.searchParams);
        return;
      }
      if (pathname === "/api/sources") {
        await handleSources(req, res, parsed.searchParams);
        return;
      }
      if (pathname === "/api/media") {
        await handleMedia(req, res, parsed.searchParams);
        return;
      }
      if (pathname === "/api/cache/clear") {
        clearCaches();
        sendJson(res, 200, { ok: true, cleared: true });
        return;
      }
      if (pathname === "/api/cache/stats") {
        sendJson(res, 200, { stats: cacheStats(), ttl: CACHE_TTL });
        return;
      }
      if (pathname === "/api/health") {
        sendJson(res, 200, { ok: true, cache: cacheStats() });
        return;
      }
      serveStatic(req, res, pathname);
    } catch (err) {
      sendJson(res, 500, { error: err.message });
    }
  });
}

export async function startAppServer({ port = 8787, host = "127.0.0.1", cacheDir } = {}) {
  const server = createAppServer({ cacheDir });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen({ port, host }, () => resolve());
  });
  return { server, port: server.address().port };
}

// ---------- CLI entry point (only when run directly) ----------
const isMain =
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isMain) {
  const PORT = Number(process.env.PORT || process.argv[2] || 8787);
  const HOST = process.env.HOST || "127.0.0.1";
  startAppServer({ port: PORT, host: HOST }).then(({ port }) => {
    const url = `http://${HOST === "0.0.0.0" ? "localhost" : HOST}:${port}/`;
    console.log(`\n  Anila Web running at ${url}\n`);
    console.log("  Providers: Miruro pipe, AniBD, Senshi");
    console.log("  Press Ctrl+C to stop.\n");
  });
}

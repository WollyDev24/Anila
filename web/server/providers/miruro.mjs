import { DESKTOP_UA, xor, gunzip, request } from "./util.mjs";

// Miruro hosts. The API lives under /api on the same origin as the site. All
// three domains serve the same backend; we try them in order. In the desktop
// app these requests are routed through a real Chromium page (see
// web/desktop/bridge.mjs) so Cloudflare's bot management lets them through.
const ORIGINS = [
  "https://www.miruro.tv",
  "https://www.miruro.bz",
  "https://www.miruro.to",
  "https://www.miruro.ru",
];

// Catalog/play responses are gzip-compressed and XOR-obfuscated with this key
// (shipped in the site bundle — not a secret). Mirrors the site's decode():
//   bytes[i] ^= key[i % key.length]; gunzip(bytes); JSON.parse(text)
const XOR_KEY = Buffer.from("miruro/catalog", "utf8");

function decodeBody(res) {
  const ct = String(res.headers["content-type"] || "").split(";")[0].trim();
  const buf = Buffer.isBuffer(res.body) ? res.body : Buffer.from(res.body || "");
  if (ct === "application/octet-stream") {
    const text = gunzip(xor(buf, XOR_KEY)).toString("utf8");
    return text ? JSON.parse(text) : null;
  }
  const text = buf.toString("utf8");
  return text ? JSON.parse(text) : null;
}

async function apiGet(origin, apiPath, query) {
  let url = `${origin}/api${apiPath}`;
  if (query && Object.keys(query).length) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null) params.set(key, String(value));
    }
    const qs = params.toString();
    if (qs) url += `?${qs}`;
  }
  const res = await request(url, {
    headers: {
      "User-Agent": DESKTOP_UA,
      Accept: "*/*",
      "Accept-Language": "en-US,en;q=0.9",
      Referer: `${origin}/`,
    },
    timeout: 30000,
  });
  if (res.status >= 400) {
    const err = new Error(`Miruro API HTTP ${res.status} for ${apiPath}`);
    err.status = res.status;
    throw err;
  }
  return decodeBody(res);
}

async function apiGetAny(apiPath, query) {
  let lastError = null;
  for (const origin of ORIGINS) {
    try {
      return await apiGet(origin, apiPath, query);
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError || new Error("Miruro unreachable");
}

// AniList id -> Miruro anime (opaque id + metadata). Resolved once per id.
const animeCache = new Map();
// Miruro anime id -> raw episode list (for skip markers), populated by getEpisodes.
const episodesCache = new Map();

async function resolveAnime(anilistId) {
  const key = String(anilistId);
  if (animeCache.has(key)) return animeCache.get(key);
  const root = await apiGetAny("/v1/anime", {
    anilist_id_in: Number(anilistId) || anilistId,
    limit: 100,
  });
  const list = (root && root.data) || [];
  let anime =
    list.find((a) =>
      (a.external_ids && a.external_ids.anilist
        ? a.external_ids.anilist
        : []
      ).some((v) => String(v) === key),
    ) || list[0] || null;
  if (anime) animeCache.set(key, anime);
  return anime;
}

function episodeEntry(e) {
  const number = Number(e.episode_number);
  return {
    id: String(e.episode_number),
    number: Number.isFinite(number) ? number : 0,
    title: e.title || null,
    image: e.thumbnail_url || null,
    filler: false,
    duration: e.duration_seconds || null,
  };
}

export async function getEpisodes(anilistId) {
  const anime = await resolveAnime(anilistId);
  if (!anime || !anime.id) return [];
  const root = await apiGetAny(
    `/v1/anime/${encodeURIComponent(anime.id)}/episodes`,
    { limit: 10000 },
  );
  const sub = ((root && root.data) || []).map(episodeEntry);
  episodesCache.set(anime.id, (root && root.data) || []);
  const dubCount = anime.episode_counts && anime.episode_counts.dub;
  const hasDub = Number(dubCount) > 0;
  return [
    {
      name: "miruro",
      label: "Miruro",
      source: "miruro",
      isEmbed: false,
      sub,
      dub: hasDub ? sub.map((e) => ({ ...e })) : [],
    },
  ];
}

function parseSkip(raw) {
  if (!raw) return null;
  // skip_times: [{ kind: "intro"|"outro", start, end }, ...] (shape varies)
  const items = Array.isArray(raw) ? raw : [];
  const find = (names) =>
    items.find((s) => names.includes(String(s.kind || s.type || "").toLowerCase()));
  const intro = find(["intro", "op", "opening"]);
  const outro = find(["outro", "ed", "ending"]);
  if (!intro && !outro) return null;
  const skip = {
    introStart: intro ? Number(intro.start) : null,
    introEnd: intro ? Number(intro.end) : null,
    outroStart: outro ? Number(outro.start) : null,
    outroEnd: outro ? Number(outro.end) : null,
  };
  const usable =
    (skip.introEnd != null && skip.introEnd > (skip.introStart ?? 0)) ||
    (skip.outroStart != null &&
      skip.outroEnd != null &&
      skip.outroEnd > skip.outroStart);
  return usable ? skip : null;
}

export async function getSources({ anilistId, episode, pipeId, category }) {
  const anime = await resolveAnime(anilistId);
  if (!anime || !anime.id) throw new Error("Miruro: title not found");
  const epNumber = Number(episode ?? pipeId);
  if (!Number.isFinite(epNumber)) throw new Error("Miruro: missing episode number");

  const root = await apiGetAny(
    `/v1/anime/${encodeURIComponent(anime.id)}/episodes/${encodeURIComponent(epNumber)}/play`,
    {},
  );
  const tracks = (root && root.tracks) || [];
  const want = category === "dub" ? "dub" : "sub";
  const track = tracks.find((t) => t.track === want) || tracks[0];
  if (!track) return { streams: [], subtitles: [], skip: null, download: null };

  const streams = [];
  const subtitles = [];
  for (const provider of track.providers || []) {
    for (const sub of provider.subtitles || []) {
      const url = sub && (sub.url || sub.file);
      if (url) {
        subtitles.push({
          url,
          label: sub.label || sub.language || "Subtitle",
          language: sub.language || sub.lang || "en",
        });
      }
    }
    for (const server of provider.servers || []) {
      const headers = server.headers || {};
      const referer = headers.Referer || headers.referer || null;
      for (const stream of server.streams || []) {
        if (!stream || !stream.url) continue;
        const isHls =
          stream.format === "hls" || String(stream.url).includes(".m3u8");
        streams.push({
          url: stream.url,
          type: isHls ? "hls" : "mp4",
          quality: stream.quality || stream.codec || provider.provider || null,
          audio: track.track === "dub" ? "dub" : "sub",
          referer,
          provider: provider.provider || null,
          server: server.server || null,
        });
      }
    }
  }

  // Intro/outro markers from the episode list fetched by getEpisodes (the
  // single-episode endpoint is not part of the supported catalog API).
  let skip = null;
  const cached = episodesCache.get(anime.id);
  if (cached) {
    const epData = cached.find(
      (e) => Number(e.episode_number) === epNumber,
    );
    skip = parseSkip(epData && epData.skip_times);
  }

  return { streams, subtitles, skip, download: null };
}

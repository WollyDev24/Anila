import { FIREFOX_UA, getJson, getText } from "./util.mjs";

// Senshi (senshi.live) — pure JSON keyed by MyAnimeList id.
const BASE = "https://senshi.live";

const headers = {
  "User-Agent": FIREFOX_UA,
  Referer: `${BASE}/`,
  Accept: "application/json, */*",
};

function isDub(embed) {
  return String(embed.status || "").toLowerCase() === "dub";
}

function skipTimes(item) {
  const value = (name) => {
    const num = Number(item[name]);
    return Number.isFinite(num) ? num : null;
  };
  const range = (start, end) => {
    const s = value(start);
    const e = value(end);
    return s != null && e != null && e > s ? [s, e] : [null, null];
  };
  const [introStart, introEnd] = range("intro_start", "intro_end");
  const [outroStart, outroEnd] = range("outro_start", "outro_end");
  if (introStart == null && outroStart == null) return null;
  return { introStart, introEnd, outroStart, outroEnd };
}

async function loadCatalog(malId) {
  const root = await getJson(`${BASE}/episodes/${malId}`, { headers });
  if (!Array.isArray(root)) return {};
  const catalog = {};
  for (const item of root) {
    const number = Number(item.ep_id);
    if (!Number.isFinite(number)) continue;
    catalog[number] = {
      title: item.ep_title || null,
      filler: item.ep_filler === true,
      skip: skipTimes(item),
    };
  }
  return catalog;
}

async function loadEmbeds(malId, episode) {
  const root = await getJson(`${BASE}/episode-embeds/${malId}/${episode}`, { headers });
  return Array.isArray(root) ? root : [];
}

function language(label) {
  const l = String(label).toLowerCase();
  if (l.includes("eng")) return "en";
  if (l.includes("spa")) return "es";
  if (l.includes("por")) return "pt";
  if (l.includes("fre") || l.includes("fra")) return "fr";
  if (l.includes("ger") || l.includes("deu")) return "de";
  return "und";
}

async function sidecar(url, base) {
  try {
    const root = await getJson(url, { headers });
    if (!Array.isArray(root)) return [];
    return root
      .map((item) => {
        const raw = item.src || item.url;
        if (!raw || String(raw).toLowerCase() === "none") return null;
        const full = /^https?:\/\//.test(raw) ? raw : `${base}/${raw}`;
        const label = item.label || item.html || "Subtitle";
        return { url: full, label, language: language(label), default: item.default === true };
      })
      .filter(Boolean)
      .sort((a, b) => Number(b.default) - Number(a.default))
      .map(({ url: u, label, language: lang }) => ({ url: u, label, language: lang }));
  } catch {
    return [];
  }
}

async function sidecarSubtitles(base, audio) {
  if (!base) return [];
  const prefix = audio === "dub" ? "dub" : "sub";
  const fileMoon = await sidecar(`${base}/${prefix}_filemoon.json`, base);
  if (fileMoon.length) return fileMoon;
  return sidecar(`${base}/${prefix}_artplayer.json`, base);
}

export async function getEpisodes(malId) {
  const catalog = await loadCatalog(malId);
  const numbers = Object.keys(catalog).map(Number);
  if (numbers.length === 0) return [];
  const first = Math.min(...numbers);
  let hasDub = false;
  try {
    hasDub = (await loadEmbeds(malId, first)).some(isDub);
  } catch {
    hasDub = false;
  }
  const toEpisodes = (list) =>
    list.map((n) => ({
      id: String(n),
      number: n,
      title: catalog[n]?.title || null,
      image: null,
      filler: catalog[n]?.filler || false,
    }));
  return [
    {
      name: "senshi",
      label: "Senshi",
      source: "anivexa",
      isEmbed: false,
      sub: toEpisodes(numbers),
      dub: hasDub ? toEpisodes(numbers) : [],
    },
  ];
}

export async function getSources({ malId, episode, category }) {
  const audio = category === "dub" ? "dub" : "sub";
  const embeds = await loadEmbeds(malId, episode);
  const source = embeds.find((e) => isDub(e) === (audio === "dub"));
  if (!source) throw new Error(`Senshi episode ${episode} has no ${audio} source`);

  const streams = [];
  if (source.url) {
    streams.push({
      url: source.url,
      type: "hls",
      quality: "Senshi",
      audio,
      referer: `${BASE}/`,
      isActive: streams.length === 0,
    });
  }
  for (const [key, label] of [
    ["server2", "Senshi StreamNin"],
    ["serverFM", "Senshi FileMoon"],
  ]) {
    if (source[key]) {
      streams.push({
        url: source[key],
        type: "embed",
        quality: label,
        audio,
        referer: `${BASE}/`,
        isActive: streams.length === 0,
      });
    }
  }
  if (streams.length === 0) throw new Error("Senshi episode has no playable sources");

  let skip = null;
  try {
    skip = (await loadCatalog(malId))[Number(episode)]?.skip || null;
  } catch {
    skip = null;
  }
  const subtitles = await sidecarSubtitles(
    source.masked_base_url ? String(source.masked_base_url).replace(/\/$/, "") : null,
    audio,
  );

  return {
    streams,
    subtitles,
    skip,
    download: source.download || null,
  };
}

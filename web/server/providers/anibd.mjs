import { DESKTOP_UA, getText } from "./util.mjs";

// AniBD (epeng.animeapps.top) — pure JSON keyed by AniList id, sub-only plus some dub groups.
const BASE = "https://epeng.animeapps.top";

function parseGroups(root) {
  if (!Array.isArray(root)) return [];
  return root
    .map((group) => {
      const name = group.server_name || "";
      const audio = /dub/i.test(name) ? "dub" : "sub";
      const episodes = {};
      for (const ep of group.server_data || []) {
        const number = Number.parseInt(ep.name || ep.slug, 10);
        if (!Number.isFinite(number) || number < 1) continue;
        if (!ep.link) continue;
        episodes[number] = ep.link;
      }
      return { audio, episodes };
    })
    .filter((g) => Object.keys(g.episodes).length > 0);
}

async function getGroups(anilistId) {
  const headers = {
    "User-Agent": DESKTOP_UA,
    Referer: `${BASE}/`,
    Accept: "application/json, text/html, */*",
  };
  const text = await getText(`${BASE}/api2.php?epid=${anilistId}`, { headers });
  return parseGroups(JSON.parse(text));
}

function extractVideoUrl(html, origin) {
  const match = html.match(/"?videoUrl"?\s*:\s*"([^"]+)"/);
  if (!match) return null;
  const raw = match[1];
  if (raw.startsWith("http://") || raw.startsWith("https://")) return raw;
  if (raw.startsWith("/")) return `${origin}${raw}`;
  return `${origin}/${raw}`;
}

function language(label) {
  const l = String(label).toLowerCase();
  if (l.includes("eng")) return "en";
  if (l.includes("spa")) return "es";
  if (l.includes("por")) return "pt";
  return "und";
}

function extractTracks(html) {
  const block = html.match(/"?tracks"?\s*:\s*\[([\s\S]*?)\]/);
  if (!block) return [];
  const entries = block[1].match(/\{[^{}]*\}/g) || [];
  const subs = [];
  for (const entry of entries) {
    const file = (entry.match(/"file"\s*:\s*"([^"]*)"/) || [])[1];
    if (!file || !file.startsWith("http")) continue;
    const kind = (entry.match(/"kind"\s*:\s*"([^"]*)"/) || [])[1];
    if (kind && kind !== "captions" && kind !== "subtitles") continue;
    const label = (entry.match(/"label"\s*:\s*"([^"]*)"/) || [])[1] || "Subtitle";
    subs.push({ url: file, label, language: language(label) });
  }
  return subs;
}

export async function getEpisodes(anilistId) {
  const groups = await getGroups(anilistId);
  if (groups.length === 0) return [];
  const subNumbers = new Set();
  const dubNumbers = new Set();
  for (const group of groups) {
    for (const key of Object.keys(group.episodes)) {
      (group.audio === "dub" ? dubNumbers : subNumbers).add(Number(key));
    }
  }
  const toEpisodes = (set) =>
    [...set]
      .sort((a, b) => a - b)
      .map((n) => ({ id: String(n), number: n, title: null, image: null, filler: false }));

  const sub = toEpisodes(subNumbers);
  const dub = toEpisodes(dubNumbers);
  if (sub.length === 0 && dub.length === 0) return [];
  return [
    {
      name: "anibd",
      label: "AniBD",
      source: "anivexa",
      isEmbed: false,
      sub,
      dub,
    },
  ];
}

export async function getSources({ anilistId, episode, category }) {
  const audio = category === "dub" ? "dub" : "sub";
  const groups = await getGroups(anilistId);
  const link = groups
    .filter((g) => g.audio === audio)
    .map((g) => g.episodes[Number(episode)])
    .find(Boolean);
  if (!link) throw new Error(`AniBD episode ${episode} has no ${audio} source`);

  const linkHeaders = { Referer: `${BASE}/`, Accept: "application/json, */*" };
  const players = JSON.parse(
    await getText(`${BASE}/apilink.php?data=${encodeURIComponent(link)}`, {
      headers: linkHeaders,
    }),
  );
  if (!Array.isArray(players) || players.length === 0) {
    throw new Error("AniBD returned no players");
  }

  const streams = [];
  const subtitles = [];
  for (const player of players.slice(0, 3)) {
    const playerUrl = player.link;
    if (!playerUrl) continue;
    const origin = new URL(playerUrl).origin;
    let html = "";
    try {
      html = await getText(playerUrl, { headers: { Referer: `${origin}/` } });
    } catch {
      continue;
    }
    const hls = extractVideoUrl(html, origin);
    if (hls) {
      streams.push({
        url: hls,
        type: "hls",
        quality: `AniBD ${player.server || ""}`.trim(),
        audio,
        referer: `${origin}/`,
        isActive: streams.length === 0,
      });
      subtitles.push(...extractTracks(html));
    } else if (html) {
      streams.push({
        url: playerUrl,
        type: "embed",
        quality: `AniBD ${player.server || ""} embed`.trim(),
        audio,
        referer: `${origin}/`,
        isActive: false,
      });
    }
  }
  if (streams.length === 0) throw new Error("AniBD episode has no playable sources");

  const dedupe = (arr, key) => {
    const seen = new Set();
    return arr.filter((item) => {
      if (seen.has(item[key])) return false;
      seen.add(item[key]);
      return true;
    });
  };

  return {
    streams: dedupe(streams, "url"),
    subtitles: dedupe(subtitles, "url"),
    skip: null,
    download: null,
  };
}

// Thin client for the local Anila server (see web/server/server.mjs).
import { remember, cacheKey } from "./cache.js";

async function getJson(url, options) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60000);
  let res;
  try {
    res = await fetch(url, { ...options, signal: controller.signal });
  } catch (err) {
    if (err.name === "AbortError") throw new Error("The server took too long to respond.");
    throw err;
  } finally {
    clearTimeout(timer);
  }
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    throw new Error(`Unexpected response from server (${res.status})`);
  }
  if (!res.ok) {
    throw new Error(data?.error || `Request failed (${res.status})`);
  }
  return data;
}

/** Fetch the merged episode catalog (Miruro + AniBD + Senshi) for one title. */
export function fetchEpisodes({ anilistId, malId }) {
  const params = new URLSearchParams();
  if (anilistId) params.set("anilistId", anilistId);
  if (malId) params.set("malId", malId);
  const key = `episodes:${cacheKey({ anilistId, malId })}`;
  return remember(key, 6 * 60 * 60 * 1000, () =>
    getJson(`/api/episodes?${params.toString()}`),
  );
}

/** Resolve playable sources for one provider/episode. */
export function fetchSources({
  provider,
  source,
  anilistId,
  malId,
  episode,
  pipeId,
  category,
}) {
  const params = new URLSearchParams();
  params.set("provider", provider);
  if (source) params.set("source", source);
  if (anilistId) params.set("anilistId", anilistId);
  if (malId) params.set("malId", malId);
  if (episode != null) params.set("episode", episode);
  if (pipeId) params.set("pipeId", pipeId);
  params.set("category", category || "sub");
  const key = `sources:${cacheKey({
    provider,
    source,
    anilistId,
    malId,
    episode,
    pipeId,
    category,
  })}`;
  return remember(key, 10 * 60 * 1000, () => getJson(`/api/sources?${params.toString()}`));
}

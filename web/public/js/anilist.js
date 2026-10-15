// AniList GraphQL client. All requests go through the local server's /api/anilist proxy.
import { getToken } from "./store.js";
import { remember, cacheKey } from "./cache.js";

// Client-side pacing so burst views (home, schedule, detail) don't trip AniList's
// ~30 req/min degraded limit. ~110ms spacing plus handling of explicit 429s.
let lastRequestAt = 0;
const MIN_SPACING_MS = 110;

// Round a timestamp to a coarse window. Queries built from Date.now() would
// otherwise produce a new cache key every second, defeating both the client and
// the server cache (and re-hitting AniList on every navigation).
const TIME_BUCKET_MS = 15 * 60 * 1000;

export function timeBucket(ms = Date.now(), bucketMs = TIME_BUCKET_MS) {
  return Math.floor(ms / bucketMs) * bucketMs;
}

async function awaitSlot() {
  const now = Date.now();
  const wait = lastRequestAt + MIN_SPACING_MS - now;
  lastRequestAt = Math.max(now, lastRequestAt + MIN_SPACING_MS);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
}

async function gql(query, variables = {}, options = {}) {
  const { auth = false, retries = 2, ttl = 0 } = options;
  // Cache public read queries; never cache authed calls (per-user data) or
  // queries explicitly marked uncacheable.
  if (ttl > 0 && !auth) {
    const key = `gql:${cacheKey([query, variables])}`;
    return remember(key, ttl, () => gqlFetch(query, variables, { auth, retries }));
  }
  return gqlFetch(query, variables, { auth, retries });
}

async function gqlFetch(query, variables = {}, { auth = false, retries = 2 } = {}) {
  await awaitSlot();
  const headers = { "Content-Type": "application/json" };
  if (auth) {
    const token = getToken();
    if (!token) throw new Error("Sign in to AniList first.");
    headers.Authorization = `Bearer ${token}`;
  }
  for (let attempt = 0; ; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 35000);
    let res;
    try {
      res = await fetch("/api/anilist", {
        method: "POST",
        headers,
        body: JSON.stringify({ query, variables }),
        signal: controller.signal,
      });
    } catch (err) {
      clearTimeout(timer);
      if (err.name === "AbortError") throw new Error("AniList request timed out.");
      throw err;
    }
    clearTimeout(timer);
    const text = await res.text();
    let payload;
    try {
      payload = JSON.parse(text);
    } catch {
      throw new Error(`AniList returned a non-JSON response (${res.status})`);
    }
    if (res.status === 401) throw new Error("AniList sign-in expired. Sign in again.");
    if (res.status === 429 && attempt < retries) {
      const retryAfter = Number(res.headers.get("Retry-After") || 3) * 1000;
      await new Promise((r) => setTimeout(r, Math.min(retryAfter, 30000)));
      continue;
    }
    if (!res.ok && !payload.errors) {
      throw new Error(`AniList error (${res.status})`);
    }
    if (payload.errors?.length) {
      const rateLimited = payload.errors.some((e) =>
        /rate limit/i.test(e.message || ""),
      );
      if (rateLimited && attempt < retries) {
        await new Promise((r) => setTimeout(r, 4000 + attempt * 4000));
        continue;
      }
      throw new Error(payload.errors.map((e) => e.message).join("; "));
    }
    return payload.data;
  }
}

const MEDIA_LIST_FIELDS = `
  id
  idMal
  title { romaji english native userPreferred }
  coverImage { large extraLarge color }
  bannerImage
  format
  season
  seasonYear
  episodes
  duration
  status
  averageScore
  popularity
  isAdult
  genres
  studios(isMain: true) { nodes { id name isAnimationStudio } }
  nextAiringEpisode { episode airingAt timeUntilAiring }
  startDate { year month day }
`;

const MEDIA_FULL_FIELDS = `
  id
  idMal
  title { romaji english native userPreferred }
  description(asHtml: false)
  coverImage { large extraLarge color }
  bannerImage
  format
  season
  seasonYear
  episodes
  duration
  status
  averageScore
  meanScore
  popularity
  favourites
  isAdult
  genres
  tags { name rank isMediaSpoiler isGeneralSpoiler }
  studios { nodes { id name isAnimationStudio } }
  trailer { id site thumbnail }
  nextAiringEpisode { episode airingAt timeUntilAiring }
  startDate { year month day }
  endDate { year month day }
  relations {
    edges { relationType node { ${MEDIA_LIST_FIELDS} } }
  }
`;

export async function homeCollections(hideAdult = false) {
  const query = `
    query ($isAdult: Boolean, $airedBefore: Int) {
      spotlight: Page(page: 1, perPage: 30) {
        media(type: ANIME, sort: [TRENDING_DESC], isAdult: $isAdult) { ${MEDIA_LIST_FIELDS} description(asHtml: false) }
      }
      newest: Page(page: 1, perPage: 50) {
        airingSchedules(airingAt_lesser: $airedBefore, sort: TIME_DESC) { media { ${MEDIA_LIST_FIELDS} } }
      }
      popular: Page(page: 1, perPage: 30) {
        media(type: ANIME, sort: [POPULARITY_DESC], isAdult: $isAdult) { ${MEDIA_LIST_FIELDS} }
      }
      movies: Page(page: 1, perPage: 30) {
        media(type: ANIME, format: MOVIE, sort: [POPULARITY_DESC], isAdult: $isAdult) { ${MEDIA_LIST_FIELDS} }
      }
      topRated: Page(page: 1, perPage: 30) {
        media(type: ANIME, sort: [SCORE_DESC], isAdult: $isAdult) { ${MEDIA_LIST_FIELDS} }
      }
    }
  `;
  // Bucket the cutoff so the request body (and therefore the cache key) stays
  // stable long enough to be cached. Otherwise Date.now() changes every second
  // and both the client and server caches always miss.
  const variables = { airedBefore: Math.floor(timeBucket() / 1000) - 90 * 60 };
  if (hideAdult) variables.isAdult = false;
  const data = await gql(query, variables, { ttl: 2 * 60 * 1000 });
  const newest = (data?.newest?.airingSchedules || [])
    .map((s) => s.media)
    .filter(Boolean);
  const deduped = [];
  const seen = new Set();
  for (const media of newest) {
    if (hideAdult && media.isAdult) continue;
    if (seen.has(media.id)) continue;
    seen.add(media.id);
    deduped.push(media);
  }
  return {
    spotlight: data?.spotlight?.media || [],
    newest: deduped,
    popular: data?.popular?.media || [],
    movies: data?.movies?.media || [],
    topRated: data?.topRated?.media || [],
  };
}

export async function search(query, page = 1, perPage = 30, hideAdult = false) {
  const gqlQuery = `
    query ($search: String, $page: Int, $perPage: Int, $isAdult: Boolean) {
      Page(page: $page, perPage: $perPage) {
        pageInfo { hasNextPage currentPage }
        media(search: $search, type: ANIME, sort: SEARCH_MATCH, isAdult: $isAdult) { ${MEDIA_LIST_FIELDS} }
      }
    }
  `;
  const variables = { search: query, page, perPage };
  if (hideAdult) variables.isAdult = false;
  const data = await gql(gqlQuery, variables, { ttl: 2 * 60 * 1000 });
  return {
    items: data?.Page?.media || [],
    hasNextPage: data?.Page?.pageInfo?.hasNextPage || false,
    page,
  };
}

export async function discover(filters, page = 1, perPage = 30, hideAdult = false) {
  const query = `
    query (
      $search: String, $page: Int, $perPage: Int, $genres: [String], $tags: [String],
      $year: Int, $status: MediaStatus, $format: MediaFormat, $minimumScore: Int,
      $sort: [MediaSort], $isAdult: Boolean
    ) {
      Page(page: $page, perPage: $perPage) {
        pageInfo { hasNextPage currentPage }
        media(
          search: $search, type: ANIME, genre_in: $genres, tag_in: $tags,
          seasonYear: $year, status: $status, format: $format,
          averageScore_greater: $minimumScore, sort: $sort, isAdult: $isAdult
        ) { ${MEDIA_LIST_FIELDS} }
      }
    }
  `;
  const variables = { page, perPage, sort: [filters.sort || "TRENDING_DESC"] };
  if (filters.query?.trim()) variables.search = filters.query.trim();
  if (hideAdult) variables.isAdult = false;
  if (filters.genres?.length) variables.genres = filters.genres;
  if (filters.tags?.length) variables.tags = filters.tags;
  if (filters.year) variables.year = filters.year;
  if (filters.status) variables.status = filters.status;
  if (filters.format) variables.format = filters.format;
  if (filters.minimumScore) variables.minimumScore = Math.max(0, filters.minimumScore - 1);
  const data = await gql(query, variables, { ttl: 5 * 60 * 1000 });
  return {
    items: data?.Page?.media || [],
    hasNextPage: data?.Page?.pageInfo?.hasNextPage || false,
    page,
  };
}

export async function discoverOptions(hideAdult = false) {
  const query = `
    query { GenreCollection MediaTagCollection { name description category isAdult } }
  `;
  const data = await gql(query, {}, { ttl: 60 * 60 * 1000 });
  let tags = data?.MediaTagCollection || [];
  if (hideAdult) tags = tags.filter((t) => !t.isAdult);
  return {
    genres: [...(data?.GenreCollection || [])].sort(),
    tags: tags.sort((a, b) => a.name.localeCompare(b.name)),
  };
}

export async function searchStudios(term, perPage = 12) {
  if (!term.trim()) return [];
  const query = `
    query ($search: String, $perPage: Int) {
      Page(page: 1, perPage: $perPage) {
        studios(search: $search, sort: [SEARCH_MATCH]) { id name isAnimationStudio }
      }
    }
  `;
  const data = await gql(query, { search: term.trim(), perPage }, { ttl: 10 * 60 * 1000 });
  return (data?.Page?.studios || []).filter(
    (s) => s.id > 0 && s.isAnimationStudio && s.name,
  );
}

export async function collection(sort, { status, format, page = 1, perPage = 30, hideAdult = false } = {}) {
  const statusFilter = status ? `, status: ${status}` : "";
  const formatFilter = format ? `, format: ${format}` : "";
  const adultFilter = hideAdult ? ", isAdult: false" : "";
  const query = `
    query ($page: Int, $perPage: Int) {
      Page(page: $page, perPage: $perPage) {
        pageInfo { hasNextPage currentPage }
        media(type: ANIME, sort: [${sort}]${statusFilter}${formatFilter}${adultFilter}) { ${MEDIA_LIST_FIELDS} }
      }
    }
  `;
  const data = await gql(query, { page, perPage }, { ttl: 5 * 60 * 1000 });
  return {
    items: data?.Page?.media || [],
    hasNextPage: data?.Page?.pageInfo?.hasNextPage || false,
    page,
  };
}

export async function animeInfo(id) {
  const query = `
    query ($id: Int) { Media(id: $id, type: ANIME) { ${MEDIA_FULL_FIELDS} } }
  `;
  const data = await gql(query, { id: Number(id) }, { ttl: 30 * 60 * 1000 });
  return data?.Media || null;
}

export async function airingSchedule(startSec, endExclusiveSec) {
  const query = `
    query ($start: Int, $end: Int, $page: Int) {
      Page(page: $page, perPage: 50) {
        pageInfo { hasNextPage currentPage }
        airingSchedules(airingAt_greater: $start, airingAt_lesser: $end, sort: TIME) {
          episode airingAt media { ${MEDIA_LIST_FIELDS} }
        }
      }
    }
  `;
  const all = [];
  let page = 1;
  let hasNext = true;
  while (hasNext && page <= 10) {
    const data = await gql(query, { start: startSec - 1, end: endExclusiveSec, page }, { ttl: 5 * 60 * 1000 });
    const parsed = data?.Page;
    if (!parsed) break;
    all.push(...(parsed.airingSchedules || []));
    hasNext = parsed.pageInfo?.hasNextPage || false;
    page++;
  }
  return all;
}

export async function mediaByIds(ids) {
  const unique = [...new Set(ids)].filter((n) => Number.isFinite(n));
  if (unique.length === 0) return [];
  const query = `
    query ($ids: [Int]) {
      Page(page: 1, perPage: 50) { media(type: ANIME, id_in: $ids) { ${MEDIA_LIST_FIELDS} } }
    }
  `;
  const out = [];
  for (let i = 0; i < unique.length; i += 50) {
    const chunk = unique.slice(i, i + 50);
    const data = await gql(query, { ids: chunk }, { ttl: 30 * 60 * 1000 });
    out.push(...(data?.Page?.media || []));
  }
  return out;
}

export async function viewer() {
  const query = `
    query {
      Viewer {
        id name avatar { large } bannerImage createdAt
        statistics { anime { count episodesWatched minutesWatched meanScore } }
      }
    }
  `;
  const data = await gql(query, {}, { auth: true });
  return data?.Viewer || null;
}

// Full profile for the Profile page: bio, banner, aggregate stats and
// favourites. Authed (per-user) so never cached.
export async function viewerProfile() {
  const query = `
    query {
      Viewer {
        id name about siteUrl createdAt
        avatar { large medium }
        bannerImage
        statistics {
          anime { count meanScore standardDeviation minutesWatched episodesWatched }
          manga { count meanScore standardDeviation chaptersRead volumesRead }
        }
        favourites {
          anime(perPage: 12) {
            pageInfo { total }
            nodes { id title { romaji english } coverImage { large } averageScore episodes format }
          }
          manga(perPage: 12) {
            pageInfo { total }
            nodes { id title { romaji english } coverImage { large } averageScore chapters format }
          }
          characters(perPage: 18) {
            pageInfo { total }
            nodes { id name { full } image { large } }
          }
          studios(perPage: 18) {
            pageInfo { total }
            nodes { id name }
          }
        }
      }
    }
  `;
  const data = await gql(query, {}, { auth: true });
  return data?.Viewer || null;
}

export async function userAnimeList(userId) {
  const query = `
    query ($userId: Int) {
      MediaListCollection(userId: $userId, type: ANIME, status_in: [CURRENT, REPEATING, PLANNING, PAUSED, COMPLETED, DROPPED]) {
        lists {
          name status isCustomList
          entries { id progress score(format: POINT_10_DECIMAL) status media { ${MEDIA_LIST_FIELDS} } }
        }
      }
    }
  `;
  const data = await gql(query, { userId }, { auth: true });
  return data?.MediaListCollection || null;
}

export async function mediaListEntry(mediaId) {
  const query = `
    query ($mediaId: Int) {
      Media(id: $mediaId, type: ANIME) { mediaListEntry { id status progress } }
    }
  `;
  const data = await gql(query, { mediaId }, { auth: true });
  return data?.Media?.mediaListEntry || null;
}

export async function updateStatus(mediaId, status) {
  const mutation = `
    mutation ($mediaId: Int, $status: MediaListStatus) {
      SaveMediaListEntry(mediaId: $mediaId, status: $status) { id status progress }
    }
  `;
  await gql(mutation, { mediaId, status }, { auth: true });
}

export async function deleteEntry(entryId) {
  const mutation = `mutation ($id: Int) { DeleteMediaListEntry(id: $id) { deleted } }`;
  await gql(mutation, { id: entryId }, { auth: true });
}

/**
 * Push watched progress without regressing it. Mirrors the app's rule: only move forward, and only
 * promote PLANNING -> CURRENT (or COMPLETED) without disturbing user-chosen statuses.
 */
export async function syncProgress(mediaId, watchedProgress, totalEpisodes) {
  if (!watchedProgress || watchedProgress < 1) return null;
  const current = await mediaListEntry(mediaId);
  if (current && watchedProgress <= current.progress) return null;
  if (current?.status === "COMPLETED") return null;
  const completed = totalEpisodes > 0 && watchedProgress >= totalEpisodes;
  let status = null;
  if (!current) status = completed ? "COMPLETED" : "CURRENT";
  else if (current.status === "PLANNING") status = completed ? "COMPLETED" : "CURRENT";
  else if (current.status === "CURRENT" && completed) status = "COMPLETED";
  const statusDecl = status ? ", $status: MediaListStatus" : "";
  const statusArg = status ? ", status: $status" : "";
  const mutation = `
    mutation ($mediaId: Int, $progress: Int${statusDecl}) {
      SaveMediaListEntry(mediaId: $mediaId, progress: $progress${statusArg}) { id progress status }
    }
  `;
  const variables = { mediaId, progress: watchedProgress };
  if (status) variables.status = status;
  await gql(mutation, variables, { auth: true });
  return { progress: watchedProgress, status };
}

/** Save (PLANNING) or unsave a title, without damaging an existing status. */
export async function syncSavedAnime(mediaId, saved) {
  const current = await mediaListEntry(mediaId);
  if (saved && !current) {
    await updateStatus(mediaId, "PLANNING");
  } else if (!saved && current?.status === "PLANNING") {
    await deleteEntry(current.id);
  }
}

// ---------- OAuth (implicit grant) ----------
export const ANILIST_CLIENT_ID = "45552";
export const ANILIST_REDIRECT = "http://localhost";

export function authorizeUrl(clientId = ANILIST_CLIENT_ID) {
  const state = crypto.randomUUID();
  sessionStorage.setItem("anila.oauth.state", state);
  const params = new URLSearchParams({
    client_id: clientId,
    response_type: "token",
    state,
  });
  return `https://anilist.co/api/v2/oauth/authorize?${params.toString()}`;
}

export function extractTokenFromHash(hash, expectedState) {
  const params = new URLSearchParams(String(hash).replace(/^#/, ""));
  const token = params.get("access_token");
  const state = params.get("state");
  if (expectedState && state && state !== expectedState) return null;
  return token;
}

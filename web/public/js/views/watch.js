import { animeInfo, syncProgress } from "../anilist.js";
import { fetchEpisodes, fetchSources } from "../api.js";
import { getSettings, getToken, getProgress, setProgress } from "../store.js";
import { createPlayer } from "../player.js";
import { escapeHtml, titleOf, coverOf, spinner, toast, clock, isStale } from "../ui.js";
import { dropdownHtml, initDropdowns } from "../dropdown.js";
import { setRichActivity, watchingActivity } from "../presence.js";

let cache = { mediaId: null, media: null, catalog: null };
let player = null;
let current = null;
let shellDropdowns = {};

// ---- Discord presence state ----
let presenceBase = null;
let presenceKey = "";
let presencePosition = 0;
let presenceDuration = 0;
let presencePaused = false;

function pushWatching(force = false) {
  if (!presenceBase) return;
  const key = [
    presenceBase.episode,
    presenceBase.title,
    presencePaused ? "p" : "r",
    Math.floor(presencePosition / 15),
    Math.floor(presenceDuration),
  ].join("|");
  if (!force && key === presenceKey) return;
  presenceKey = key;
  setRichActivity(
    watchingActivity({
      ...presenceBase,
      position: presencePosition,
      duration: presenceDuration,
      paused: presencePaused,
    }),
  );
}

function withTimeout(promise, ms, label) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`${label} timed out after ${Math.round(ms / 1000)}s`)),
      ms,
    );
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

export async function render(container, params = {}) {
  const id = Number(params.id);
  if (!id) {
    container.innerHTML = `<div class="error-box">Invalid anime id.</div>`;
    return;
  }
  const settings = getSettings();
  const storedProgress = getProgress(id);
  const episodeNumber = params.ep ? Number(params.ep) : storedProgress?.episode || 1;

  container.innerHTML = spinner("Loading title…");
  const token = container.__viewToken;
  console.log(`[anila] watch: load anime ${id} episode ${episodeNumber}`);

  try {
    if (cache.mediaId !== id || !cache.media) {
      const media = await withTimeout(animeInfo(id), 35000, "Loading title");
      cache = { mediaId: id, media, catalog: null };
    }
    const media = cache.media;
    if (!media) throw new Error("Anime not found");
    if (isStale(container, token)) return;
    console.log(`[anila] watch: media loaded (${media.id})`);

    if (!cache.catalog) {
      container.innerHTML = spinner("Loading episodes…");
      cache.catalog = await withTimeout(
        fetchEpisodes({ anilistId: media.id, malId: media.idMal }),
        35000,
        "Loading episodes",
      );
    }
    const catalog = cache.catalog;
    if (isStale(container, token)) return;
    console.log(
      `[anila] watch: catalog ready — ${(catalog.providers || []).length} provider(s)`,
      catalog.errors || {},
    );

    const providers = (catalog.providers || []).filter(
      (p) => p.sub.length || p.dub.length,
    );
    if (providers.length === 0) {
      const detail = Object.entries(catalog.errors || {})
        .map(([k, v]) => `${k}: ${v}`)
        .join("\n");
      throw new Error(`No providers returned episodes.\n${detail}`);
    }

    const preferred = settings.preferredProvider;
    const ordered = sortProviders(providers, preferred);

    // Choose the first provider that actually has the requested episode in some category.
    let chosen = null;
    for (const provider of ordered) {
      for (const category of ["sub", "dub"]) {
        const episode = findEpisode(provider, category, episodeNumber);
        if (episode) {
          chosen = { provider, category, episode };
          break;
        }
      }
      if (chosen) break;
    }
    if (!chosen) throw new Error(`Episode ${episodeNumber} is not available from any provider.`);

    current = { media, catalog, providers: ordered, ...chosen };
    await renderShell(container, episodeNumber);
    await resolveAndPlay(container);
  } catch (err) {
    if (!isStale(container, token)) {
      container.innerHTML = `<div class="error-box">${escapeHtml(
        err.message,
      ).replace(/\n/g, "<br>")}</div>`;
    }
  }
}

function sortProviders(providers, preferred) {
  const preferredNames = [preferred, ...(getSettings().fallbackProviders || [])].filter(Boolean);
  return [...providers].sort((a, b) => {
    const ai = preferredNames.indexOf(a.name);
    const bi = preferredNames.indexOf(b.name);
    if (ai !== -1 || bi !== -1) return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
    return 0;
  });
}

function findEpisode(provider, category, number) {
  const list = category === "dub" ? provider.dub : provider.sub;
  if (!list || list.length === 0) return null;
  return (
    list.find((e) => Number(e.number) === Number(number)) ||
    list.find((e) => Math.abs(Number(e.number) - Number(number)) < 0.001) ||
    null
  );
}

let shellContainer = null;
async function renderShell(container, episodeNumber) {
  shellContainer = container;
  const { media, provider, category } = current;
  const title = titleOf(media);
  const episode = findEpisode(provider, category, episodeNumber);

  presenceBase = {
    title,
    cover: coverOf(media),
    url: media.siteUrl,
    episode: episode ? episode.number : episodeNumber,
  };
  presencePosition = 0;
  presenceDuration = 0;
  presencePaused = false;
  pushWatching(true);

  const episodes = category === "dub" ? provider.dub : provider.sub;
  const hasDub = provider.dub.length > 0;

  const providerOptions = current.providers
    .filter((p) => findEpisode(p, category, episodeNumber) || p.dub.length || p.sub.length)
    .map((p) => [
      p.name,
      `${p.label}${p.isEmbed ? " (embed)" : ""}${p.source ? ` · ${p.source}` : ""}`,
    ]);

  container.innerHTML = `
    <div class="watch-layout">
      <div>
        <div class="player-shell" id="player"></div>
        <div class="player-bar">
          ${dropdownHtml("providerSelect", providerOptions, provider.name, {
            className: "source-dd",
            label: "Source provider",
          })}
          ${
            hasDub
              ? `<div class="chip-row" style="margin:0">
                  <button class="chip clickable ${category === "sub" ? "active" : ""}" data-cat="sub">Sub</button>
                  <button class="chip clickable ${category === "dub" ? "active" : ""}" data-cat="dub">Dub</button>
                </div>`
              : ""
          }
          ${dropdownHtml("streamSelect", [], "", { className: "source-dd", label: "Stream", placeholder: "Source" })}
          <a class="btn ghost small" href="#/anime/${media.id}">Details</a>
        </div>
        <div id="playerNote"></div>
      </div>
      <aside class="panel">
        <h3>${escapeHtml(title)}</h3>
        <div class="hint" style="color:var(--muted);margin-bottom:12px">
          ${escapeHtml(provider.label)} · ${category.toUpperCase()} · ${
            episode ? `Episode ${escapeHtml(String(episode.number))}` : ""
          }
        </div>
        <div class="ep-list" id="epList">
          ${episodes
            .map(
              (e) => `<button class="ep-item ${
                Number(e.number) === Number(episodeNumber) ? "active" : ""
              }" data-ep="${e.number}">
                <span class="ep-num">${escapeHtml(String(e.number))}</span>
                <span class="ep-name">${escapeHtml(e.title || `Episode ${e.number}`)}</span>
                ${e.filler ? `<span class="ep-filler">filler</span>` : ""}
              </button>`,
            )
            .join("")}
        </div>
      </aside>
    </div>
  `;

  const streamEl = container.querySelector('[data-dd="streamSelect"]');
  if (streamEl) streamEl.style.display = "none";

  shellDropdowns = initDropdowns(container, {
    providerSelect: async (value) => {
      const next = current.providers.find((p) => p.name === value);
      const episodeMatch = findEpisode(next, current.category, episodeNumber);
      const nextCategory = episodeMatch
        ? current.category
        : next.sub.some((x) => Number(x.number) === Number(episodeNumber))
          ? "sub"
          : "dub";
      current.provider = next;
      current.category = nextCategory;
      current.episode = findEpisode(next, nextCategory, episodeNumber);
      if (!current.episode) {
        toast("That provider does not have this episode.", "error");
        return;
      }
      await renderShell(container, episodeNumber);
      await resolveAndPlay(container);
    },
    streamSelect: (value) => {
      if (current?.sourcesResult) mountStream(container, current.sourcesResult, Number(value));
    },
  });

  container.querySelectorAll("[data-cat]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const cat = btn.dataset.cat;
      const episodeMatch = findEpisode(current.provider, cat, episodeNumber);
      if (!episodeMatch) {
        toast(`No ${cat} source for this episode.`, "error");
        return;
      }
      current.category = cat;
      current.episode = episodeMatch;
      await renderShell(container, episodeNumber);
      await resolveAndPlay(container);
    });
  });

  container.querySelector("#epList")?.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-ep]");
    if (!btn) return;
    location.hash = `#/watch/${current.media.id}/${btn.dataset.ep}`;
  });
}

async function resolveAndPlay(container) {
  const { media, provider, category, episode } = current;
  const token = container.__viewToken;
  const note = container.querySelector("#playerNote");
  const streamDd = shellDropdowns.streamSelect;
  if (note) note.innerHTML = spinner("Resolving sources…");
  console.log(
    `[anila] watch: resolving sources — provider=${provider.name} source=${provider.source || "-"} ep=${episode.number}`,
  );
  try {
    const result = await withTimeout(
      fetchSources({
        provider: provider.name,
        source: provider.source,
        anilistId: media.id,
        malId: media.idMal,
        episode: episode.number,
        pipeId: episode.id,
        category,
      }),
      60000,
      "Resolving sources",
    );
    if (isStale(container, token)) return;
    console.log(`[anila] watch: got ${result.streams?.length || 0} stream(s)`);
    if (note) note.innerHTML = "";
    if (!result.streams || result.streams.length === 0) {
      throw new Error("No playable streams were returned.");
    }
    current.sourcesResult = result;

    const playable = result.streams;
    if (streamDd) {
      streamDd.el.style.display = playable.length > 1 ? "" : "none";
      streamDd.setOptions(
        playable.map((s, i) => [
          String(i),
          `${s.quality || s.type || "Source"}${s.type ? ` · ${s.type}` : ""}`,
        ]),
        "0",
      );
    }
    mountStream(container, result, 0);
  } catch (err) {
    if (note) note.innerHTML = `<div class="error-box">${escapeHtml(err.message)}</div>`;
  }
}

function mountStream(container, result, index) {
  const playerEl = container.querySelector("#player");
  if (player) {
    player.destroy();
    player = null;
  }
  const stream = result.streams[index];
  const stored = getProgress(current.media.id);
  const startTime = Number(stored?.episode) === Number(current.episode.number) ? stored?.positionSec || 0 : 0;
  const settings = getSettings();

  presencePosition = startTime || 0;
  presenceDuration = 0;
  presencePaused = false;

  if (stream.type === "embed") {
    playerEl.innerHTML = `<iframe class="player-embed" src="${stream.url}" allowfullscreen referrerpolicy="no-referrer"></iframe>`;
    markProgressAt(current.media, current.episode.number, 0, 0);
    pushWatching(true);
    return;
  }

  player = createPlayer(playerEl, {
    stream,
    subtitles: result.subtitles || [],
    skip: result.skip || null,
    startTime,
    autoplay: true,
    skipIntro: settings.skipIntro,
    skipOutro: settings.skipOutro,
    subtitleLanguage: settings.subtitleLanguage,
    onProgress: (position, duration) => {
      markProgressAt(current.media, current.episode.number, position, duration, true);
      presencePosition = position || 0;
      presenceDuration = duration || 0;
      pushWatching();
    },
    onPlay: () => {
      presencePaused = false;
      pushWatching(true);
    },
    onPause: () => {
      presencePaused = true;
      pushWatching(true);
    },
    onEnded: () => handleEnded(),
    onError: (reason) => {
      const token = container.__viewToken;
      const note = container.querySelector("#playerNote");
      if (!note || isStale(container, token)) return;
      note.innerHTML =
        `<div class="error-box">Playback failed: ${escapeHtml(reason)}. ` +
        `<button class="btn small ghost" id="retryPlay">Retry</button> ` +
        `<button class="btn small ghost" id="nextSource">Try another source</button></div>`;
      note.querySelector("#retryPlay")?.addEventListener("click", () => resolveAndPlay(container));
      note.querySelector("#nextSource")?.addEventListener("click", () => {
        const dd = shellDropdowns.streamSelect;
        if (dd && dd.values.length > 1) {
          const next = dd.values[(dd.values.indexOf(dd.value) + 1) % dd.values.length];
          dd.setValue(next, true);
        } else {
          toast("No other sources for this episode.", "error");
        }
      });
    },
  });
}

function markProgressAt(media, episode, position, duration, saveServer = false) {
  const total = media.episodes || duration ? Math.max(media.episodes || 0, episode) : episode;
  setProgress(media.id, {
    episode,
    positionSec: position || 0,
    durationSec: duration || 0,
    totalEpisodes: media.episodes || null,
    title: media.title,
    coverImage: media.coverImage,
    format: media.format,
    seasonYear: media.seasonYear,
  });
  if (saveServer && getToken() && duration > 0 && position / duration > 0.85) {
    maybeSync(media, episode);
  }
}

let lastSynced = {};
function maybeSync(media, episode) {
  if (lastSynced[media.id] === episode) return;
  lastSynced[media.id] = episode;
  syncProgress(media.id, episode, media.episodes).catch(() => {
    /* silent — sync is best effort */
  });
}

function handleEnded() {
  const { media, provider, category, episode } = current;
  setProgress(media.id, {
    episode: episode.number,
    positionSec: 0,
    durationSec: 0,
    totalEpisodes: media.episodes || null,
    title: media.title,
    coverImage: media.coverImage,
    format: media.format,
    seasonYear: media.seasonYear,
  });
  maybeSync(media, episode.number);
  if (!getSettings().autoplayNext) return;
  const list = category === "dub" ? provider.dub : provider.sub;
  const next = list.find((e) => Number(e.number) > Number(episode.number));
  if (!next) return;
  // Prefer the same provider for the next episode.
  const nextEp = findEpisode(provider, category, next.number);
  if (nextEp) {
    location.hash = `#/watch/${media.id}/${next.number}`;
  }
}

export function cleanup() {
  if (player) {
    player.destroy();
    player = null;
  }
  current = null;
  presenceBase = null;
  presenceKey = "";
}

export function resetCache() {
  cache = { mediaId: null, media: null, catalog: null };
}

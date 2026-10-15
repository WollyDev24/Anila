import { userAnimeList, updateStatus } from "../anilist.js";
import {
  getToken,
  getViewer,
  getLibrary,
  getContinueWatching,
  toggleSaved,
} from "../store.js";
import { escapeHtml, spinner, titleOf, coverOf, toast, isStale } from "../ui.js";
import { cardHtml, gridHtml, railHtml, sectionHead } from "./shared.js";

const STATUS_TABS = [
  ["CURRENT", "Watching"],
  ["PLANNING", "Planning"],
  ["COMPLETED", "Completed"],
  ["PAUSED", "Paused"],
  ["DROPPED", "Dropped"],
  ["REPEATING", "Rewatching"],
];

let activeTab = "CURRENT";

export async function render(container) {
  if (!getToken()) {
    renderLocal(container);
    return;
  }
  container.innerHTML = `<h1 class="page-title">Library</h1>` + spinner("Loading your AniList…");
  const token = container.__viewToken;
  const viewer = getViewer();
  if (!viewer?.id) {
    container.innerHTML = `<div class="error-box">Your session is missing a viewer id. Reconnect in Settings.</div>`;
    return;
  }
  let collection;
  try {
    collection = await userAnimeList(viewer.id);
  } catch (err) {
    if (!isStale(container, token))
      container.innerHTML = `<div class="error-box">${escapeHtml(err.message)}</div>`;
    return;
  }
  if (isStale(container, token)) return;

  const lists = collection?.lists || [];
  const byStatus = {};
  for (const list of lists) {
    if (!list.status || list.isCustomList) continue;
    byStatus[list.status] = (byStatus[list.status] || []).concat(list.entries || []);
  }

  const continueWatching = getContinueWatching().slice(0, 20);

  container.innerHTML = `
    <h1 class="page-title">Library</h1>
    ${continueWatching.length ? sectionHead("Continue watching", null) + railHtml(continueWatching.map(progressToMedia)) : ""}
    <div class="tabs" id="libTabs">
      ${STATUS_TABS.map(
        ([v, l]) =>
          `<button data-tab="${v}" class="${v === activeTab ? "active" : ""}">${l} <span style="color:var(--muted-2)">${
            (byStatus[v] || []).length
          }</span></button>`,
      ).join("")}
    </div>
    <div id="tabContent"></div>
  `;

  const renderTab = () => {
    const entries = (byStatus[activeTab] || []).slice().sort((a, b) => {
      const ap = Number(a.media?.nextAiringEpisode?.timeUntilAiring ?? Infinity);
      const bp = Number(b.media?.nextAiringEpisode?.timeUntilAiring ?? Infinity);
      return ap - bp;
    });
    const cards = entries
      .filter((e) => e.media)
      .map((e) => {
        const media = e.media;
        let badge = null;
        if (media.nextAiringEpisode?.timeUntilAiring) {
          badge = `EP ${media.nextAiringEpisode.episode} · ${formatDays(media.nextAiringEpisode.timeUntilAiring)}`;
        } else if (media.episodes) {
          badge = `${e.progress}/${media.episodes}`;
        }
        const href = `#/watch/${media.id}/${Math.min(e.progress + 1, media.episodes || e.progress + 1)}`;
        return `<div style="position:relative">${cardHtml(media, {
          href,
          badge,
          sub: `${e.progress}${media.episodes ? "/" + media.episodes : ""} watched`,
        })}<button class="btn small ghost remove-entry" data-entry="${media.id}" style="position:absolute;top:6px;right:6px;padding:4px 8px" title="Remove from AniList">✕</button></div>`;
      })
      .join("");
    document.getElementById("tabContent").innerHTML = cards
      ? `<div class="grid">${cards}</div>`
      : `<div class="empty">No anime in this list.</div>`;

    document.querySelectorAll(".remove-entry").forEach((btn) => {
      btn.addEventListener("click", async (e) => {
        e.preventDefault();
        const mediaId = Number(btn.dataset.entry);
        try {
          const entry = entries.find((x) => x.media.id === mediaId);
          if (entry?.id) {
            const { deleteEntry } = await import("../anilist.js");
            await deleteEntry(entry.id);
          }
          toast("Removed from AniList");
          render(container);
        } catch (err) {
          toast(err.message, "error");
        }
      });
    });
  };

  document.getElementById("libTabs").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-tab]");
    if (!btn) return;
    activeTab = btn.dataset.tab;
    document.querySelectorAll("#libTabs button").forEach((b) => b.classList.toggle("active", b === btn));
    renderTab();
  });
  renderTab();
}

function renderLocal(container) {
  const library = Object.values(getLibrary());
  const continueWatching = getContinueWatching();
  container.innerHTML = `
    <h1 class="page-title">Library</h1>
    <div class="panel" style="margin-bottom:20px">
      <div class="label">You are browsing locally.</div>
      <div class="hint">Sign in to AniList from Settings to sync your lists and watch progress across devices.</div>
    </div>
    ${continueWatching.length ? sectionHead("Continue watching", null) + railHtml(continueWatching.map(progressToMedia)) : ""}
    ${sectionHead(`Saved (${library.length})`, null)}
    ${
      library.length
        ? gridHtml(library, { href: undefined }).replace(/href="#\/anime\/undefined"/g, "")
        : `<div class="empty">No saved anime yet. Tap ♡ on any title to save it.</div>`
    }
  `;
  container.querySelectorAll(".card").forEach((card, i) => {
    const item = library[i];
    if (item) card.setAttribute("href", `#/anime/${item.id}`);
  });
}

function progressToMedia(entry) {
  const total = entry.totalEpisodes || 0;
  const pct = total > 0 ? Math.min(1, (entry.episode || 0) / total) : 0;
  return {
    id: entry.mediaId,
    title: entry.title || { userPreferred: "Untitled" },
    coverImage: entry.coverImage || {},
    format: entry.format,
    seasonYear: entry.seasonYear,
    episodes: total || null,
    _progress: pct,
  };
}

function formatDays(seconds) {
  const days = Math.floor(seconds / 86400);
  if (days > 0) return `${days}d`;
  const hours = Math.floor(seconds / 3600);
  return `${hours}h`;
}

/** Used by the detail screen's AniList list modal. */
export async function saveToListFromDetail(mediaId, status) {
  await updateStatus(mediaId, status);
}

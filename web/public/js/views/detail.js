import { animeInfo } from "../anilist.js";
import {
  getToken,
  getProgress,
  isSaved,
  toggleSaved,
} from "../store.js";
import { saveToListFromDetail } from "./library.js";
import {
  escapeHtml,
  titleOf,
  coverOf,
  heroOf,
  spinner,
  toast,
  openModal,
  closeModal,
  countdown,
  formatDate,
  isStale,
} from "../ui.js";
import { railHtml, sectionHead } from "./shared.js";
import { setRichActivity, viewingActivity } from "../presence.js";

export async function render(container, params = {}) {
  const id = Number(params.id);
  if (!id) {
    container.innerHTML = `<div class="error-box">Invalid anime id.</div>`;
    return;
  }
  container.innerHTML = spinner("Loading details…");
  const token = container.__viewToken;
  let media;
  try {
    media = await animeInfo(id);
  } catch (err) {
    if (!isStale(container, token))
      container.innerHTML = `<div class="error-box">${escapeHtml(err.message)}</div>`;
    return;
  }
  if (!media || isStale(container, token)) {
    if (media && !isStale(container, token))
      container.innerHTML = `<div class="error-box">Anime not found.</div>`;
    return;
  }

  const title = titleOf(media);
  const cover = coverOf(media);
  const banner = heroOf(media);
  setRichActivity(viewingActivity({ title, cover, url: media.siteUrl }));
  const progress = getProgress(media.id);
  const resumeEp = progress?.episode || 1;

  const meta = [
    media.format,
    formatDate(media.startDate),
    media.episodes ? `${media.episodes} episodes` : null,
    media.duration ? `${media.duration} min` : null,
    media.status,
    media.averageScore ? `★ ${media.averageScore}%` : null,
    media.studios?.nodes?.map((s) => s.name).filter(Boolean).join(", "),
  ].filter(Boolean);

  const relations = (media.relations?.edges || [])
    .filter((e) => e.node && !e.node.isAdult)
    .map((e) => e.node)
    .slice(0, 20);

  const next = media.nextAiringEpisode;
  const nextLine = next
    ? `<div class="field"><div><div class="label">Episode ${next.episode} airs</div><div class="hint">in ${countdown(
        next.airingAt,
      )}</div></div></div>`
    : "";

  container.innerHTML = `
    <section class="detail-hero">
      <div class="hero-bg" style="background-image:url('${banner}')"></div>
      <div class="detail-hero-body">
        <div class="detail-cover"><img src="${cover}" alt="${escapeHtml(title)}" /></div>
        <div>
          <h1 class="detail-title">${escapeHtml(title)}</h1>
          <div class="hero-meta">${meta.map(escapeHtml).join(" <span>·</span> ")}</div>
          <div class="hero-actions">
            <a class="btn primary" href="#/watch/${media.id}/${resumeEp}">▶ ${
              progress ? `Resume ep ${resumeEp}` : "Watch now"
            }</a>
            <button class="btn ghost" id="listBtn">${listButtonLabel(media)}</button>
            <button class="btn ghost" id="saveBtn">${isSaved(media) ? "♥ Saved" : "♡ Save"}</button>
          </div>
        </div>
      </div>
    </section>

    <div class="detail-grid">
      <div>
        <h2 class="page-title" style="font-size:18px;margin-bottom:10px">Synopsis</h2>
        <p class="synopsis">${escapeHtml(
          String(media.description || "No synopsis available.").replace(/<[^>]+>/g, ""),
        )}</p>
        <div class="chip-row">
          ${(media.genres || [])
            .map((g) => `<a class="chip clickable" href="#/browse?genre=${encodeURIComponent(g)}">${escapeHtml(g)}</a>`)
            .join("")}
        </div>
        ${relations.length ? sectionHead("Related", null) + railHtml(relations) : ""}
      </div>
      <aside>
        <div class="panel">
          <h3>Details</h3>
          <div class="meta-list">
            <b>Status</b><span>${escapeHtml(media.status || "—")}</span>
            <b>Format</b><span>${escapeHtml(media.format || "—")}</span>
            <b>Episodes</b><span>${media.episodes ?? "?"}</span>
            <b>Duration</b><span>${media.duration ? media.duration + " min" : "—"}</span>
            <b>Season</b><span>${escapeHtml(
              [media.season, media.seasonYear].filter(Boolean).join(" ") || "—",
            )}</span>
            <b>Score</b><span>${media.averageScore ? media.averageScore + "%" : "—"}</span>
            <b>Popularity</b><span>${media.popularity ?? "—"}</span>
            ${
              media.idMal
                ? `<b>MAL</b><span><a href="https://myanimelist.net/anime/${media.idMal}" target="_blank" rel="noopener">#${media.idMal}</a></span>`
                : ""
            }
          </div>
          ${nextLine}
        </div>
      </aside>
    </div>
  `;

  container.querySelector("#saveBtn")?.addEventListener("click", (e) => {
    const saved = toggleSaved(media);
    e.currentTarget.textContent = saved ? "♥ Saved" : "♡ Save";
    toast(saved ? "Saved to your library" : "Removed from library");
  });
  container.querySelector("#listBtn")?.addEventListener("click", () => openListModal(media));
}

function listButtonLabel(media) {
  return getToken() ? "+ AniList list" : "+ Add to library";
}

function openListModal(media) {
  if (!getToken()) {
    const saved = toggleSaved(media);
    toast(saved ? "Saved to your local library" : "Removed from library");
    document.getElementById("listBtn").textContent = saved ? "♥ In library" : listButtonLabel(media);
    return;
  }
  const statuses = [
    ["CURRENT", "Watching"],
    ["PLANNING", "Planning"],
    ["COMPLETED", "Completed"],
    ["REPEATING", "Rewatching"],
    ["PAUSED", "Paused"],
    ["DROPPED", "Dropped"],
  ];
  const body = `<div class="chip-row">${statuses
    .map(([v, l]) => `<button class="chip clickable" data-status="${v}">${l}</button>`)
    .join("")}</div>
    <div style="margin-top:12px"><button class="btn small" id="removeEntry">Remove from AniList</button></div>`;
  const modal = openModal({ title: "Add to AniList", body, actions: [{ label: "Close" }] });
  modal.querySelectorAll("[data-status]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      try {
        await saveToListFromDetail(media.id, btn.dataset.status);
        toast(`Added to ${btn.textContent}`);
        closeModal();
      } catch (err) {
        toast(err.message, "error");
      }
    });
  });
  modal.querySelector("#removeEntry")?.addEventListener("click", async () => {
    try {
      const { syncSavedAnime } = await import("../anilist.js");
      await syncSavedAnime(media.id, false);
      toast("Removed from AniList");
      closeModal();
    } catch (err) {
      toast(err.message, "error");
    }
  });
}

import { escapeHtml, titleOf, coverOf } from "../ui.js";

const PLACEHOLDER =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="450"><rect width="300" height="450" fill="#1c1c2b"/><text x="150" y="230" fill="#4a4a60" font-family="sans-serif" font-size="18" text-anchor="middle">Anila</text></svg>',
  );

export function posterUrl(media) {
  return coverOf(media) || PLACEHOLDER;
}

/**
 * A poster card.
 * @param {object} media AniList Media object (or a lightweight local shape).
 * @param {object} opts { href, progress (0-1), badge, sub }
 */
export function cardHtml(media, opts = {}) {
  const title = titleOf(media);
  const cover = posterUrl(media);
  const href = opts.href || `#/anime/${media.id}`;
  const sub =
    opts.sub ??
    [media.format, media.seasonYear, media.episodes ? `${media.episodes} ep` : null]
      .filter(Boolean)
      .join(" · ");
  const progressBar =
    opts.progress != null
      ? `<div class="progress-bar"><i style="width:${Math.round(opts.progress * 100)}%"></i></div>`
      : "";
  const badge = opts.badge ? `<span class="badge">${escapeHtml(opts.badge)}</span>` : "";
  return `<a class="card" href="${href}" style="--cover:url('${cover}')">
    <div class="poster">
      ${badge}
      <img loading="lazy" src="${cover}" alt="${escapeHtml(title)}" onerror="this.src='${PLACEHOLDER}'" />
      <span class="poster-shade"></span>
      <span class="poster-play" aria-hidden="true">
        <svg viewBox="0 0 24 24" width="22" height="22"><path d="M8 5v14l11-7z" fill="currentColor"/></svg>
      </span>
      ${progressBar}
    </div>
    <div class="title">${escapeHtml(title)}</div>
    ${sub ? `<div class="sub">${escapeHtml(sub)}</div>` : ""}
  </a>`;
}

export function railHtml(items, opts = {}) {
  if (!items || items.length === 0) return "";
  return `<div class="rail">${items.map((m) => cardHtml(m, opts)).join("")}</div>`;
}

export function gridHtml(items, opts = {}) {
  if (!items || items.length === 0) {
    return `<div class="empty">Nothing to show yet.</div>`;
  }
  return `<div class="grid">${items.map((m) => cardHtml(m, opts)).join("")}</div>`;
}

export function sectionHead(title, moreHref, moreLabel = "View all") {
  return `<div class="section-head">
    <h2>${escapeHtml(title)}</h2>
    ${moreHref ? `<a class="more" href="${moreHref}">${escapeHtml(moreLabel)} ›</a>` : ""}
  </div>`;
}

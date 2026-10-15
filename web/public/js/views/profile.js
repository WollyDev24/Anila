// AniList profile page: banner, avatar, bio ("about me"), aggregate stats and
// favourites. Per-user data, so it is never cached — and it needs a token.
import { viewerProfile } from "../anilist.js";
import { getToken, clearToken } from "../store.js";
import { escapeHtml, spinner, toast, isStale } from "../ui.js";
import { railHtml } from "./shared.js";
import { startSignIn } from "./settings.js";

const nf = new Intl.NumberFormat();

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? nf.format(n) : "—";
}

// minutes -> "3d 5h" / "5h 20m" / "45m"
export function formatWatched(minutes) {
  const total = Math.max(0, Math.round(Number(minutes) || 0));
  if (total < 60) return `${total}m`;
  const days = Math.floor(total / 1440);
  const hours = Math.floor((total % 1440) / 60);
  const mins = total % 60;
  if (days > 0) return `${nf.format(days)}d ${hours}h`;
  return mins ? `${nf.format(hours)}h ${mins}m` : `${nf.format(hours)}h`;
}

const ALLOWED_TAGS = new Set([
  "a", "b", "i", "em", "strong", "u", "s", "del", "p", "br", "hr", "span", "div",
  "ul", "ol", "li", "blockquote", "code", "pre", "small", "img",
  "h1", "h2", "h3", "h4", "h5", "h6",
]);

// AniList bios are stored as HTML. This is the viewer's own content, but we
// still strip scripts/handlers and unknown tags before injecting it.
export function sanitizeHtml(raw) {
  let out = String(raw ?? "");
  out = out.replace(/<(script|style|iframe|object|embed|form|svg|math)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, "");
  out = out.replace(/<\/?(script|style|iframe|object|embed|form|svg|math)\b[^>]*>/gi, "");
  out = out.replace(/<!--[\s\S]*?-->/g, "");
  out = out.replace(/\son[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "");
  out = out.replace(/\b(href|src)\s*=\s*(?:"|')?\s*javascript:[^"'>\s]*(?:"|')?/gi, '$1="#"');
  out = out.replace(/<\/?([a-z0-9]+)(?:\s[^<>]*)?\/?>/gi, (match, tag) =>
    ALLOWED_TAGS.has(tag.toLowerCase()) ? match : "",
  );
  out = out.replace(/<a\b/gi, '<a target="_blank" rel="noreferrer noopener"');
  return out;
}

function memberSince(epochSeconds) {
  if (!epochSeconds) return null;
  return new Date(epochSeconds * 1000).toLocaleDateString(undefined, {
    month: "long",
    year: "numeric",
  });
}

function statTile(label, value) {
  return `<div class="profile-stat">
    <div class="profile-stat-value">${value}</div>
    <div class="profile-stat-label">${escapeHtml(label)}</div>
  </div>`;
}

function statPanel(label, subtitle, tiles) {
  return `<section class="panel profile-stat-panel">
    <h3>${escapeHtml(label)}</h3>
    <div class="profile-stat-sub">${escapeHtml(subtitle)}</div>
    <div class="profile-stat-grid">${tiles.join("")}</div>
  </section>`;
}

function favHead(title, count) {
  return `<div class="section-head"><h2>${escapeHtml(title)}</h2>${
    count ? `<span class="more">${nf.format(count)}</span>` : ""
  }</div>`;
}

function mediaRail(title, connection) {
  const nodes = (connection?.nodes || []).filter((m) => m && m.id);
  const head = favHead(title, connection?.pageInfo?.total);
  if (nodes.length === 0) {
    return `${head}<div class="empty">No favourites yet.</div>`;
  }
  return head + railHtml(nodes, {});
}

function characterChips(connection) {
  const nodes = (connection?.nodes || []).filter((c) => c && c.id);
  if (nodes.length === 0) return `<div class="empty">No favourite characters yet.</div>`;
  return `<div class="profile-chips">${nodes
    .map(
      (c) => `<a class="profile-chip" href="https://anilist.co/character/${c.id}" target="_blank" rel="noreferrer">
        ${c.image?.large ? `<img src="${escapeHtml(c.image.large)}" alt="" />` : ""}
        <span>${escapeHtml(c.name?.full || "Unknown")}</span>
      </a>`,
    )
    .join("")}</div>`;
}

function studioChips(connection) {
  const nodes = (connection?.nodes || []).filter((s) => s && s.id);
  if (nodes.length === 0) return `<div class="empty">No favourite studios yet.</div>`;
  return `<div class="profile-chips">${nodes
    .map(
      (s) => `<a class="profile-chip" href="https://anilist.co/studio/${s.id}" target="_blank" rel="noreferrer">
        <span class="profile-chip-letter">${escapeHtml((s.name || "?").slice(0, 1).toUpperCase())}</span>
        <span>${escapeHtml(s.name || "Unknown")}</span>
      </a>`,
    )
    .join("")}</div>`;
}

function profileHtml(profile) {
  const name = profile.name || "AniList user";
  const about = sanitizeHtml(profile.about || "").trim();
  const banner = profile.bannerImage || "";
  const avatar = profile.avatar?.large || profile.avatar?.medium || "";
  const since = memberSince(profile.createdAt);
  const site = profile.siteUrl || `https://anilist.co/user/${encodeURIComponent(name)}`;
  const anime = profile.statistics?.anime || {};
  const manga = profile.statistics?.manga || {};
  const fav = profile.favourites || {};

  const avatarEl = avatar
    ? `<img class="profile-avatar" src="${escapeHtml(avatar)}" alt="" />`
    : `<div class="profile-avatar profile-avatar-fallback">${escapeHtml(name.slice(0, 1).toUpperCase())}</div>`;

  const animeTiles = [
    statTile("Entries", num(anime.count)),
    statTile("Mean score", anime.meanScore != null ? `${num(anime.meanScore)}%` : "—"),
    statTile("Episodes", num(anime.episodesWatched)),
    statTile("Time watched", formatWatched(anime.minutesWatched)),
    statTile("Std deviation", anime.standardDeviation != null ? Number(anime.standardDeviation).toFixed(1) : "—"),
  ];
  const mangaTiles = [
    statTile("Entries", num(manga.count)),
    statTile("Mean score", manga.meanScore != null ? `${num(manga.meanScore)}%` : "—"),
    statTile("Chapters", num(manga.chaptersRead)),
    statTile("Volumes", num(manga.volumesRead)),
    statTile("Std deviation", manga.standardDeviation != null ? Number(manga.standardDeviation).toFixed(1) : "—"),
  ];

  return `
    <section class="profile-hero${banner ? "" : " no-banner"}">
      <div class="profile-banner"${
        banner ? ` style="background-image:url('${escapeHtml(banner)}')"` : ""
      }></div>
      <div class="profile-id">
        ${avatarEl}
        <div class="profile-meta">
          <h1 class="profile-name">${escapeHtml(name)}</h1>
          <div class="profile-sub">
            <a href="${escapeHtml(site)}" target="_blank" rel="noreferrer">@${escapeHtml(name)}</a>
            ${since ? `<span>Member since ${escapeHtml(since)}</span>` : ""}
          </div>
        </div>
        <div class="profile-actions">
          <a class="btn ghost small" href="${escapeHtml(site)}" target="_blank" rel="noreferrer">AniList</a>
          <button class="btn ghost small" id="profileSignOut">Sign out</button>
        </div>
      </div>
    </section>

    <section class="panel profile-about-panel">
      <h3>About me</h3>
      ${about ? `<div class="profile-about">${about}</div>` : `<p class="hint">No bio yet.</p>`}
    </section>

    <div class="section-head"><h2>Statistics</h2></div>
    <div class="profile-stats">
      ${statPanel("Anime", `${num(anime.count)} entries`, animeTiles)}
      ${statPanel("Manga", `${num(manga.count)} entries`, mangaTiles)}
    </div>

    <div class="section-head"><h2>Favourites</h2></div>
    ${mediaRail("Favourite anime", fav.anime)}
    ${mediaRail("Favourite manga", fav.manga)}
    ${favHead("Favourite characters", fav.characters?.pageInfo?.total)}
    ${characterChips(fav.characters)}
    ${favHead("Favourite studios", fav.studios?.pageInfo?.total)}
    ${studioChips(fav.studios)}
  `;
}

function gateHtml() {
  return `<h1 class="page-title">Profile</h1>
    <section class="panel profile-gate">
      <h3>Connect your AniList</h3>
      <p class="hint" style="margin-bottom:16px">Sign in to see your stats, favourites and watch history, and to sync progress from the app.</p>
      <button class="btn primary" id="profileSignIn">Sign in with AniList</button>
    </section>`;
}

export async function render(container) {
  const token = container.__viewToken;

  if (!getToken()) {
    container.innerHTML = gateHtml();
    container.querySelector("#profileSignIn")?.addEventListener("click", () => startSignIn(container));
    return;
  }

  container.innerHTML = `<h1 class="page-title">Profile</h1>` + spinner("Loading profile…");

  let profile;
  try {
    profile = await viewerProfile();
  } catch (err) {
    if (!isStale(container, token)) {
      container.innerHTML = `<h1 class="page-title">Profile</h1><div class="error-box">${escapeHtml(err.message)}</div>`;
    }
    return;
  }
  if (isStale(container, token)) return;

  if (!profile) {
    container.innerHTML = gateHtml();
    container.querySelector("#profileSignIn")?.addEventListener("click", () => startSignIn(container));
    return;
  }

  container.innerHTML = `<h1 class="page-title">Profile</h1>` + profileHtml(profile);
  container.querySelector("#profileSignOut")?.addEventListener("click", () => {
    clearToken();
    toast("Signed out of AniList");
    render(container);
  });
}

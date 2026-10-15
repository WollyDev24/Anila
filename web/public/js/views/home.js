import { homeCollections } from "../anilist.js";
import { getSettings, getContinueWatching } from "../store.js";
import { escapeHtml, titleOf, heroOf, spinner, isStale } from "../ui.js";
import { railHtml, sectionHead } from "./shared.js";

let heroTimer = null;

export async function render(container) {
  container.innerHTML = spinner("Loading your anime…");
  const token = container.__viewToken;
  const { hideAdult } = getSettings();

  let collections;
  try {
    collections = await homeCollections(hideAdult);
  } catch (err) {
    if (isStale(container, token)) return;
    container.innerHTML = `<div class="error-box">Could not load AniList: ${escapeHtml(
      err.message,
    )}</div>`;
    return;
  }

  if (isStale(container, token)) return;

  const continueWatching = getContinueWatching().slice(0, 30);

  const hero = renderHero(collections.spotlight);

  container.innerHTML = `
    ${hero.html}
    ${continueWatching.length ? sectionHead("Continue watching", "#/library") + railHtml(continueWatching.map(progressToMedia), {}) : ""}
    ${sectionHead("Trending now", "#/browse")}
    ${railHtml(collections.popular)}
    ${sectionHead("Recently aired", "#/schedule")}
    ${railHtml(collections.newest)}
    ${sectionHead("Popular this season", "#/browse")}
    ${railHtml(collections.spotlight.slice(0, 20))}
    ${sectionHead("Movies", "#/browse")}
    ${railHtml(collections.movies)}
    ${sectionHead("Top rated", "#/browse")}
    ${railHtml(collections.topRated)}
  `;

  startHeroRotation(container, hero.items);
}

function progressToMedia(entry) {
  const total = entry.totalEpisodes || 0;
  const pct = total > 0 ? Math.min(1, (entry.episode || 0) / total) : 0;
  return {
    id: entry.mediaId,
    title: entry.title || { userPreferred: "Untitled" },
    coverImage: entry.coverImage || {},
    format: null,
    seasonYear: null,
    episodes: total || null,
    _progress: pct,
    _href: entry.episode ? `#/watch/${entry.mediaId}/${entry.episode}` : `#/anime/${entry.mediaId}`,
    _sub: entry.episode ? `Episode ${entry.episode}` : "",
  };
}

function renderHero(items) {
  if (!items || items.length === 0) return { html: "", items: [] };
  const limited = items.slice(0, 8);
  const slides = limited
    .map((media, i) => {
      const bg = heroOf(media);
      const title = titleOf(media);
      const meta = [
        media.format,
        media.seasonYear,
        media.averageScore ? `★ ${media.averageScore}%` : null,
        media.episodes ? `${media.episodes} episodes` : null,
        media.status,
      ]
        .filter(Boolean)
        .join(" · ");
      return `<div class="hero-slide" data-slide="${i}" style="display:${i === 0 ? "flex" : "none"};position:absolute;inset:0">
        <div class="hero-bg" style="background-image:url('${bg}')"></div>
        <div class="hero-body">
          <h1 class="hero-title">${escapeHtml(title)}</h1>
          <div class="hero-meta">${escapeHtml(meta)}</div>
          <p class="hero-desc">${escapeHtml(String(media.description || "").replace(/<[^>]+>/g, ""))}</p>
          <div class="hero-actions">
            <a class="btn primary" href="#/anime/${media.id}">▶ Watch now</a>
            <a class="btn ghost" href="#/anime/${media.id}">More info</a>
          </div>
        </div>
      </div>`;
    })
    .join("");
  const dots = limited
    .map((_, i) => `<button data-dot="${i}" class="${i === 0 ? "active" : ""}"></button>`)
    .join("");
  return {
    items: limited,
    html: `<section class="hero" id="hero">${slides}<div class="hero-dots">${dots}</div></section>`,
  };
}

export function startHeroRotation(container, items) {
  clearInterval(heroTimer);
  heroTimer = null;
  if (!items || items.length < 2) return;
  const hero = container.querySelector("#hero");
  if (!hero) return;

  // Inactive slides are display:none, so their banner images aren't fetched
  // until they're shown — sliding one in can flash an empty background. Warm
  // the cache up-front.
  items.forEach((media) => {
    const src = heroOf(media);
    if (src) new Image().src = src;
  });

  const slides = Array.from(hero.querySelectorAll("[data-slide]"));
  const dots = Array.from(hero.querySelectorAll("[data-dot]"));
  if (slides.length < 2) return;

  let index = 0;
  let animating = false;

  slides[0].classList.add("is-active");

  const activateDot = (i) => dots.forEach((d, n) => d.classList.toggle("active", n === i));

  const goTo = (target, dir = 1) => {
    if (animating) return;
    const next = ((target % slides.length) + slides.length) % slides.length;
    if (next === index) return;

    const out = slides[index];
    const inc = slides[next];
    animating = true;

    // Place the incoming slide just off-screen, then slide it in while the
    // outgoing slide continues off the opposite edge.
    inc.classList.add("is-active");
    inc.style.display = "flex";
    inc.style.transform = `translateX(${dir * 100}%)`;
    void inc.offsetWidth;
    inc.style.transform = "translateX(0)";

    out.classList.remove("is-active");
    out.style.transform = `translateX(${-dir * 100}%)`;

    activateDot(next);

    let fallback;
    const finish = () => {
      if (!animating) return;
      clearTimeout(fallback);
      out.style.display = "none";
      out.style.transform = "";
      inc.style.transform = "";
      animating = false;
      index = next;
    };
    inc.addEventListener("transitionend", finish, { once: true });
    fallback = setTimeout(finish, 900);
  };

  dots.forEach((dot) => {
    dot.addEventListener("click", () => {
      const target = Number(dot.dataset.dot);
      goTo(target, target > index ? 1 : -1);
    });
  });

  heroTimer = setInterval(() => goTo(index + 1, 1), 8000);
}

export function cleanup() {
  clearInterval(heroTimer);
}

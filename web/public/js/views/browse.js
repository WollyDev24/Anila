import { discover, discoverOptions } from "../anilist.js";
import { getSettings } from "../store.js";
import { escapeHtml, spinner } from "../ui.js";
import { dropdownHtml, initDropdowns } from "../dropdown.js";
import { gridHtml } from "./shared.js";

const SORTS = [
  ["TRENDING_DESC", "Trending"],
  ["POPULARITY_DESC", "Most popular"],
  ["SCORE_DESC", "Highest rated"],
  ["START_DATE_DESC", "Newest"],
  ["TITLE_ROMAJI", "Title A–Z"],
];

const FORMATS = [
  ["", "Any format"],
  ["TV", "TV"],
  ["TV_SHORT", "TV Short"],
  ["MOVIE", "Movie"],
  ["OVA", "OVA"],
  ["ONA", "ONA"],
  ["SPECIAL", "Special"],
];

const STATUSES = [
  ["", "Any status"],
  ["RELEASING", "Airing"],
  ["FINISHED", "Finished"],
  ["NOT_YET_RELEASED", "Upcoming"],
];

let state = {
  query: "",
  genre: "",
  year: "",
  format: "",
  status: "",
  minimumScore: "",
  sort: "TRENDING_DESC",
  page: 1,
  items: [],
  hasNextPage: false,
  options: null,
  error: null,
};

export function resetForSearch(query) {
  state = { ...state, query: query || "", page: 1, items: [], hasNextPage: false, error: null };
}

const YEARS = Array.from({ length: 36 }, (_, i) => new Date().getFullYear() + 1 - i);

export async function render(container, params = {}) {
  if (params.q != null) resetForSearch(params.q);
  const { hideAdult } = getSettings();

  if (!state.options) {
    try {
      state.options = await discoverOptions(hideAdult);
    } catch {
      state.options = { genres: [], tags: [] };
    }
  }

  paint(container, hideAdult);
  if (state.items.length === 0) {
    await loadPage(container, true, hideAdult);
    paint(container, hideAdult);
  }
}

function paint(container, hideAdult) {
  const genres = state.options?.genres || [];
  const genreOptions = [["", "Any genre"], ...genres.map((g) => [g, g])];
  const yearOptions = [["", "Any year"], ...YEARS.map((y) => [String(y), String(y)])];
  const scoreOptions = [["", "Any score"], ...[50, 60, 70, 80, 90].map((s) => [String(s), `${s}%+`])];
  container.innerHTML = `
    <h1 class="page-title">${state.query ? `Results for “${escapeHtml(state.query)}”` : "Browse"}</h1>
    <div class="filters">
      ${dropdownHtml("fGenre", genreOptions, state.genre, { placeholder: "Any genre", label: "Genre" })}
      ${dropdownHtml("fYear", yearOptions, state.year, { placeholder: "Any year", label: "Year" })}
      ${dropdownHtml("fFormat", FORMATS, state.format, { placeholder: "Any format", label: "Format" })}
      ${dropdownHtml("fStatus", STATUSES, state.status, { placeholder: "Any status", label: "Status" })}
      ${dropdownHtml("fScore", scoreOptions, state.minimumScore, { placeholder: "Any score", label: "Minimum score" })}
      ${dropdownHtml("fSort", SORTS, state.sort, { label: "Sort by" })}
      <button class="btn ghost small" id="fClear">Clear</button>
    </div>
    <div id="results">${
      state.error
        ? `<div class="error-box">${escapeHtml(state.error)}</div>`
        : state.items.length
          ? gridHtml(state.items)
          : spinner("Searching…")
    }</div>
    ${state.hasNextPage ? `<div style="text-align:center;margin:26px 0"><button class="btn" id="loadMore">Load more</button></div>` : ""}
  `;

  const syncing = (setter) => async (value) => {
    setter(value);
    state.page = 1;
    state.items = [];
    await loadPage(container, true, hideAdult);
    paint(container, hideAdult);
  };

  initDropdowns(container, {
    fGenre: syncing((v) => (state.genre = v)),
    fYear: syncing((v) => (state.year = v)),
    fFormat: syncing((v) => (state.format = v)),
    fStatus: syncing((v) => (state.status = v)),
    fScore: syncing((v) => (state.minimumScore = v)),
    fSort: syncing((v) => (state.sort = v)),
  });
  container.querySelector("#fClear")?.addEventListener("click", async () => {
    state.genre = state.year = state.format = state.status = state.minimumScore = "";
    state.page = 1;
    state.items = [];
    await loadPage(container, true, hideAdult);
    paint(container, hideAdult);
  });
  container.querySelector("#loadMore")?.addEventListener("click", async () => {
    state.page += 1;
    await loadPage(container, false, hideAdult);
    paint(container, hideAdult);
  });
}

async function loadPage(container, replace, hideAdult) {
  const results = container.querySelector("#results");
  if (replace) {
    state.error = null;
    if (results) results.innerHTML = spinner("Searching…");
  }
  try {
    const filters = {
      query: state.query,
      genres: state.genre ? [state.genre] : [],
      tags: [],
      year: state.year ? Number(state.year) : null,
      format: state.format || null,
      status: state.status || null,
      minimumScore: state.minimumScore ? Number(state.minimumScore) : null,
      sort: state.sort,
    };
    const { items, hasNextPage } = await discover(filters, state.page, 30, hideAdult);
    state.items = replace ? items : [...state.items, ...items];
    state.hasNextPage = hasNextPage;
    state.error = null;
  } catch (err) {
    state.error = err.message;
    state.hasNextPage = false;
    if (results) results.innerHTML = `<div class="error-box">${escapeHtml(err.message)}</div>`;
  }
}

import { airingSchedule, timeBucket } from "../anilist.js";
import { getSettings } from "../store.js";
import { escapeHtml, spinner, titleOf, coverOf, countdown, isStale } from "../ui.js";

export async function render(container) {
  container.innerHTML = `<h1 class="page-title">Airing schedule</h1>` + spinner("Loading schedule…");
  const token = container.__viewToken;
  const { hideAdult } = getSettings();
  const now = Math.floor(timeBucket() / 1000);
  const end = now + 7 * 86400;

  let entries;
  try {
    entries = await airingSchedule(now - 3600, end);
  } catch (err) {
    if (!isStale(container, token))
      container.innerHTML = `<div class="error-box">${escapeHtml(err.message)}</div>`;
    return;
  }
  if (isStale(container, token)) return;

  const filtered = entries.filter((e) => e.media && (!hideAdult || !e.media.isAdult));
  const groups = new Map();
  for (const entry of filtered) {
    const day = new Date(entry.airingAt * 1000);
    day.setHours(0, 0, 0, 0);
    const key = day.getTime();
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(entry);
  }

  const dayKeys = [...groups.keys()].sort((a, b) => a - b);
  if (dayKeys.length === 0) {
    container.innerHTML = `<h1 class="page-title">Airing schedule</h1><div class="empty">No airing episodes found for the next week.</div>`;
    return;
  }

  container.innerHTML =
    `<h1 class="page-title">Airing schedule</h1>` +
    dayKeys
      .map((key) => {
        const date = new Date(key);
        const label = date.toLocaleDateString(undefined, {
          weekday: "long",
          month: "short",
          day: "numeric",
        });
        const rows = groups
          .get(key)
          .sort((a, b) => a.airingAt - b.airingAt)
          .map((entry) => {
            const media = entry.media;
            const title = titleOf(media);
            const time = new Date(entry.airingAt * 1000).toLocaleTimeString(undefined, {
              hour: "2-digit",
              minute: "2-digit",
            });
            return `<a class="ep-item" href="#/anime/${media.id}">
              <img src="${coverOf(media)}" alt="" style="width:40px;height:58px;object-fit:cover;border-radius:7px" />
              <span class="ep-num">${escapeHtml(String(entry.episode))}</span>
              <span class="ep-name">${escapeHtml(title)}</span>
              <span class="ep-filler">${escapeHtml(time)}</span>
            </a>`;
          })
          .join("");
        return `<div class="section-head"><h2>${escapeHtml(label)}</h2><span class="more">${groups.get(key).length} episodes</span></div>
          <div class="ep-list" style="max-height:none">${rows}</div>`;
      })
      .join("");
}

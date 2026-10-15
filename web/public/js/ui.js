// Small DOM + formatting helpers shared across views.

export function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function el(html) {
  const tpl = document.createElement("template");
  tpl.innerHTML = html.trim();
  return tpl.content.firstElementChild;
}

export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

export function debounce(fn, wait = 300) {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
}

export function spinner(label = "") {
  return `<div class="loading"><div><div class="spinner" style="margin:0 auto 12px"></div>${escapeHtml(
    label,
  )}</div></div>`;
}

// Returns true when the container has been handed to a newer route, meaning the
// caller's async work is no longer allowed to touch the DOM.
export function isStale(container, token) {
  return !container || token !== container.__viewToken;
}

export function toast(message, type = "info") {
  const wrap = document.getElementById("toastWrap");
  if (!wrap) return;
  const node = el(`<div class="toast ${type === "error" ? "error" : ""}">${escapeHtml(
    message,
  )}</div>`);
  wrap.appendChild(node);
  setTimeout(() => {
    node.style.opacity = "0";
    node.style.transition = "opacity .3s";
    setTimeout(() => node.remove(), 300);
  }, type === "error" ? 6000 : 3500);
}

export function openModal({ title, body, actions = [] }) {
  const root = document.getElementById("modalRoot");
  clear(root);
  const actionHtml = actions
    .map(
      (a, i) =>
        `<button class="btn ${a.primary ? "primary" : ""}" data-action-index="${i}">${escapeHtml(
          a.label,
        )}</button>`,
    )
    .join("");
  const backdrop = el(`<div class="modal-backdrop">
    <div class="modal" role="dialog" aria-modal="true">
      <h3>${escapeHtml(title)}</h3>
      <div class="modal-body">${body}</div>
      <div class="modal-actions">${actionHtml}</div>
    </div>
  </div>`);
  backdrop.addEventListener("click", (e) => {
    if (e.target === backdrop) closeModal();
  });
  backdrop.querySelectorAll("[data-action-index]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const action = actions[Number(btn.dataset.actionIndex)];
      if (action && action.onClick) action.onClick(backdrop);
      else closeModal();
    });
  });
  root.appendChild(backdrop);
  return backdrop;
}

export function closeModal() {
  const root = document.getElementById("modalRoot");
  if (root) clear(root);
}

export function titleOf(media) {
  if (!media || !media.title) return "Untitled";
  const t = media.title;
  return t.english || t.userPreferred || t.romaji || t.native || "Untitled";
}

export function coverOf(media) {
  const c = media?.coverImage || {};
  return c.extraLarge || c.large || "";
}

export function heroOf(media) {
  return media?.bannerImage || media?.coverImage?.extraLarge || media?.coverImage?.large || "";
}

export function formatDate(dateish) {
  if (!dateish) return null;
  const { year, month, day } = dateish;
  if (!year) return null;
  const mm = month ? String(month).padStart(2, "0") : null;
  const dd = day ? String(day).padStart(2, "0") : null;
  return [year, mm, dd].filter(Boolean).join("-");
}

export function timeAgo(epochSeconds) {
  if (!epochSeconds) return "";
  const diff = Date.now() / 1000 - epochSeconds;
  if (diff < 60) return "just now";
  const mins = Math.floor(diff / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(months / 12)}y ago`;
}

export function countdown(epochSeconds) {
  if (!epochSeconds) return "";
  let diff = epochSeconds - Date.now() / 1000;
  if (diff <= 0) return "aired";
  const days = Math.floor(diff / 86400);
  diff -= days * 86400;
  const hours = Math.floor(diff / 3600);
  diff -= hours * 3600;
  const mins = Math.floor(diff / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

export function clock(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0;
  const s = Math.floor(seconds % 60);
  const m = Math.floor((seconds / 60) % 60);
  const h = Math.floor(seconds / 3600);
  const pad = (n) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

export function weekdayName(epochSeconds) {
  return new Date(epochSeconds * 1000).toLocaleDateString(undefined, { weekday: "long" });
}

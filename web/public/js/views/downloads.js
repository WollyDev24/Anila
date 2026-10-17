import { escapeHtml, spinner } from "../ui.js";

const api = () =>
  (typeof window !== "undefined" && window.desktop && window.desktop.downloads) || null;

function fmtSize(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function fmtDate(ms) {
  try {
    return new Date(ms).toLocaleString();
  } catch {
    return "";
  }
}

export async function render(container, params = {}) {
  if (!api()) {
    container.innerHTML = `
      <h1 class="page-title">Downloads</h1>
      <div class="empty">
        Downloads are available in the desktop app
        (<code>./start-desktop.sh</code>).
      </div>`;
    return;
  }

  container.innerHTML = `
    <h1 class="page-title">Downloads</h1>
    <div id="dlBody">${spinner("Loading downloads…")}</div>
  `;
  const token = container.__viewToken;

  let data;
  try {
    data = await api().list();
  } catch (err) {
    data = { files: [], error: err.message };
  }
  if (!container || token !== container.__viewToken) return;

  const body = container.querySelector("#dlBody");
  if (!body) return;
  const files = (data && data.files) || [];

  body.innerHTML = `
    <div class="field" style="border-bottom:none;padding-bottom:4px">
      <div>
        <div class="label">Saved videos</div>
        <div class="hint">${escapeHtml(data?.dir || "")}</div>
      </div>
      <button class="btn small ghost" id="dlFolder" type="button">Open folder</button>
    </div>
    ${
      data?.error
        ? `<div class="error-box">${escapeHtml(data.error)}</div>`
        : files.length === 0
          ? `<div class="empty">Nothing downloaded yet. Use the Download button while watching.</div>`
          : `<div class="dl-list">${files
              .map(
                (f) => `<div class="dl-row">
                  <div class="dl-name" title="${escapeHtml(f.name)}">${escapeHtml(f.name)}</div>
                  <div class="dl-meta">${fmtSize(f.size)} · ${escapeHtml(fmtDate(f.mtimeMs))}</div>
                </div>`,
              )
              .join("")}</div>`
    }
  `;

  container.querySelector("#dlFolder")?.addEventListener("click", () => api().openFolder());
}

export function cleanup() {}

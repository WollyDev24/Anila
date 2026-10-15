// Dedicated desktop Settings window entry: renders only the settings view (no
// topbar, search, nav, or account menu) and handles AniList sign-in redirects.
import * as settings from "./views/settings.js";
import { captureRedirectToken } from "./oauth.js";
import { escapeHtml } from "./ui.js";

const view = document.getElementById("view");

function readParams() {
  const query = location.hash.split("?")[1] || "";
  return Object.fromEntries(new URLSearchParams(query));
}

function paint() {
  if (settings.cleanup) settings.cleanup();
  Promise.resolve(settings.render(view, readParams())).catch((err) => {
    view.innerHTML = `<div class="error-box">Something went wrong: ${escapeHtml(err.message)}</div>`;
  });
}

window.addEventListener("hashchange", async () => {
  await captureRedirectToken();
  paint();
});

(async function bootstrap() {
  await captureRedirectToken();
  paint();
})();

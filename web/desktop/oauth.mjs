// Pure helpers for AniList OAuth redirect handling. Kept separate from main.mjs
// (which requires Electron) so they can be unit-tested with plain Node.

export function hostOf(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

// AniList's registered redirect is http://localhost/#access_token=…. Only treat
// it as an OAuth redirect when a token or error is actually present, so a bare
// http://localhost navigation won't be mistaken for a completed login.
export function parseOAuthRedirect(url) {
  if (hostOf(url) !== "localhost") return null;
  let params;
  try {
    const u = new URL(url);
    params = new URLSearchParams(u.hash ? u.hash.slice(1) : u.searchParams.toString());
  } catch {
    return null;
  }
  const token = params.get("access_token");
  const error = params.get("error") || params.get("error_description");
  if (!token && !error) return null;
  return { token, error, state: params.get("state") || "" };
}

// Wires every navigation event that can carry the OAuth fragment/query to a
// single handler. Only fires once per webContents, and never for a bare
// http://localhost visit (that's the bug that closed the login window too early).
export function wireOAuthRedirects(contents, { onToken, onError, log = () => {} } = {}) {
  let done = false;
  const redact = (url) =>
    String(url)
      .replace(/(access_token=)[^&]+/g, "$1<redacted>")
      .replace(/(code=)[^&]+/g, "$1<redacted>");
  const onNav = (event, url) => {
    log(`nav: ${redact(url)}`);
    const found = parseOAuthRedirect(url);
    if (!found || done) return;
    done = true;
    try {
      event?.preventDefault?.();
    } catch {
      /* noop */
    }
    log(`captured: ${found.token ? "token" : `error=${found.error}`}`);
    if (found.token) onToken(found);
    else onError(found);
  };
  contents.on("will-navigate", (e, url) => onNav(e, url));
  contents.on("will-redirect", (e, url) => onNav(e, url));
  contents.on("did-redirect-navigation", (_e, url) => onNav(null, url));
  contents.on("did-navigate", (_e, url) => onNav(null, url));
  contents.on("did-navigate-in-page", (_e, url) => onNav(null, url));
  contents.on("did-fail-load", (_e, _code, _desc, url, isMainFrame) => {
    if (isMainFrame) onNav(null, url);
  });
  return { isDone: () => done };
}

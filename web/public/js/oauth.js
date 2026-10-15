// AniList OAuth token capture, shared by the main app and the desktop Settings
// window. A token can arrive either as a full page load (browser redirect, port
// 80) or as a same-document hash change (the desktop wrapper replays the
// redirect into an already-open window).
import { setToken, setViewer } from "./store.js";
import { viewer as fetchViewer, extractTokenFromHash } from "./anilist.js";
import { toast } from "./ui.js";

const DEFAULT_RETURN = "#/settings";

export async function captureRedirectToken() {
  if (!location.hash.includes("access_token")) return false;
  const expected = sessionStorage.getItem("anila.oauth.state");
  const token = extractTokenFromHash(location.hash, expected);
  if (!token) {
    console.warn("[anila] OAuth redirect had a token but the state check failed; ignoring.");
    return false;
  }
  // Return to wherever sign-in started (the Settings window remembers it too).
  let returnRoute = DEFAULT_RETURN;
  try {
    returnRoute = sessionStorage.getItem("anila.oauth.return") || returnRoute;
    sessionStorage.removeItem("anila.oauth.return");
  } catch {
    /* sessionStorage may be unavailable */
  }
  history.replaceState(null, "", `${location.pathname}${location.search}${returnRoute}`);
  setToken(token);
  try {
    const viewer = await fetchViewer();
    setViewer(viewer);
    toast(`Signed in as ${viewer?.name || "AniList user"}`);
  } catch {
    /* fine, token is stored */
  }
  return true;
}

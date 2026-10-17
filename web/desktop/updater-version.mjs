// Pure version helpers shared by the updater and its tests. No Electron, no I/O.
export const REPO_OWNER = "WollyDev24";
export const REPO_NAME = "Anila";
export const RELEASES_PAGE = `https://github.com/${REPO_OWNER}/${REPO_NAME}/releases`;

export function normalizeVersion(value) {
  return String(value ?? "").trim().replace(/^v/i, "");
}

export function parseVersion(value) {
  const core = normalizeVersion(value).split(/[-+]/)[0];
  const parts = core.split(".").map((n) => parseInt(n, 10));
  return [parts[0] || 0, parts[1] || 0, parts[2] || 0];
}

// -1 | 0 | 1, comparing major.minor.patch only (pre-release/build ignored).
export function compareVersions(a, b) {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  for (let i = 0; i < 3; i++) {
    if (pa[i] > pb[i]) return 1;
    if (pa[i] < pb[i]) return -1;
  }
  return 0;
}

export function isNewerVersion(latest, current) {
  if (!normalizeVersion(latest) || !normalizeVersion(current)) return false;
  return compareVersions(latest, current) > 0;
}

export function releaseUrlFor(version) {
  const v = normalizeVersion(version);
  return v ? `${RELEASES_PAGE}/tag/v${v}` : RELEASES_PAGE;
}

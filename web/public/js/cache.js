// Client-side response cache: an in-memory TTL map plus best-effort
// localStorage persistence, with in-flight de-duplication. Sits in front of the
// local server so repeated views (home, detail, watch) don't refetch the same
// AniList/catalog data every second.

const PREFIX = "anila.cache.";
const memory = new Map();
const inflight = new Map();
const MAX_ENTRIES = 200;
const MAX_PERSIST_BYTES = 200 * 1024;

// localStorage is present in the app; guard so the module is importable in
// non-browser contexts (tests, tooling) without throwing.
const store = (() => {
  try {
    return typeof localStorage !== "undefined" ? localStorage : null;
  } catch {
    return null;
  }
})();

function hash(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

export function cacheKey(parts) {
  return hash(typeof parts === "string" ? parts : JSON.stringify(parts));
}

function readPersisted(key, allowExpired = false) {
  if (!store) return undefined;
  try {
    const raw = store.getItem(PREFIX + key);
    if (!raw) return undefined;
    const entry = JSON.parse(raw);
    if (!entry) return undefined;
    // Expired entries are kept (not removed) so a failed refresh can fall back
    // to the last good value via getStale.
    if (!allowExpired && entry.e && entry.e < Date.now()) return undefined;
    return entry;
  } catch {
    return undefined;
  }
}

function writePersisted(key, value, ttl) {
  if (!store) return;
  let serialized;
  try {
    serialized = JSON.stringify({ v: value, e: ttl > 0 ? Date.now() + ttl : 0 });
  } catch {
    return;
  }
  if (serialized.length > MAX_PERSIST_BYTES) return;
  try {
    store.setItem(PREFIX + key, serialized);
    prune();
  } catch {
    /* quota exceeded — memory cache still applies */
  }
}

function prune() {
  if (!store) return;
  try {
    const keys = [];
    for (let i = 0; i < store.length; i++) {
      const k = store.key(i);
      if (k && k.startsWith(PREFIX)) keys.push(k);
    }
    if (keys.length > MAX_ENTRIES) {
      for (const k of keys.slice(0, keys.length - MAX_ENTRIES)) store.removeItem(k);
    }
  } catch {
    /* ignore */
  }
}

/** Last stored value for `key` even if it has expired (memory, then localStorage). */
function getStale(key) {
  const entry = memory.get(key);
  if (entry !== undefined) return entry.v;
  const persisted = readPersisted(key, true);
  if (persisted !== undefined) return persisted.v;
  return undefined;
}

/**
 * Return a cached value for `key`, or run `producer` and cache its result.
 * Concurrent calls for the same key share one producer run; if the producer
 * fails, the last good value is returned when available.
 */
export async function remember(key, ttl, producer) {
  const entry = memory.get(key);
  if (entry !== undefined && (!entry.e || entry.e > Date.now())) return entry.v;
  const persisted = readPersisted(key);
  if (persisted !== undefined) {
    memory.set(key, { v: persisted.v, e: persisted.e || 0 });
    return persisted.v;
  }
  if (inflight.has(key)) return inflight.get(key);
  const promise = (async () => {
    let value;
    try {
      value = await producer();
    } catch (err) {
      const stale = getStale(key);
      if (stale !== undefined) return stale;
      throw err;
    }
    const expires = ttl > 0 ? Date.now() + ttl : 0;
    memory.set(key, { v: value, e: expires });
    writePersisted(key, value, ttl);
    return value;
  })();
  inflight.set(key, promise);
  try {
    return await promise;
  } finally {
    inflight.delete(key);
  }
}

export function has(key) {
  const entry = memory.get(key);
  if (entry && (!entry.e || entry.e > Date.now())) return true;
  return readPersisted(key) !== undefined;
}

export function forget(key) {
  memory.delete(key);
  inflight.delete(key);
  try {
    store?.removeItem(PREFIX + key);
  } catch {
    /* ignore */
  }
}

export function clearCache() {
  memory.clear();
  inflight.clear();
  try {
    if (!store) return;
    const keys = [];
    for (let i = 0; i < store.length; i++) {
      const k = store.key(i);
      if (k && k.startsWith(PREFIX)) keys.push(k);
    }
    for (const k of keys) store.removeItem(k);
  } catch {
    /* ignore */
  }
}

export function cacheSize() {
  return memory.size;
}

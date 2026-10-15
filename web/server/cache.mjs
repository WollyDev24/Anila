// In-memory TTL cache with request coalescing (single-flight) and optional
// best-effort disk persistence. Used by the local server so identical upstream
// calls (AniList, provider catalogs, sources, HLS manifests) are made once
// instead of on every view.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const MISS = Symbol("cache-miss");

export function hashKey(input) {
  const str = typeof input === "string" ? input : JSON.stringify(input);
  return crypto.createHash("sha1").update(str).digest("hex");
}

export class TtlCache {
  constructor({
    maxEntries = 400,
    defaultTtl = 300000,
    dir = null,
    maxDiskEntries = 1500,
  } = {}) {
    this.map = new Map();
    this.maxEntries = maxEntries;
    this.defaultTtl = defaultTtl;
    this.dir = dir || null;
    this.maxDiskEntries = maxDiskEntries;
    this.inflight = new Map();
    this.setCount = 0;
    if (this.dir) {
      try {
        fs.mkdirSync(this.dir, { recursive: true });
      } catch {
        /* ignore */
      }
    }
  }

  diskPath(key) {
    return path.join(this.dir, `${hashKey(key)}.json.gz`);
  }

  get(key) {
    const entry = this.map.get(key);
    if (entry && (!entry.expires || entry.expires >= Date.now())) {
      // LRU bump.
      this.map.delete(key);
      this.map.set(key, entry);
      return entry.value;
    }
    if (this.dir) {
      const disk = this.readDisk(key);
      if (disk !== MISS) {
        this.map.set(key, disk);
        this.evictMemory();
        return disk.value;
      }
    }
    return undefined;
  }

  has(key) {
    return this.get(key) !== undefined;
  }

  /**
   * Return a value even if it has expired (memory first, then disk). Used as a
   * fallback so a transient upstream failure can still serve the last good copy.
   */
  getStale(key) {
    const entry = this.map.get(key);
    if (entry) return entry.value;
    if (this.dir) {
      const disk = this.readDisk(key, true);
      if (disk !== MISS) return disk.value;
    }
    return undefined;
  }

  set(key, value, ttl = this.defaultTtl) {
    const expires = ttl > 0 ? Date.now() + ttl : 0;
    this.map.set(key, { value, expires });
    this.evictMemory();
    this.writeDisk(key, { value, expires });
    if (this.dir && ++this.setCount % 50 === 0) this.sweep();
  }

  delete(key) {
    this.map.delete(key);
    this.dropDisk(key);
  }

  clear() {
    this.map.clear();
    this.inflight.clear();
    if (this.dir) {
      try {
        for (const file of fs.readdirSync(this.dir)) {
          fs.rmSync(path.join(this.dir, file), { force: true });
        }
      } catch {
        /* ignore */
      }
    }
  }

  /** Number of live (unexpired) memory entries. */
  get size() {
    return this.map.size;
  }

  evictMemory() {
    while (this.map.size > this.maxEntries) {
      const oldest = this.map.keys().next().value;
      this.map.delete(oldest);
    }
  }

  readDisk(key, allowExpired = false) {
    if (!this.dir) return MISS;
    const file = this.diskPath(key);
    let raw;
    try {
      raw = fs.readFileSync(file);
    } catch {
      return MISS;
    }
    try {
      const parsed = JSON.parse(zlib.gunzipSync(raw).toString("utf8"));
      if (!parsed) {
        this.dropDisk(key);
        return MISS;
      }
      // Expired entries are intentionally kept (not deleted) so getStale can
      // still serve them if a later upstream request fails.
      if (!allowExpired && parsed.expires && parsed.expires < Date.now()) {
        return MISS;
      }
      return { value: parsed.value, expires: parsed.expires || 0 };
    } catch {
      this.dropDisk(key);
      return MISS;
    }
  }

  writeDisk(key, entry) {
    if (!this.dir) return;
    const file = this.diskPath(key);
    let payload;
    try {
      payload = zlib.gzipSync(Buffer.from(JSON.stringify(entry)));
    } catch {
      return;
    }
    fs.writeFile(file, payload, () => {});
  }

  dropDisk(key) {
    if (!this.dir) return;
    fs.rm(this.diskPath(key), { force: true }, () => {});
  }

  /** Remove expired (and excess) files from disk; call occasionally. */
  sweep() {
    if (!this.dir) return;
    let files;
    try {
      files = fs.readdirSync(this.dir);
    } catch {
      return;
    }
    const entries = [];
    for (const file of files) {
      const full = path.join(this.dir, file);
      try {
        const stat = fs.statSync(full);
        entries.push({ full, mtime: stat.mtimeMs });
      } catch {
        /* ignore */
      }
    }
    for (const entry of entries) {
      try {
        const parsed = JSON.parse(
          zlib.gunzipSync(fs.readFileSync(entry.full)).toString("utf8"),
        );
        if (!parsed || (parsed.expires && parsed.expires < Date.now())) {
          fs.rmSync(entry.full, { force: true });
        }
      } catch {
        fs.rmSync(entry.full, { force: true });
      }
    }
    if (entries.length > this.maxDiskEntries) {
      entries.sort((a, b) => a.mtime - b.mtime);
      for (const entry of entries.slice(0, entries.length - this.maxDiskEntries)) {
        fs.rmSync(entry.full, { force: true });
      }
    }
  }
}

// Cache a producer's result only when it is considered cacheable, and collapse
// concurrent calls for the same key into one upstream request. If the producer
// fails, fall back to the last good (possibly expired) value when one exists.
export async function remember(cache, key, ttl, producer, shouldCache = (v) => v !== undefined) {
  const cached = cache.get(key);
  if (cached !== undefined) return cached;
  const existing = cache.inflight.get(key);
  if (existing) return existing;
  const promise = (async () => {
    try {
      const value = await producer();
      if (shouldCache(value)) cache.set(key, value, ttl);
      return value;
    } catch (err) {
      const stale = cache.getStale(key);
      if (stale !== undefined) return stale;
      throw err;
    }
  })();
  cache.inflight.set(key, promise);
  try {
    return await promise;
  } finally {
    cache.inflight.delete(key);
  }
}

export async function wrap(cache, key, ttl, producer) {
  return remember(cache, key, ttl, producer);
}

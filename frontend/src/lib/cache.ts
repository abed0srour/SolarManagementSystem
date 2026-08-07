/**
 * Offline-first localStorage cache with TTL + stale-while-revalidate.
 *
 * Every entry is wrapped in an envelope carrying a schema version and a write
 * timestamp, so stale or older-format data can be detected and dropped without
 * guessing. Entries survive reloads and browser restarts; they are namespaced
 * under `sms:cache:v1:` so `clearCache()` can wipe them without touching the
 * session keys that live alongside them.
 *
 * Cached payloads are business data (products, clients, invoices…), which is
 * exactly the data the session already exposes — but it outlives logout unless
 * cleared, so `clearCache()` is called on sign-out.
 */

const PREFIX = 'sms:cache:v1:';
const SCHEMA = 1;

/** Default lifetime before an entry is considered stale. */
export const DEFAULT_TTL = 24 * 60 * 60 * 1000; // 24 hours

type Envelope<T> = { v: number; t: number; d: T };

export type CacheHit<T> = {
  data: T;
  /** ms since the entry was written. */
  age: number;
  /** True when `age` exceeds the TTL — render it, but revalidate. */
  stale: boolean;
};

const storageKey = (key: string) => `${PREFIX}${key}`;

/** Read an entry. Returns null when missing, corrupt, or written by an older schema. */
export function readCache<T>(key: string, ttl = DEFAULT_TTL): CacheHit<T> | null {
  if (typeof window === 'undefined') return null;
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(storageKey(key));
  } catch {
    return null; // storage blocked
  }
  if (!raw) return null;

  try {
    const env = JSON.parse(raw) as Envelope<T>;
    if (env?.v !== SCHEMA || typeof env.t !== 'number') {
      removeCache(key);
      return null;
    }
    const age = Date.now() - env.t;
    return { data: env.d, age, stale: age > ttl };
  } catch {
    removeCache(key); // corrupt entry — drop it rather than fail the render
    return null;
  }
}

/** Write an entry, stamping it with the current time. */
export function writeCache<T>(key: string, data: T): void {
  if (typeof window === 'undefined') return;
  const env: Envelope<T> = { v: SCHEMA, t: Date.now(), d: data };
  try {
    window.localStorage.setItem(storageKey(key), JSON.stringify(env));
  } catch {
    // Most likely QuotaExceededError. Evict our own entries and retry once;
    // caching is an optimisation, so a second failure is silently tolerated.
    evictOldest();
    try {
      window.localStorage.setItem(storageKey(key), JSON.stringify(env));
    } catch {
      /* give up — the app still works, just uncached */
    }
  }
}

export function removeCache(key: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(storageKey(key));
  } catch {
    /* ignore */
  }
}

/** All cache keys currently held, without the namespace prefix. */
export function cacheKeys(): string[] {
  if (typeof window === 'undefined') return [];
  const keys: string[] = [];
  try {
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i);
      if (k?.startsWith(PREFIX)) keys.push(k.slice(PREFIX.length));
    }
  } catch {
    /* ignore */
  }
  return keys;
}

/** Drop the oldest quarter of entries to make room after a quota error. */
function evictOldest(): void {
  const entries = cacheKeys()
    .map((k) => {
      const hit = readCache<unknown>(k, Infinity);
      return { key: k, t: hit ? Date.now() - hit.age : 0 };
    })
    .sort((a, b) => a.t - b.t);
  for (const e of entries.slice(0, Math.max(1, Math.ceil(entries.length / 4)))) {
    removeCache(e.key);
  }
}

/** Wipe every cached entry. Called on sign-out. */
export function clearCache(): void {
  for (const k of cacheKeys()) removeCache(k);
}

/* ------------------------------------------------------------------ *
 * Invalidation bus
 *
 * Mounted hooks subscribe here so a write anywhere in the app can force
 * every affected view to refetch, in this tab and in others.
 * ------------------------------------------------------------------ */

type Listener = (key: string) => void;
const listeners = new Set<Listener>();

export function subscribeToInvalidation(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

const CHANNEL_KEY = 'sms:cache:invalidate';

/**
 * Invalidate every cache entry whose key starts with one of `prefixes`, then
 * notify mounted hooks so they refetch immediately.
 *
 * Call this after any write — create, update, delete, approve, reject:
 *   `await api.post('/suppliers', body); invalidateCache('suppliers');`
 */
export function invalidateCache(...prefixes: string[]): void {
  const matched = cacheKeys().filter((k) => prefixes.some((p) => k === p || k.startsWith(p)));
  for (const k of matched) removeCache(k);

  for (const p of prefixes) {
    for (const fn of listeners) fn(p);
  }

  // Mirror to other tabs — the `storage` event only fires in *other* documents.
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(CHANNEL_KEY, JSON.stringify({ prefixes, at: Date.now() }));
    } catch {
      /* ignore */
    }
  }
}

/**
 * Force every cached module to refetch from the database.
 *
 * Drops all entries and notifies every mounted hook — the empty prefix matches
 * every key — so views repaint with fresh server data. Reaches other tabs too.
 * This is the manual "sync now" escape hatch when you know the database changed
 * outside this browser.
 */
export function refreshAllCaches(): void {
  invalidateCache('');
}

/** Relay invalidations broadcast by other tabs. Installed once, lazily. */
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key !== CHANNEL_KEY || !e.newValue) return;
    try {
      const { prefixes } = JSON.parse(e.newValue) as { prefixes: string[] };
      for (const p of prefixes) {
        for (const fn of listeners) fn(p);
      }
    } catch {
      /* ignore */
    }
  });
}

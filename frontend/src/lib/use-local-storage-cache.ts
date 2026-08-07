'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { DEFAULT_TTL, readCache, subscribeToInvalidation, writeCache } from './cache';

export type UseLocalStorageCacheOptions = {
  /** How long before a cached entry is treated as stale. Defaults to 24h. */
  ttl?: number;
  /** Skip fetching entirely (e.g. while a prerequisite is still loading). */
  enabled?: boolean;
  /**
   * Serve cached data even when it is older than `ttl`. On by default: showing
   * stale rows while fresh ones load beats showing a spinner. Turn it off for
   * data that is actively misleading when out of date.
   */
  serveStale?: boolean;
};

export type UseLocalStorageCacheResult<T> = {
  data: T | undefined;
  error: unknown;
  /** True only when there is nothing at all to render yet. */
  loading: boolean;
  /** True while a background revalidation is in flight over existing data. */
  validating: boolean;
  /** True when `data` came from an entry older than the TTL. */
  stale: boolean;
  /** Force a refetch, bypassing the cache. */
  refresh: () => Promise<void>;
  /** Overwrite cache + state locally, e.g. after an optimistic update. */
  mutate: (next: T) => void;
};

/**
 * Offline-first data hook: renders cached data on the first paint, then
 * revalidates in the background and swaps in fresh data when it lands.
 *
 * Cached reads are synchronous during the initial render, so a warm key
 * produces zero loading spinners and zero blocking round-trips.
 *
 * SSR constraint: because that first read happens during render, the server
 * (no localStorage) and the client (warm cache) would disagree if the markup
 * were hydrated. Every consumer today sits under `app/(app)/layout.tsx`, which
 * renders a skeleton until its `ready` effect fires, so these subtrees mount
 * only after hydration and the mismatch cannot occur. Keep it that way: if you
 * use this hook in a component that is server-rendered with real markup, gate
 * it behind a mounted flag first.
 *
 *   const { data, loading, refresh } = useLocalStorageCache(
 *     `suppliers?page=${page}`,
 *     () => api.get('/suppliers', { params: { page } }).then((r) => r.data),
 *   );
 *
 * After any write, call `invalidateCache('suppliers')` from `./cache` — every
 * mounted hook whose key starts with that prefix refetches, across tabs.
 *
 * Pass `key: null` to disable the hook (e.g. before an id is known).
 */
export function useLocalStorageCache<T>(
  key: string | null,
  fetcher: () => Promise<T>,
  options: UseLocalStorageCacheOptions = {},
): UseLocalStorageCacheResult<T> {
  const { ttl = DEFAULT_TTL, enabled = true, serveStale = true } = options;

  // Read synchronously so the very first render already has data.
  const initial = key && enabled ? readCache<T>(key, ttl) : null;
  const usableInitial = initial && (serveStale || !initial.stale) ? initial : null;

  const [data, setData] = useState<T | undefined>(usableInitial?.data);
  const [stale, setStale] = useState<boolean>(usableInitial?.stale ?? false);
  const [error, setError] = useState<unknown>(null);
  const [validating, setValidating] = useState<boolean>(false);

  // Keep the latest fetcher without making it a re-run trigger — callers pass
  // inline arrow functions, which change identity on every render.
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  // Ignore responses from superseded requests (key changed, or a refresh raced).
  const requestId = useRef(0);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const revalidate = useCallback(async () => {
    if (!key || !enabled) return;
    const id = ++requestId.current;
    setValidating(true);
    try {
      const fresh = await fetcherRef.current();
      if (!mounted.current || id !== requestId.current) return;
      writeCache(key, fresh);
      setData(fresh);
      setStale(false);
      setError(null);
    } catch (e) {
      if (!mounted.current || id !== requestId.current) return;
      // Keep showing cached data on failure — offline-first means a dead
      // network degrades to stale content, not to an empty screen.
      setError(e);
    } finally {
      if (mounted.current && id === requestId.current) setValidating(false);
    }
  }, [key, enabled]);

  // Adopt the cached value when the key changes, then revalidate.
  useEffect(() => {
    if (!key || !enabled) return;
    const hit = readCache<T>(key, ttl);
    const usable = hit && (serveStale || !hit.stale) ? hit : null;
    setData(usable?.data);
    setStale(usable?.stale ?? false);
    setError(null);
    void revalidate();
    // `ttl`/`serveStale` are read-only knobs here; keying off them would
    // re-fetch on every render when callers pass object literals.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled, revalidate]);

  // Refetch when a write invalidates a matching prefix (this tab or another).
  useEffect(() => {
    if (!key || !enabled) return subscribeToInvalidation(() => {});
    return subscribeToInvalidation((prefix) => {
      if (key === prefix || key.startsWith(prefix)) void revalidate();
    });
  }, [key, enabled, revalidate]);

  const mutate = useCallback(
    (next: T) => {
      if (key) writeCache(key, next);
      setData(next);
      setStale(false);
    },
    [key],
  );

  return {
    data,
    error,
    loading: data === undefined && enabled && Boolean(key),
    validating,
    stale,
    refresh: revalidate,
    mutate,
  };
}

/**
 * Local-first data hook — the name used across the app's module pages.
 *
 *   const { data, refresh } = useLocalFirstData('dashboard', () => api.get('/x').then(r => r.data));
 *
 * Cache hit renders synchronously on the first paint with no spinner; cache
 * miss fetches, renders, and writes the result to localStorage. Identical to
 * `useLocalStorageCache` — kept as a separate export so call sites read as the
 * pattern rather than as the storage mechanism.
 */
export const useLocalFirstData = useLocalStorageCache;

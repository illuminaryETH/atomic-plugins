import { get as idbGet, set as idbSet, del as idbDel, keys as idbKeys } from 'idb-keyval';

/// Thin wrapper around idb-keyval for our read-cache. Keys are namespaced by
/// a schema version so we can invalidate all caches in a single version bump
/// if the shape of cached data changes. Without the prefix we'd have to chase
/// old shapes forever, or ship a migration step — neither pays for itself at
/// this scale.
const SCHEMA = 'atomic:v1';

export function cacheKey(kind: string, dbId: string): string {
  return `${SCHEMA}:${kind}:${dbId}`;
}

export interface CachedValue<T> {
  data: T;
  ts: number;
}

export async function readCache<T>(key: string): Promise<CachedValue<T> | null> {
  try {
    const v = await idbGet<CachedValue<T>>(key);
    return v ?? null;
  } catch (err) {
    // IDB can throw in private-browsing mode or when quota is exhausted.
    // The cache is purely a UX optimization — failure should be silent and
    // non-fatal; the app falls back to network-only.
    console.warn('[cache] read failed:', err);
    return null;
  }
}

export async function writeCache<T>(key: string, data: T): Promise<void> {
  try {
    await idbSet(key, { data, ts: Date.now() } satisfies CachedValue<T>);
  } catch (err) {
    console.warn('[cache] write failed:', err);
  }
}

export async function clearCache(key: string): Promise<void> {
  try {
    await idbDel(key);
  } catch (err) {
    console.warn('[cache] delete failed:', err);
  }
}

/// Purge all cached entries we own. Useful on sign-out / server change where
/// lingering data would be stale or cross-account.
export async function clearAllCache(): Promise<void> {
  try {
    const all = await idbKeys();
    await Promise.all(
      all
        .filter((k): k is string => typeof k === 'string' && k.startsWith(SCHEMA + ':'))
        .map((k) => idbDel(k)),
    );
  } catch (err) {
    console.warn('[cache] clearAll failed:', err);
  }
}

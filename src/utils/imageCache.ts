import { useAuthStore } from '../store/authStore';

const DB_NAME = 'psysonic-img-cache';
const STORE_NAME = 'images';
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const MAX_MEMORY_CACHE = 150; // max object URLs kept in RAM
const MAX_CONCURRENT_FETCHES = 5;

// In-memory map: cacheKey → object URL (insertion-order = LRU approximation)
const objectUrlCache = new Map<string, string>();

// Concurrency limiter for network fetches
let activeFetches = 0;
const fetchQueue: Array<() => void> = [];

function acquireFetchSlot(): Promise<void> {
  if (activeFetches < MAX_CONCURRENT_FETCHES) {
    activeFetches++;
    return Promise.resolve();
  }
  return new Promise(resolve => fetchQueue.push(resolve));
}

function releaseFetchSlot(): void {
  activeFetches--;
  const next = fetchQueue.shift();
  if (next) { activeFetches++; next(); }
}

function evictMemoryIfNeeded(): void {
  while (objectUrlCache.size > MAX_MEMORY_CACHE) {
    const oldestKey = objectUrlCache.keys().next().value;
    if (!oldestKey) break;
    URL.revokeObjectURL(objectUrlCache.get(oldestKey)!);
    objectUrlCache.delete(oldestKey);
  }
}

let db: IDBDatabase | null = null;
let dbPromise: Promise<IDBDatabase> | null = null;

function openDB(): Promise<IDBDatabase> {
  if (db) return Promise.resolve(db);
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = e => {
      const database = (e.target as IDBOpenDBRequest).result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME, { keyPath: 'key' });
      }
    };
    req.onsuccess = e => {
      db = (e.target as IDBOpenDBRequest).result;
      resolve(db!);
    };
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

async function getBlob(key: string): Promise<Blob | null> {
  try {
    const database = await openDB();
    return new Promise(resolve => {
      const req = database.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(key);
      req.onsuccess = () => {
        const entry = req.result;
        resolve(entry && Date.now() - entry.timestamp < MAX_AGE_MS ? entry.blob : null);
      };
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

/** Evicts oldest IDB entries until total blob size is below maxBytes. Fire-and-forget. */
async function evictDiskIfNeeded(maxBytes: number): Promise<void> {
  try {
    const database = await openDB();
    const entries: Array<{ key: string; timestamp: number; size: number }> = await new Promise(resolve => {
      const req = database.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).getAll();
      req.onsuccess = () => {
        resolve(
          (req.result ?? []).map((e: { key: string; timestamp: number; blob: Blob }) => ({
            key: e.key,
            timestamp: e.timestamp,
            size: e.blob?.size ?? 0,
          })),
        );
      };
      req.onerror = () => resolve([]);
    });

    let total = entries.reduce((acc, e) => acc + e.size, 0);
    if (total <= maxBytes) return;

    // Oldest first
    entries.sort((a, b) => a.timestamp - b.timestamp);

    const tx = database.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    for (const entry of entries) {
      if (total <= maxBytes) break;
      store.delete(entry.key);
      // Also purge from memory cache
      const objUrl = objectUrlCache.get(entry.key);
      if (objUrl) {
        URL.revokeObjectURL(objUrl);
        objectUrlCache.delete(entry.key);
      }
      total -= entry.size;
    }
  } catch {
    // Ignore
  }
}

async function putBlob(key: string, blob: Blob): Promise<void> {
  try {
    const database = await openDB();
    await new Promise<void>(resolve => {
      const tx = database.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).put({ key, blob, timestamp: Date.now() });
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
    // Enforce disk limit after write (fire-and-forget)
    const maxBytes = useAuthStore.getState().maxCacheMb * 1024 * 1024;
    evictDiskIfNeeded(maxBytes);
  } catch {
    // Ignore write errors
  }
}

/** Returns the total size in bytes of all blobs stored in IndexedDB. */
export async function getImageCacheSize(): Promise<number> {
  try {
    const database = await openDB();
    return new Promise(resolve => {
      const req = database.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).getAll();
      req.onsuccess = () => {
        const entries: Array<{ blob: Blob }> = req.result ?? [];
        resolve(entries.reduce((acc, e) => acc + (e.blob?.size ?? 0), 0));
      };
      req.onerror = () => resolve(0);
    });
  } catch {
    return 0;
  }
}

/** Clears all entries from IndexedDB and revokes all in-memory object URLs. */
export async function clearImageCache(): Promise<void> {
  for (const url of objectUrlCache.values()) {
    URL.revokeObjectURL(url);
  }
  objectUrlCache.clear();
  try {
    const database = await openDB();
    await new Promise<void>(resolve => {
      const tx = database.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch {
    // Ignore
  }
}

/**
 * Returns a cached object URL for an image.
 * @param fetchUrl  The actual URL to fetch from (may contain ephemeral auth params).
 * @param cacheKey  A stable key that identifies the image across sessions.
 */
export async function getCachedUrl(fetchUrl: string, cacheKey: string): Promise<string> {
  if (!fetchUrl) return '';

  // 1. In-memory hit (same session)
  const existing = objectUrlCache.get(cacheKey);
  if (existing) return existing;

  // 2. IndexedDB hit (persisted from previous session)
  const blob = await getBlob(cacheKey);
  if (blob) {
    const objUrl = URL.createObjectURL(blob);
    objectUrlCache.set(cacheKey, objUrl);
    evictMemoryIfNeeded();
    return objUrl;
  }

  // 3. Network fetch with concurrency limit → store in IDB → return object URL
  await acquireFetchSlot();
  try {
    const resp = await fetch(fetchUrl);
    if (!resp.ok) return fetchUrl;
    const newBlob = await resp.blob();
    putBlob(cacheKey, newBlob); // fire-and-forget (includes disk eviction)
    const objUrl = URL.createObjectURL(newBlob);
    objectUrlCache.set(cacheKey, objUrl);
    evictMemoryIfNeeded();
    return objUrl;
  } catch {
    return fetchUrl;
  } finally {
    releaseFetchSlot();
  }
}

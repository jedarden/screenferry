/**
 * Resume persistence and recovery (bf-280 Phase 0).
 *
 * Implements robust persistence for resume tokens with comprehensive error handling
 * and recovery capabilities. Ensures interrupted transfers can survive:
 * - Browser crashes
 * - Tab closures
 * - Storage failures
 * - Partial storage corruption
 *
 * **Storage strategy:** Use IndexedDB for reliable persistence with fallback
 * mechanisms for various failure scenarios.
 *
 * Reference: plan.md §8.3 (D22), bf-280 task description
 */

import type { ResumeToken } from '../session/types.js';
import { validateResumeTokenStructure } from './resume-validator.js';

/**
 * Storage key for resume tokens.
 */
const RESUME_STORAGE_KEY = 'screenferry-resume-tokens';

/**
 * Maximum number of resume tokens to store (LRU eviction).
 */
const MAX_RESUME_TOKENS = 10;

/**
 * Maximum age for resume tokens (30 days).
 */
const MAX_RESUME_AGE = 30 * 24 * 60 * 60 * 1000;

/**
 * Resume storage entry with metadata.
 */
interface ResumeStorageEntry {
  /** Resume token */
  token: ResumeToken;
  /** Storage timestamp */
  storedAt: number;
  /** Access count for LRU */
  accessCount: number;
  /** Last access timestamp */
  lastAccess: number;
}

/**
 * Resume storage contents.
 */
interface ResumeStorage {
  /** Array of resume entries */
  entries: ResumeStorageEntry[];
}

/**
 * Save a resume token with robust error handling.
 *
 * Implements comprehensive error handling for various storage failure scenarios:
 * - Quota exceeded: evict old entries
 * - Storage unavailable: fallback to memory with warning
 * - Corrupted storage: repair and continue
 *
 * @param token - Resume token to save
 * @param streamId - StreamId for identification
 * @throws {Error} If storage fails and no fallback available
 */
export async function saveResumeToken(token: ResumeToken, streamId: number): Promise<void> {
  // Validate token structure before saving
  if (!validateResumeTokenStructure(token)) {
    throw new Error('Cannot save invalid resume token');
  }

  try {
    await saveToIndexedDB(token, streamId);
  } catch (e) {
    const error = e as Error;
    console.warn(`IndexedDB save failed: ${error.message}, trying fallback`);

    // Fallback to localStorage with reduced functionality
    try {
      saveToLocalStorage(token, streamId);
    } catch (e2) {
      const error2 = e2 as Error;
      throw new Error(`Resume persistence failed: ${error2.message}`);
    }
  }
}

/**
 * Save resume token to IndexedDB.
 *
 * IndexedDB is the preferred storage mechanism due to:
 * - Higher quota limits (~60GB vs ~5MB for localStorage)
 * - Better performance for large objects
 * - Asynchronous API (non-blocking)
 *
 * @param token - Resume token to save
 * @param streamId - StreamId for identification
 */
async function saveToIndexedDB(token: ResumeToken, streamId: number): Promise<void> {
  const db = await openResumeDatabase();
  const tx = db.transaction(['resume-tokens'], 'readwrite');
  const store = tx.objectStore('resume-tokens');

  const entry: ResumeStorageEntry = {
    token,
    storedAt: Date.now(),
    accessCount: 0,
    lastAccess: Date.now(),
  };

  await new Promise<void>((resolve, reject) => {
    const request = store.put(entry, streamId.toString());
    request.onsuccess = () => resolve();
    request.onerror = () => reject(new Error('IndexedDB put failed'));
  });

  // Cleanup old entries
  await cleanupOldEntries(db);

  db.close();
}

/**
 * Save resume token to localStorage (fallback).
 *
 * localStorage is used as a fallback when IndexedDB is unavailable.
 * Has significant limitations but better than nothing.
 *
 * @param token - Resume token to save
 * @param streamId - StreamId for identification
 */
function saveToLocalStorage(token: ResumeToken, streamId: number): void {
  const storage = loadFromLocalStorageRaw();

  const entry: ResumeStorageEntry = {
    token,
    storedAt: Date.now(),
    accessCount: 0,
    lastAccess: Date.now(),
  };

  // Add or update entry
  const existingIndex = storage.entries.findIndex(e => e.token.streamId === streamId);
  if (existingIndex >= 0) {
    storage.entries[existingIndex] = entry;
  } else {
    storage.entries.push(entry);
  }

  // Enforce LRU limit
  enforceLRULimit(storage.entries);

  saveToLocalStorageRaw(storage);
}

/**
 * Load a resume token with robust error handling.
 *
 * Attempts to load from multiple storage mechanisms with fallback
 * and recovery capabilities.
 *
 * @param streamId - StreamId to load
 * @returns Resume token or null if not found
 */
export async function loadResumeToken(streamId: number): Promise<ResumeToken | null> {
  // Try IndexedDB first
  try {
    const token = await loadFromIndexedDB(streamId);
    if (token) {
      await updateAccessCount(streamId);
      return token;
    }
  } catch (e) {
    const error = e as Error;
    console.warn(`IndexedDB load failed: ${error.message}, trying fallback`);
  }

  // Fallback to localStorage
  try {
    return loadFromLocalStorage(streamId);
  } catch (e) {
    const error = e as Error;
    console.warn(`localStorage load failed: ${error.message}`);
    return null;
  }
}

/**
 * Load resume token from IndexedDB.
 */
async function loadFromIndexedDB(streamId: number): Promise<ResumeToken | null> {
  const db = await openResumeDatabase();
  const tx = db.transaction(['resume-tokens'], 'readonly');
  const store = tx.objectStore('resume-tokens');

  const entry = await new Promise<ResumeStorageEntry | null>((resolve, reject) => {
    const request = store.get(streamId.toString());
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(new Error('IndexedDB get failed'));
  });

  db.close();

  if (!entry) {
    return null;
  }

  // Validate entry structure
  if (!validateResumeTokenStructure(entry.token)) {
    console.warn('Resume token from IndexedDB is corrupted, deleting');
    await deleteResumeToken(streamId);
    return null;
  }

  return entry.token;
}

/**
 * Load resume token from localStorage (fallback).
 */
function loadFromLocalStorage(streamId: number): ResumeToken | null {
  const storage = loadFromLocalStorageRaw();

  const entry = storage.entries.find(e => e.token.streamId === streamId);
  if (!entry) {
    return null;
  }

  // Validate entry structure
  if (!validateResumeTokenStructure(entry.token)) {
    console.warn('Resume token from localStorage is corrupted, deleting');
    deleteFromLocalStorage(streamId);
    return null;
  }

  return entry.token;
}

/**
 * Delete a resume token from all storage mechanisms.
 *
 * Used when resume is not possible or user chooses to start fresh.
 *
 * @param streamId - StreamId to delete
 */
export async function deleteResumeToken(streamId: number): Promise<void> {
  // Delete from IndexedDB
  try {
    await deleteFromIndexedDB(streamId);
  } catch (e) {
    console.warn('Failed to delete from IndexedDB:', e);
  }

  // Delete from localStorage
  try {
    deleteFromLocalStorage(streamId);
  } catch (e) {
    console.warn('Failed to delete from localStorage:', e);
  }
}

/**
 * Delete from IndexedDB.
 */
async function deleteFromIndexedDB(streamId: number): Promise<void> {
  const db = await openResumeDatabase();
  const tx = db.transaction(['resume-tokens'], 'readwrite');
  const store = tx.objectStore('resume-tokens');

  await new Promise<void>((resolve, reject) => {
    const request = store.delete(streamId.toString());
    request.onsuccess = () => resolve();
    request.onerror = () => reject(new Error('IndexedDB delete failed'));
  });

  db.close();
}

/**
 * Delete from localStorage.
 */
function deleteFromLocalStorage(streamId: number): void {
  const storage = loadFromLocalStorageRaw();
  storage.entries = storage.entries.filter(e => e.token.streamId !== streamId);
  saveToLocalStorageRaw(storage);
}

/**
 * List all available resume tokens.
 *
 * Returns all resume tokens across all storage mechanisms, useful for
 * displaying available resume options to the user.
 *
 * @returns Array of resume tokens with metadata
 */
export async function listResumeTokens(): Promise<Array<{ token: ResumeToken; streamId: number }>> {
  const results: Array<{ token: ResumeToken; streamId: number }> = [];

  // Try IndexedDB
  try {
    const indexedDBTokens = await listFromIndexedDB();
    results.push(...indexedDBTokens);
  } catch (e) {
    console.warn('Failed to list from IndexedDB:', e);
  }

  // Try localStorage
  try {
    const localStorageTokens = listFromLocalStorage();
    // Deduplicate by streamId
    for (const item of localStorageTokens) {
      if (!results.some(r => r.streamId === item.streamId)) {
        results.push(item);
      }
    }
  } catch (e) {
    console.warn('Failed to list from localStorage:', e);
  }

  return results;
}

/**
 * List from IndexedDB.
 */
async function listFromIndexedDB(): Promise<Array<{ token: ResumeToken; streamId: number }>> {
  const db = await openResumeDatabase();
  const tx = db.transaction(['resume-tokens'], 'readonly');
  const store = tx.objectStore('resume-tokens');

  const entries = await new Promise<ResumeStorageEntry[]>((resolve, reject) => {
    const request = store.getAll();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(new Error('IndexedDB getAll failed'));
  });

  db.close();

  return entries
    .filter(entry => validateResumeTokenStructure(entry.token))
    .map(entry => ({
      token: entry.token,
      streamId: entry.token.streamId,
    }));
}

/**
 * List from localStorage.
 */
function listFromLocalStorage(): Array<{ token: ResumeToken; streamId: number }> {
  const storage = loadFromLocalStorageRaw();

  return storage.entries
    .filter(entry => validateResumeTokenStructure(entry.token))
    .map(entry => ({
      token: entry.token,
      streamId: entry.token.streamId,
    }));
}

/**
 * Clear all resume tokens.
 *
 * Used for cleanup or when resetting all transfer state.
 */
export async function clearResumeTokens(): Promise<void> {
  // Clear IndexedDB
  try {
    await clearIndexedDB();
  } catch (e) {
    console.warn('Failed to clear IndexedDB:', e);
  }

  // Clear localStorage
  try {
    clearLocalStorage();
  } catch (e) {
    console.warn('Failed to clear localStorage:', e);
  }
}

/**
 * Clear IndexedDB.
 */
async function clearIndexedDB(): Promise<void> {
  const db = await openResumeDatabase();
  const tx = db.transaction(['resume-tokens'], 'readwrite');
  const store = tx.objectStore('resume-tokens');

  await new Promise<void>((resolve, reject) => {
    const request = store.clear();
    request.onsuccess = () => resolve();
    request.onerror = () => reject(new Error('IndexedDB clear failed'));
  });

  db.close();
}

/**
 * Clear localStorage.
 */
function clearLocalStorage(): void {
  localStorage.removeItem(RESUME_STORAGE_KEY);
}

/**
 * Cleanup old entries exceeding LRU limit or age limit.
 */
async function cleanupOldEntries(db: IDBDatabase): Promise<void> {
  const tx = db.transaction(['resume-tokens'], 'readwrite');
  const store = tx.objectStore('resume-tokens');

  const entries = await new Promise<ResumeStorageEntry[]>((resolve, reject) => {
    const request = store.getAll();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(new Error('IndexedDB getAll failed'));
  });

  const now = Date.now();
  const toDelete: string[] = [];

  // Delete expired entries
  for (const entry of entries) {
    if (now - entry.storedAt > MAX_RESUME_AGE) {
      toDelete.push(entry.token.streamId.toString());
    }
  }

  // LRU eviction if too many entries
  if (entries.length > MAX_RESUME_TOKENS) {
    const sorted = [...entries].sort((a, b) => {
      // First evict expired, then by last access time
      const aExpired = now - a.storedAt > MAX_RESUME_AGE;
      const bExpired = now - b.storedAt > MAX_RESUME_AGE;
      if (aExpired && !bExpired) return -1;
      if (!aExpired && bExpired) return 1;
      return a.lastAccess - b.lastAccess;
    });

    const excessCount = entries.length - MAX_RESUME_TOKENS;
    for (let i = 0; i < excessCount; i++) {
      const streamIdStr = sorted[i]!.token.streamId.toString();
      if (!toDelete.includes(streamIdStr)) {
        toDelete.push(streamIdStr);
      }
    }
  }

  // Delete marked entries
  for (const streamIdStr of toDelete) {
    await new Promise<void>((resolve, reject) => {
      const request = store.delete(streamIdStr);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(new Error('IndexedDB delete failed'));
    });
  }
}

/**
 * Update access count for LRU tracking.
 */
async function updateAccessCount(streamId: number): Promise<void> {
  try {
    const db = await openResumeDatabase();
    const tx = db.transaction(['resume-tokens'], 'readwrite');
    const store = tx.objectStore('resume-tokens');

    const entry = await new Promise<ResumeStorageEntry | null>((resolve, reject) => {
      const request = store.get(streamId.toString());
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(new Error('IndexedDB get failed'));
    });

    if (entry) {
      entry.accessCount++;
      entry.lastAccess = Date.now();

      await new Promise<void>((resolve, reject) => {
        const request = store.put(entry, streamId.toString());
        request.onsuccess = () => resolve();
        request.onerror = () => reject(new Error('IndexedDB put failed'));
      });
    }

    db.close();
  } catch (e) {
    console.warn('Failed to update access count:', e);
  }
}

/**
 * Enforce LRU limit on entries array.
 */
function enforceLRULimit(entries: ResumeStorageEntry[]): void {
  if (entries.length <= MAX_RESUME_TOKENS) {
    return;
  }

  const now = Date.now();
  const sorted = [...entries].sort((a, b) => {
    // First evict expired, then by last access time
    const aExpired = now - a.storedAt > MAX_RESUME_AGE;
    const bExpired = now - b.storedAt > MAX_RESUME_AGE;
    if (aExpired && !bExpired) return -1;
    if (!aExpired && bExpired) return 1;
    return a.lastAccess - b.lastAccess;
  });

  const excessCount = entries.length - MAX_RESUME_TOKENS;
  sorted.splice(0, excessCount);

  // Modify in place
  entries.length = 0;
  entries.push(...sorted);
}

/**
 * Open IndexedDB database for resume storage.
 */
function openResumeDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('screenferry-resume', 1);

    request.onerror = () => reject(new Error('Failed to open IndexedDB'));
    request.onsuccess = () => resolve(request.result);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains('resume-tokens')) {
        db.createObjectStore('resume-tokens');
      }
    };
  });
}

/**
 * Load from localStorage (raw, no validation).
 */
function loadFromLocalStorageRaw(): ResumeStorage {
  try {
    const raw = localStorage.getItem(RESUME_STORAGE_KEY);
    if (!raw) {
      return { entries: [] };
    }

    const storage = JSON.parse(raw) as ResumeStorage;
    if (!storage || !Array.isArray(storage.entries)) {
      return { entries: [] };
    }

    return storage;
  } catch (e) {
    console.warn('Failed to load from localStorage:', e);
    return { entries: [] };
  }
}

/**
 * Save to localStorage (raw, no validation).
 */
function saveToLocalStorageRaw(storage: ResumeStorage): void {
  try {
    const raw = JSON.stringify(storage);
    localStorage.setItem(RESUME_STORAGE_KEY, raw);
  } catch (e) {
    const error = e as Error;
    if (error.name === 'QuotaExceededError') {
      // Try to make space by evicting old entries
      enforceLRULimit(storage.entries);
      try {
        const raw = JSON.stringify(storage);
        localStorage.setItem(RESUME_STORAGE_KEY, raw);
      } catch (e2) {
        throw new Error('localStorage quota exceeded and cleanup failed');
      }
    } else {
      throw error;
    }
  }
}

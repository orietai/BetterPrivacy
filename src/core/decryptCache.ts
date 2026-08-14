/**
 * BetterPrivacy — in-memory decrypt cache (spec §6/§11).
 *
 * Maps cache keys (messageId:editTs or attachment id) to decrypted results.
 * Media entries (blob URLs) count against settings.memoryBudgetMB and are
 * LRU-evicted (Map insertion order = recency; get() re-inserts on hit).
 * Everything lives in memory only and is purged on relock.
 */

import type { CacheEntry, DecryptCache, SettingsStore } from '../types'

/**
 * Hard cap on total cache entries. Text and 'failed' entries carry no byte
 * cost against the media budget, so over a long session they would otherwise
 * grow unbounded.
 */
const MAX_ENTRIES = 20_000

export function createDecryptCache(settings: SettingsStore): DecryptCache {
  const entries = new Map<string, CacheEntry>()
  let mediaBytes = 0

  function revokeIfMedia(entry: CacheEntry): void {
    if (entry.kind === 'media') {
      mediaBytes -= entry.byteSize
      try {
        URL.revokeObjectURL(entry.blobUrl)
      } catch {
        // Blob URL may already be revoked/invalid — nothing to do.
      }
    }
  }

  function budgetBytes(): number {
    return settings.get().memoryBudgetMB * 1024 * 1024
  }

  /**
   * Evict oldest media entries until total media bytes fit the budget.
   * `spareKey` (the just-inserted entry) is never evicted in this pass — a
   * single file larger than the whole budget must survive long enough to
   * render at least once, not have its blob URL revoked immediately.
   */
  function evictToBudget(spareKey: string): void {
    if (mediaBytes <= budgetBytes()) return
    for (const [k, entry] of entries) {
      if (k === spareKey || entry.kind !== 'media') continue
      entries.delete(k)
      revokeIfMedia(entry)
      if (mediaBytes <= budgetBytes()) break
    }
  }

  /** Evict oldest entries (any kind) until under MAX_ENTRIES, sparing `spareKey`. */
  function evictToEntryCap(spareKey: string): void {
    if (entries.size <= MAX_ENTRIES) return
    for (const [k, entry] of entries) {
      if (k === spareKey) continue
      entries.delete(k)
      revokeIfMedia(entry)
      if (entries.size <= MAX_ENTRIES) break
    }
  }

  return {
    key(messageId: string, editTs?: string | number | null): string {
      return `${messageId}:${editTs ?? '0'}`
    },

    get(k: string): CacheEntry | undefined {
      const entry = entries.get(k)
      if (entry === undefined) return undefined
      // Refresh LRU recency for media entries (Map preserves insertion order).
      if (entry.kind === 'media') {
        entries.delete(k)
        entries.set(k, entry)
      }
      return entry
    },

    set(k: string, e: CacheEntry): void {
      const existing = entries.get(k)
      if (existing !== undefined) {
        entries.delete(k)
        revokeIfMedia(existing)
      }
      entries.set(k, e)
      if (e.kind === 'media') {
        mediaBytes += e.byteSize
        evictToBudget(k)
      }
      evictToEntryCap(k)
    },

    purge(keyIds: string[] | 'all'): void {
      if (keyIds === 'all') {
        for (const entry of entries.values()) revokeIfMedia(entry)
        entries.clear()
        mediaBytes = 0
        return
      }
      const ids = new Set(keyIds)
      for (const [k, entry] of entries) {
        if (ids.has(entry.keyId)) {
          entries.delete(k)
          revokeIfMedia(entry)
        }
      }
    },
  }
}

/**
 * BetterPrivacy — in-memory session of unlocked keys (spec §7).
 *
 * Holds derived CryptoKeys in memory ONLY. Implements lockdown relocking on
 * channel switch and the inactivity-timeout sweep. Nothing here ever touches
 * BdApi.Data.
 */

import { PLUGIN_NAME, type KeyEntry, type Keyring, type RelockReason, type Session, type SettingsStore } from '../types'
import { deriveKeyMaterial } from '../crypto/kdf'

const SWEEP_INTERVAL_MS = 60_000

interface UnlockedKey {
  key: CryptoKey
  unlockedAt: number
  lastUsedAt: number
}

export function createSession(keyring: Keyring, settings: SettingsStore): Session {
  const unlocked = new Map<string, UnlockedKey>()
  const relockListeners: Array<(keyIds: string[] | 'all', reason: RelockReason) => void> = []
  let sweepTimer: ReturnType<typeof setInterval> | null = null

  function fireRelock(keyIds: string[] | 'all', reason: RelockReason): void {
    for (const cb of relockListeners) {
      try {
        cb(keyIds, reason)
      } catch (err) {
        console.error(`[${PLUGIN_NAME}] onRelock listener failed`, err)
      }
    }
  }

  function lockAll(reason: RelockReason): void {
    if (unlocked.size === 0) return
    unlocked.clear()
    fireRelock('all', reason)
  }

  function sweep(): void {
    const timeoutSec = settings.get().decryptTimeoutSec
    if (timeoutSec <= 0) return // 0 = never expire
    const now = Date.now()
    const purged: string[] = []
    for (const [keyId, entry] of unlocked) {
      if (now - entry.lastUsedAt > timeoutSec * 1000) {
        unlocked.delete(keyId)
        purged.push(keyId)
      }
    }
    if (purged.length > 0) {
      fireRelock(purged, 'timeout')
      BdApi.UI.showToast('BetterPrivacy: session keys expired', { type: 'info' })
    }
  }

  return {
    async unlock(entry: KeyEntry, passphrase: string): Promise<boolean> {
      let derived
      try {
        derived = await deriveKeyMaterial(passphrase, entry.salt)
      } catch (err) {
        console.error(`[${PLUGIN_NAME}] key derivation failed`, err)
        return false
      }
      // Wrong passphrase => different derived bits => KCV and keyId both
      // diverge from the stored entry. Check both for defense in depth.
      if (derived.kcv !== entry.check || derived.keyId !== entry.id) return false
      const now = Date.now()
      unlocked.set(entry.id, { key: derived.key, unlockedAt: now, lastUsedAt: now })
      return true
    },

    getKey(keyId: string): CryptoKey | null {
      const entry = unlocked.get(keyId)
      if (!entry) return null
      entry.lastUsedAt = Date.now()
      return entry.key
    },

    isUnlocked(keyId: string): boolean {
      return unlocked.has(keyId)
    },

    lockKey(keyId: string): void {
      if (unlocked.delete(keyId)) {
        fireRelock([keyId], 'manual')
      }
    },

    lockAll,

    handleChannelSwitch(prevChannelId: string | null, _nextChannelId: string): void {
      if (settings.get().relockScope === 'all') {
        lockAll('lockdown')
        return
      }
      // 'previousChannelOnly': lock only keys scoped to the channel we left.
      if (prevChannelId === null) return
      const toLock: string[] = []
      for (const keyId of unlocked.keys()) {
        const entry = keyring.get(keyId)
        if (entry && entry.scope === prevChannelId) toLock.push(keyId)
      }
      if (toLock.length === 0) return
      for (const keyId of toLock) unlocked.delete(keyId)
      fireRelock(toLock, 'lockdown')
    },

    start(): void {
      if (sweepTimer !== null) return
      sweepTimer = setInterval(sweep, SWEEP_INTERVAL_MS)
    },

    stop(): void {
      if (sweepTimer !== null) {
        clearInterval(sweepTimer)
        sweepTimer = null
      }
      lockAll('stop')
    },

    onRelock(cb: (keyIds: string[] | 'all', reason: RelockReason) => void): void {
      relockListeners.push(cb)
    },
  }
}

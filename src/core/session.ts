/**
 * BetterPrivacy — in-memory session of unlocked keys (spec §7).
 *
 * Holds derived CryptoKeys in memory ONLY. Implements lockdown relocking on
 * channel switch and the inactivity-timeout sweep. Nothing here ever touches
 * BdApi.Data.
 */

import { PLUGIN_NAME, type KeyEntry, type Keyring, type RelockReason, type Session, type SettingsStore } from '../types'
import { deriveKeyMaterial } from '../crypto/kdf'
import { t } from '../i18n'

const SWEEP_INTERVAL_MS = 60_000

/** Internal extension: modal cancellation is local to its attempt, not a lock
 * of every other reader using this key. Keep the public Session API unchanged. */
export function unlockIfCurrent(session: Session, entry: KeyEntry, phrase: string, current: () => boolean): Promise<boolean> {
  return (session.unlock as (entry: KeyEntry, phrase: string, current?: () => boolean) => Promise<boolean>)(entry, phrase, current)
}

interface UnlockedKey {
  key: CryptoKey
  unlockedAt: number
  lastUsedAt: number
}

export function createSession(keyring: Keyring, settings: SettingsStore): Session {
  const unlocked = new Map<string, UnlockedKey>()
  const relockListeners: Array<(keyIds: string[] | 'all', reason: RelockReason) => void> = []
  let sweepTimer: ReturnType<typeof setInterval> | null = null
  let generation = 0
  let revision = 0
  let stopped = false
  const keyGenerations = new Map<string, number>()

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
    // Also invalidate pending PBKDF2 work when no key has finished unlocking.
    generation++
    revision++
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
        keyGenerations.set(keyId, (keyGenerations.get(keyId) ?? 0) + 1)
        purged.push(keyId)
      }
    }
    if (purged.length > 0) {
      revision++
      fireRelock(purged, 'timeout')
      BdApi.UI.showToast(t('ses.expired'), { type: 'info' })
    }
  }

  return {
    get revision(): number { return revision },
    async unlock(entry: KeyEntry, passphrase: string, current: () => boolean = () => true): Promise<boolean> {
      if (stopped || !current()) return false
      const started = generation
      const keyStarted = keyGenerations.get(entry.id) ?? 0
      const { id, salt, check } = entry
      let derived
      try {
        derived = await deriveKeyMaterial(passphrase, salt)
      } catch (err) {
        console.error(`[${PLUGIN_NAME}] key derivation failed`, err)
        return false
      }
      // Wrong passphrase => different derived bits => KCV and keyId both
      // diverge from the stored entry. Check both for defense in depth.
      if (derived.kcv !== check || derived.keyId !== id) return false
      const saved = keyring.get(id)
      if (stopped || !current() || generation !== started || (keyGenerations.get(id) ?? 0) !== keyStarted ||
          saved?.salt !== salt || saved?.check !== check) return false
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
      revision++
      keyGenerations.set(keyId, (keyGenerations.get(keyId) ?? 0) + 1)
      unlocked.delete(keyId)
      fireRelock([keyId], 'manual')
    },

    lockAll,

    handleChannelSwitch(prevChannelId: string | null, _nextChannelId: string): void {
      if (settings.get().relockScope === 'all') {
        lockAll('lockdown')
        return
      }
      generation++
      revision++
      // 'previousChannelOnly': lock only keys scoped to the channel we left.
      if (prevChannelId === null) { fireRelock([], 'lockdown'); return }
      const toLock: string[] = []
      for (const keyId of unlocked.keys()) {
        const entry = keyring.get(keyId)
        if (entry && entry.scope === prevChannelId) toLock.push(keyId)
      }
      for (const keyId of toLock) unlocked.delete(keyId)
      for (const keyId of toLock) keyGenerations.set(keyId, (keyGenerations.get(keyId) ?? 0) + 1)
      fireRelock(toLock, 'lockdown')
    },

    start(): void {
      stopped = false
      if (sweepTimer !== null) return
      sweepTimer = setInterval(sweep, SWEEP_INTERVAL_MS)
    },

    stop(): void {
      stopped = true
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

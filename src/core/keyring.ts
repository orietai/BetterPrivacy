/**
 * BetterPrivacy — persistent keyring (spec §4).
 *
 * Stores key ENTRIES only: { id, label, salt, check, scope, createdAt }.
 * Passphrases and derived CryptoKeys are NEVER persisted — the passphrase is
 * only ever used transiently in create()/importBlob() to derive the key id
 * and check value, and in Session.unlock() to re-derive the CryptoKey.
 *
 * TODO(master-passphrase): v1 stores the keyring JSON in BdApi.Data as
 * plaintext (labels/salts/KCVs — no secrets). When
 * settings.masterPassphraseEnabled lands, encrypt this JSON at rest with
 * AES-GCM under a PBKDF2 key from the master passphrase (own salt).
 */

import { PLUGIN_NAME, type KeyEntry, type Keyring, type Scope } from '../types'
import { deriveKeyMaterial, deriveSaltFromLabel } from '../crypto/kdf'
import { t } from '../i18n'

const KEYRING_KEY = 'keyring'
const PREFS_KEY = 'channelPrefs'

interface ChannelPref {
  activeKeyId: string | null
  encryptMode: boolean
}

/** Validate a single persisted keyring entry (untrusted disk data). */
function isValidEntry(raw: unknown): raw is KeyEntry {
  if (typeof raw !== 'object' || raw === null) return false
  const e = raw as Record<string, unknown>
  return (
    typeof e['id'] === 'string' &&
    e['id'].length > 0 &&
    typeof e['label'] === 'string' &&
    typeof e['salt'] === 'string' &&
    e['salt'].length > 0 &&
    typeof e['check'] === 'string' &&
    e['check'].length > 0 &&
    typeof e['scope'] === 'string' &&
    e['scope'].length > 0 &&
    typeof e['createdAt'] === 'number'
  )
}

function loadEntries(): KeyEntry[] {
  try {
    const raw = BdApi.Data.load(PLUGIN_NAME, KEYRING_KEY)
    if (!Array.isArray(raw)) return []
    const out: KeyEntry[] = []
    const seen = new Set<string>()
    for (const item of raw) {
      if (isValidEntry(item) && !seen.has(item.id)) {
        seen.add(item.id)
        out.push({
          id: item.id,
          label: item.label,
          salt: item.salt,
          check: item.check,
          scope: item.scope,
          createdAt: item.createdAt,
        })
      }
    }
    return out
  } catch {
    return []
  }
}

function loadPrefs(): Record<string, ChannelPref> {
  try {
    const raw = BdApi.Data.load(PLUGIN_NAME, PREFS_KEY)
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {}
    const out: Record<string, ChannelPref> = {}
    for (const [channelId, value] of Object.entries(raw as Record<string, unknown>)) {
      if (typeof value !== 'object' || value === null) continue
      const v = value as Record<string, unknown>
      const activeKeyId = typeof v['activeKeyId'] === 'string' ? v['activeKeyId'] : null
      const encryptMode = v['encryptMode'] === true
      out[channelId] = { activeKeyId, encryptMode }
    }
    return out
  } catch {
    return {}
  }
}

const BLOB_PREFIX = 'betterprivacy-key:'

/** Standard base64 encode of a UTF-8 string. */
function b64EncodeUtf8(s: string): string {
  const bytes = new TextEncoder().encode(s)
  let bin = ''
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!)
  return btoa(bin)
}

/** Standard base64 decode to a UTF-8 string. Throws on invalid base64. */
function b64DecodeUtf8(b64: string): string {
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new TextDecoder().decode(bytes)
}

export function createKeyring(): Keyring {
  let entries: KeyEntry[] = loadEntries()
  let prefs: Record<string, ChannelPref> = loadPrefs()

  function saveEntries(): void {
    try {
      BdApi.Data.save(PLUGIN_NAME, KEYRING_KEY, entries)
    } catch (err) {
      console.error(`[${PLUGIN_NAME}] failed to persist keyring`, err)
    }
  }

  function savePrefs(): void {
    try {
      BdApi.Data.save(PLUGIN_NAME, PREFS_KEY, prefs)
    } catch (err) {
      console.error(`[${PLUGIN_NAME}] failed to persist channel prefs`, err)
    }
  }

  function addEntry(entry: KeyEntry): void {
    if (entries.some((e) => e.id === entry.id)) {
      throw new Error(t('kr.exists', { id: entry.id }))
    }
    entries.push(entry)
    saveEntries()
  }

  function getPref(channelId: string): ChannelPref {
    return prefs[channelId] ?? { activeKeyId: null, encryptMode: false }
  }

  return {
    list(): KeyEntry[] {
      return entries.slice()
    },

    get(id: string): KeyEntry | undefined {
      return entries.find((e) => e.id === id)
    },

    forChannel(channelId: string): KeyEntry[] {
      return entries.filter((e) => e.scope === 'global' || e.scope === channelId)
    },

    async create(label: string, passphrase: string, scope: Scope): Promise<KeyEntry> {
      // Label + passphrase determine the key, so reinstalling and recreating
      // the same pair restores access without retaining local configuration.
      const salt = await deriveSaltFromLabel(label)
      const derived = await deriveKeyMaterial(passphrase, salt)
      // Same label+passphrase → same key: idempotent restore, not an error.
      const existing = entries.find((e) => e.id === derived.keyId)
      if (existing) return existing
      const entry: KeyEntry = {
        id: derived.keyId,
        label,
        salt,
        check: derived.kcv,
        scope,
        createdAt: Date.now(),
      }
      // The derived CryptoKey is intentionally dropped here — unlocking is
      // Session's job; nothing derived is ever persisted.
      addEntry(entry)
      return entry
    },

    async importBlob(blob: string, passphrase: string, scope: Scope = 'global'): Promise<KeyEntry> {
      const trimmed = blob.trim()
      if (!trimmed.startsWith(BLOB_PREFIX)) {
        throw new Error(t('kr.notBlob'))
      }
      let parsed: unknown
      try {
        parsed = JSON.parse(b64DecodeUtf8(trimmed.slice(BLOB_PREFIX.length)))
      } catch {
        throw new Error(t('kr.malformed'))
      }
      if (typeof parsed !== 'object' || parsed === null) {
        throw new Error(t('kr.malformedShape'))
      }
      const p = parsed as Record<string, unknown>
      const label = p['label']
      const salt = p['salt']
      const check = p['check']
      if (typeof label !== 'string' || typeof salt !== 'string' || salt.length === 0 || typeof check !== 'string' || check.length === 0) {
        throw new Error(t('kr.malformedFields'))
      }

      const derived = await deriveKeyMaterial(passphrase, salt)
      if (derived.kcv !== check) {
        throw new Error(t('kr.wrongPass'))
      }

      // Re-importing a key that's already present is a no-op, not an error.
      const existing = entries.find((e) => e.id === derived.keyId)
      if (existing) return existing

      const entry: KeyEntry = {
        id: derived.keyId,
        label,
        salt,
        check,
        scope,
        createdAt: Date.now(),
      }
      addEntry(entry)
      return entry
    },

    async recover(label, passphrase, metadata, scope, authenticate): Promise<KeyEntry> {
      if (!/^[A-Za-z0-9_-]{8}$/.test(metadata.keyId) || !/^[A-Za-z0-9_-]{22}$/.test(metadata.salt)) {
        throw new Error(t('kr.malformedFields'))
      }
      const derived = await deriveKeyMaterial(passphrase, metadata.salt)
      if (derived.keyId !== metadata.keyId) throw new Error(t('um.wrongPassphrase'))
      // A fingerprint alone is not proof of an intact message/container.
      // Authenticate before writing: wrong phrases and tampered data add nothing.
      await authenticate(derived.key)
      const existing = entries.find((entry) => entry.id === derived.keyId)
      if (existing) return existing
      const entry: KeyEntry = {
        id: derived.keyId, label, salt: metadata.salt, check: derived.kcv, scope, createdAt: Date.now(),
      }
      addEntry(entry)
      return entry
    },

    exportBlob(id: string): string {
      const entry = entries.find((e) => e.id === id)
      if (!entry) throw new Error(t('kr.noKey', { id }))
      const json = JSON.stringify({ label: entry.label, salt: entry.salt, check: entry.check })
      return BLOB_PREFIX + b64EncodeUtf8(json)
    },

    remove(id: string): void {
      const before = entries.length
      entries = entries.filter((e) => e.id !== id)
      if (entries.length !== before) saveEntries()
      // Drop any per-channel reference to the removed key.
      let prefsChanged = false
      for (const pref of Object.values(prefs)) {
        if (pref.activeKeyId === id) {
          pref.activeKeyId = null
          prefsChanged = true
        }
      }
      if (prefsChanged) savePrefs()
    },

    getActiveSendKey(channelId: string): string | null {
      return getPref(channelId).activeKeyId
    },

    setActiveSendKey(channelId: string, keyId: string | null): void {
      const pref = getPref(channelId)
      prefs[channelId] = { ...pref, activeKeyId: keyId }
      savePrefs()
    },

    isEncryptModeOn(channelId: string): boolean {
      return getPref(channelId).encryptMode
    },

    setEncryptMode(channelId: string, on: boolean): void {
      const pref = getPref(channelId)
      prefs[channelId] = { ...pref, encryptMode: on }
      savePrefs()
    },
  }
}

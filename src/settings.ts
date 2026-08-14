/**
 * BetterPrivacy — settings store.
 *
 * Persists SettingsData via BdApi.Data under ('BetterPrivacy', 'settings').
 * Stored data is merged over DEFAULT_SETTINGS; unknown keys are dropped and
 * out-of-range values are sanitized so a corrupted store can never poison
 * the runtime config.
 */

import { PLUGIN_NAME, type SettingsData, type SettingsStore } from './types'

export const DEFAULT_SETTINGS: SettingsData = {
  // UX decision (0.2): OFF by default — relocking every channel switch forces
  // constant passphrase re-entry, which is the paranoid opt-in mode, not the
  // default. The 3 h inactivity timeout remains the default safety net.
  lockdown: false,
  relockScope: 'all',
  decryptTimeoutSec: 10800,
  masterPassphraseEnabled: false,
  indicatorColor: '#3ba55d',
  maxAutoDownloadBytes: 25 * 1024 * 1024,
  memoryBudgetMB: 200,
  clientLinkPreviews: false,
}

const DATA_KEY = 'settings'

/** Clamp decryptTimeoutSec to 0 (= never) or the [300, 86400] range. */
function clampTimeout(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0
  if (value < 300) return 300
  if (value > 86400) return 86400
  return Math.floor(value)
}

/**
 * Merge an untrusted partial (from disk or from set()) over a base config.
 * Only known keys are copied, and only when the value has the right type.
 */
function sanitize(base: SettingsData, raw: unknown): SettingsData {
  const out: SettingsData = { ...base }
  if (typeof raw !== 'object' || raw === null) return out
  const r = raw as Record<string, unknown>

  if (typeof r['lockdown'] === 'boolean') out.lockdown = r['lockdown']
  if (r['relockScope'] === 'all' || r['relockScope'] === 'previousChannelOnly') {
    out.relockScope = r['relockScope']
  }
  if (typeof r['decryptTimeoutSec'] === 'number') {
    out.decryptTimeoutSec = clampTimeout(r['decryptTimeoutSec'])
  }
  if (typeof r['masterPassphraseEnabled'] === 'boolean') {
    out.masterPassphraseEnabled = r['masterPassphraseEnabled']
  }
  if (typeof r['indicatorColor'] === 'string' && r['indicatorColor'].length > 0) {
    out.indicatorColor = r['indicatorColor']
  }
  if (typeof r['maxAutoDownloadBytes'] === 'number' && Number.isFinite(r['maxAutoDownloadBytes']) && r['maxAutoDownloadBytes'] >= 0) {
    out.maxAutoDownloadBytes = Math.floor(r['maxAutoDownloadBytes'])
  }
  if (typeof r['memoryBudgetMB'] === 'number' && Number.isFinite(r['memoryBudgetMB']) && r['memoryBudgetMB'] > 0) {
    out.memoryBudgetMB = Math.floor(r['memoryBudgetMB'])
  }
  if (typeof r['clientLinkPreviews'] === 'boolean') {
    out.clientLinkPreviews = r['clientLinkPreviews']
  }
  return out
}

export function createSettingsStore(): SettingsStore {
  let current: SettingsData
  try {
    current = sanitize(DEFAULT_SETTINGS, BdApi.Data.load(PLUGIN_NAME, DATA_KEY))
  } catch {
    current = { ...DEFAULT_SETTINGS }
  }

  const listeners: Array<(s: SettingsData) => void> = []

  return {
    get(): SettingsData {
      return current
    },
    set(patch: Partial<SettingsData>): void {
      current = sanitize(current, patch)
      try {
        BdApi.Data.save(PLUGIN_NAME, DATA_KEY, current)
      } catch (err) {
        console.error(`[${PLUGIN_NAME}] failed to persist settings`, err)
      }
      for (const cb of listeners) {
        try {
          cb(current)
        } catch (err) {
          console.error(`[${PLUGIN_NAME}] settings onChange listener failed`, err)
        }
      }
    },
    onChange(cb: (s: SettingsData) => void): void {
      listeners.push(cb)
    },
  }
}

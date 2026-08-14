/**
 * BetterPrivacy — settings panel (Key Manager + plugin settings).
 *
 * buildSettingsPanel(ctx) is returned from the plugin's getSettingsPanel().
 * It renders the keyring table (export/delete), import/create buttons, all
 * SettingsData toggles, and a "Lock all now" panic button.
 *
 * Settings values are read fresh from ctx.settings.get() on every render and
 * written via ctx.settings.set(); a useReducer bump refreshes both the key
 * list and settings after any mutation (SettingsStore.onChange has no
 * unsubscribe, so a transient panel component must not subscribe to it).
 */

import type { PluginContext, SettingsData } from '../types'
import { friendlyFailureNames } from '../index'
import { openCreateKeyModal } from './UnlockModal'

const MB = 1024 * 1024

export function buildSettingsPanel(ctx: PluginContext): any {
  return BdApi.React.createElement(KeyManagerPanel, { ctx })
}

// ---------------------------------------------------------------------------
// Small building blocks
// ---------------------------------------------------------------------------

function Row(props: { label: string; hint?: string; children?: any }): JSX.Element {
  return (
    <div className="bp-row">
      <div style={{ flex: 1 }}>
        <div style={{ color: 'var(--header-primary, #f2f3f5)', fontSize: 14 }}>{props.label}</div>
        {props.hint ? <div className="bp-hint">{props.hint}</div> : null}
      </div>
      <div>{props.children}</div>
    </div>
  )
}

/** Parses a number input's value; returns `fallback` for NaN/negative junk. */
function toNonNegativeInt(raw: string, fallback: number): number {
  const n = Math.floor(Number(raw))
  return Number.isFinite(n) && n >= 0 ? n : fallback
}

// ---------------------------------------------------------------------------
// Import-key modal
// ---------------------------------------------------------------------------

function ImportKeyContent(props: { state: { blob: string; pass: string } }): JSX.Element {
  return (
    <div>
      <label className="bp-modal-label">Key blob</label>
      <textarea
        className="bp-modal-input"
        rows={3}
        autoFocus
        placeholder="betterprivacy-key:…"
        onChange={(e: any) => {
          props.state.blob = e.target.value
        }}
      />
      <label className="bp-modal-label">Passphrase</label>
      <input
        className="bp-modal-input"
        type="password"
        placeholder="Passphrase for this key"
        onChange={(e: any) => {
          props.state.pass = e.target.value
        }}
      />
    </div>
  )
}

function openImportKeyModal(ctx: PluginContext, onDone: () => void): void {
  // onConfirm is sync and the modal closes immediately; the inputs mirror
  // their values into this closure and the async import runs afterwards.
  const state = { blob: '', pass: '' }
  BdApi.UI.showConfirmationModal('Import key', <ImportKeyContent state={state} />, {
    confirmText: 'Import',
    cancelText: 'Cancel',
    onConfirm: () => {
      void ctx.keyring
        .importBlob(state.blob.trim(), state.pass)
        .then(async (entry) => {
          // The passphrase was just verified against the KCV — unlock now so
          // imported keys work immediately without a second passphrase entry.
          try {
            await ctx.session.unlock(entry, state.pass)
          } catch {
            // Import stands on its own; unlocking can be done later.
          }
          BdApi.UI.showToast(`BetterPrivacy: imported & unlocked "${entry.label}" (${entry.id})`, {
            type: 'success',
          })
          ctx.forceRerender()
          onDone()
        })
        .catch((err: any) => {
          BdApi.UI.showToast(err?.message ?? 'Key import failed', { type: 'error' })
        })
    },
  })
}

// ---------------------------------------------------------------------------
// The panel
// ---------------------------------------------------------------------------

function KeyManagerPanel({ ctx }: { ctx: PluginContext }): JSX.Element {
  const { useReducer, useState } = BdApi.React
  const [, bump] = useReducer((n: number) => n + 1, 0)
  // Decrypt timeout is held as a draft string while the user types (the store
  // clamps to its 300–86400 range, so committing per keystroke turns "600"
  // into "6" → clamped mid-typing). Commit on blur/Enter; null = not editing.
  const [timeoutDraft, setTimeoutDraft] = useState(null) as [
    string | null,
    (v: string | null) => void,
  ]

  const settings: SettingsData = ctx.settings.get()
  const keys = ctx.keyring.list()

  const patch = (p: Partial<SettingsData>): void => {
    ctx.settings.set(p)
    bump()
  }

  /** Commits the decrypt-timeout draft; the field then shows the clamped result. */
  const commitTimeoutDraft = (): void => {
    if (timeoutDraft === null) return
    patch({ decryptTimeoutSec: toNonNegativeInt(timeoutDraft, settings.decryptTimeoutSec) })
    setTimeoutDraft(null)
  }

  const exportKey = (id: string): void => {
    try {
      const blob = ctx.keyring.exportBlob(id)
      void navigator.clipboard.writeText(blob).then(
        () => BdApi.UI.showToast('Key blob copied to clipboard', { type: 'success' }),
        () => BdApi.UI.showToast('Could not write to clipboard', { type: 'error' }),
      )
    } catch (err: any) {
      BdApi.UI.showToast(err?.message ?? 'Export failed', { type: 'error' })
    }
  }

  const deleteKey = (id: string, label: string): void => {
    BdApi.UI.showConfirmationModal(
      'Delete key',
      `Delete key "${label}" (${id})? Messages encrypted with it become unreadable until the key is imported again.`,
      {
        danger: true,
        confirmText: 'Delete',
        cancelText: 'Cancel',
        onConfirm: () => {
          // Lock first so the session key and any cached plaintext for it are
          // purged (via the onRelock wiring), then drop the keyring entry —
          // mirrors ChatBarControls.removeKey.
          ctx.session.lockKey(id)
          ctx.keyring.remove(id)
          BdApi.UI.showToast(`Key "${label}" deleted`, { type: 'info' })
          bump()
          ctx.forceRerender()
        },
      },
    )
  }

  return (
    <div className="bp-settings">
      <h3>Health</h3>
      {ctx.modules.failed.length > 0 ? (
        <div style={{ color: 'var(--status-danger, #ed4245)', fontSize: 13 }}>
          {'⚠'} Discord integration degraded — affected:{' '}
          {friendlyFailureNames(ctx.modules.failed).join(', ')}. A Discord or plugin update is
          likely needed.
        </div>
      ) : (
        <div className="bp-hint">All Discord integration points healthy.</div>
      )}

      <h3>🦇 Key Manager</h3>
      <table className="bp-table">
        <thead>
          <tr>
            <th>Label</th>
            <th>Key ID</th>
            <th>Scope</th>
            <th>Created</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {keys.map((k) => (
            <tr key={k.id}>
              <td>{k.label}</td>
              <td>
                <code>{k.id}</code>
              </td>
              <td>{k.scope === 'global' ? 'global' : k.scope}</td>
              <td>{new Date(k.createdAt).toLocaleDateString()}</td>
              <td style={{ whiteSpace: 'nowrap' }}>
                <button className="bp-btn bp-btn-secondary" onClick={() => exportKey(k.id)}>
                  Export
                </button>{' '}
                <button className="bp-btn bp-btn-danger" onClick={() => deleteKey(k.id, k.label)}>
                  Delete
                </button>
              </td>
            </tr>
          ))}
          {keys.length === 0 ? (
            <tr>
              <td colSpan={5} className="bp-hint">
                No keys yet — create or import one below.
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>

      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        <button className="bp-btn" onClick={() => void openCreateKeyModal(ctx).then(() => bump())}>
          New key{'…'}
        </button>
        <button
          className="bp-btn bp-btn-secondary"
          onClick={() => openImportKeyModal(ctx, () => bump())}
        >
          Import key{'…'}
        </button>
        <button
          className="bp-btn bp-btn-danger"
          style={{ marginLeft: 'auto' }}
          onClick={() => {
            ctx.session.lockAll('manual')
            BdApi.UI.showToast('BetterPrivacy: all keys locked', { type: 'info' })
            bump()
          }}
        >
          Lock all now
        </button>
      </div>

      <h3>Session</h3>
      <Row
        label="Lockdown mode"
        hint="Switching channels re-locks everything until passphrases are re-entered."
      >
        <input
          type="checkbox"
          checked={settings.lockdown}
          onChange={(e: any) => patch({ lockdown: e.target.checked })}
        />
      </Row>
      {settings.lockdown ? (
        <Row label="Relock scope" hint="Which keys are locked on a channel switch.">
          <select
            className="bp-modal-input"
            style={{ width: 'auto', margin: 0 }}
            value={settings.relockScope}
            onChange={(e: any) => patch({ relockScope: e.target.value })}
          >
            <option value="all">All keys</option>
            <option value="previousChannelOnly">Previous channel only</option>
          </select>
        </Row>
      ) : null}
      <Row label="Decrypt timeout (seconds)" hint="0 = never, default 10800">
        <input
          className="bp-modal-input"
          style={{ width: 100, margin: 0 }}
          type="number"
          min={0}
          value={timeoutDraft ?? String(settings.decryptTimeoutSec)}
          onChange={(e: any) => setTimeoutDraft(e.target.value)}
          onBlur={() => commitTimeoutDraft()}
          onKeyDown={(e: any) => {
            if (e.key === 'Enter') commitTimeoutDraft()
          }}
        />
      </Row>

      <h3>Appearance</h3>
      <Row label="Indicator color" hint="Text color and lock glyph of decrypted messages.">
        <input
          type="color"
          value={settings.indicatorColor}
          onChange={(e: any) => patch({ indicatorColor: e.target.value })}
        />
      </Row>

      <h3>Media & memory</h3>
      <Row
        label="Max auto-download size (MB)"
        hint="Encrypted attachments larger than this are not fetched automatically."
      >
        <input
          className="bp-modal-input"
          style={{ width: 100, margin: 0 }}
          type="number"
          min={0}
          value={Math.round(settings.maxAutoDownloadBytes / MB)}
          onChange={(e: any) =>
            patch({
              maxAutoDownloadBytes:
                toNonNegativeInt(e.target.value, Math.round(settings.maxAutoDownloadBytes / MB)) * MB,
            })
          }
        />
      </Row>
      <Row label="Memory budget (MB)" hint="Decrypted media beyond this budget is LRU-evicted.">
        <input
          className="bp-modal-input"
          style={{ width: 100, margin: 0 }}
          type="number"
          min={0}
          value={settings.memoryBudgetMB}
          onChange={(e: any) =>
            patch({ memoryBudgetMB: toNonNegativeInt(e.target.value, settings.memoryBudgetMB) })
          }
        />
      </Row>

      <h3>Advanced</h3>
      <Row label="Client-side link previews (experimental — leaks URLs to target sites)">
        <input
          type="checkbox"
          checked={settings.clientLinkPreviews}
          onChange={(e: any) => patch({ clientLinkPreviews: e.target.checked })}
        />
      </Row>
      <Row
        label="Master passphrase"
        hint="not yet implemented — v1 stores keyring metadata unencrypted"
      >
        <input type="checkbox" checked={settings.masterPassphraseEnabled} disabled />
      </Row>
    </div>
  )
}

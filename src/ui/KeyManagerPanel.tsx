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
import { t } from '../i18n'
import { unlockIfCurrent } from '../core/session'

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

/** Keep settings choices inside BetterDiscord's supported popup mechanism.
 * Raw HTML selects open a separate native popup in Electron, outside the
 * settings modal's DOM. Do not reintroduce them (or a per-field workaround).
 * This top-level component has stable identity across parent re-renders.
 */
function SettingsDropdown(props: {
  label: string
  value: string
  options: Array<{ label: string; value: string }>
  onChange: (value: string) => void
}): JSX.Element {
  const Dropdown = BdApi.Components?.DropdownInput
  if (!Dropdown) return <div className="bp-hint" role="status">{t('km.dropdownUnavailable')}</div>
  return (
    <div className="bp-setting-dropdown" role="group" aria-label={props.label}>
      {BdApi.React.createElement(Dropdown, {
        value: props.value,
        options: props.options,
        onChange: (value: unknown) => {
          // The host callback provides the value, NOT a DOM change event.
          if (typeof value !== 'string' || value === props.value) return
          if (props.options.some(option => option.value === value)) props.onChange(value)
        },
      })}
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
      <label className="bp-modal-label">{t('km.import.blobLabel')}</label>
      <textarea
        className="bp-modal-input"
        rows={3}
        autoFocus
        placeholder="betterprivacy-key:…"
        onChange={(e: any) => {
          props.state.blob = e.target.value
        }}
      />
      <label className="bp-modal-label">{t('km.import.passLabel')}</label>
      <input
        className="bp-modal-input"
        type="password"
        placeholder={t('km.import.passPh')}
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
  const revision = ctx.session.revision
  let cancelled = false
  let confirming = false
  let started = false
  const current = (): boolean => !cancelled && ctx.session.revision === revision
  const cancel = (): void => { cancelled = true; state.pass = '' }
  ctx.disposers.push(cancel)
  BdApi.UI.showConfirmationModal(t('km.import.title'), <ImportKeyContent state={state} />, {
    confirmText: t('common.import'),
    cancelText: t('common.cancel'),
    onConfirm: () => {
      if (started || !current()) return
      started = true
      confirming = true
      const phrase = state.pass
      const blob = state.blob.trim()
      state.pass = ''
      void ctx.keyring
        .importBlob(blob, phrase)
        .then(async (entry) => {
          if (!current()) return
          // The passphrase was just verified against the KCV — unlock now so
          // imported keys work immediately without a second passphrase entry.
          try {
            await unlockIfCurrent(ctx.session, entry, phrase, current)
          } catch {
            // Import stands on its own; unlocking can be done later.
          }
          if (!current()) return
          BdApi.UI.showToast(t('km.imported', { label: entry.label, id: entry.id }), {
            type: 'success',
          })
          ctx.forceRerender()
          onDone()
        })
        .catch((err: any) => {
          if (!current()) return
          BdApi.UI.showToast(err?.message ?? t('km.importFailed'), { type: 'error' })
        })
    },
    onCancel: cancel,
    onCloseCallback: () => { if (!confirming) cancel() },
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
        () => BdApi.UI.showToast(t('km.copied'), { type: 'success' }),
        () => BdApi.UI.showToast(t('km.copyFailed'), { type: 'error' }),
      )
    } catch (err: any) {
      BdApi.UI.showToast(err?.message ?? t('km.exportFailed'), { type: 'error' })
    }
  }

  const deleteKey = (id: string, label: string): void => {
    BdApi.UI.showConfirmationModal(
      t('km.deleteTitle'),
      t('km.deleteBody', { label, id }),
      {
        danger: true,
        confirmText: t('common.delete'),
        cancelText: t('common.cancel'),
        onConfirm: () => {
          // Lock first so the session key and any cached plaintext for it are
          // purged (via the onRelock wiring), then drop the keyring entry —
          // mirrors ChatBarControls.removeKey.
          ctx.session.lockKey(id)
          ctx.keyring.remove(id)
          BdApi.UI.showToast(t('km.deleted', { label }), { type: 'info' })
          bump()
          ctx.forceRerender()
        },
      },
    )
  }

  return (
    <div className="bp-settings">
      <h3>{t('km.health')}</h3>
      {ctx.modules.failed.length > 0 ? (
        <div style={{ color: 'var(--status-danger, #ed4245)', fontSize: 13 }}>
          {t('km.degraded', { list: friendlyFailureNames(ctx.modules.failed).join(', ') })}
        </div>
      ) : (
        <div className="bp-hint">{t('km.healthy')}</div>
      )}

      <h3>{t('km.title')}</h3>
      <table className="bp-table" role="table" aria-label={t('km.title')}>
        <thead role="rowgroup">
          <tr role="row">
            <th scope="col" role="columnheader">{t('km.th.label')}</th>
            <th scope="col" role="columnheader">{t('km.th.keyId')}</th>
            <th scope="col" role="columnheader">{t('km.th.scope')}</th>
            <th scope="col" role="columnheader">{t('km.th.created')}</th>
            <th scope="col" role="columnheader"><span className="bp-visually-hidden">{t('km.th.actions')}</span></th>
          </tr>
        </thead>
        <tbody role="rowgroup">
          {keys.map((k) => (
            <tr key={k.id} role="row">
              <td role="cell" className="bp-key-label" data-label={t('km.th.label')}>{k.label}</td>
              <td role="cell" data-label={t('km.th.keyId')}>
                <code>{k.id}</code>
              </td>
              <td role="cell" data-label={t('km.th.scope')}>{k.scope === 'global' ? t('km.scope.global') : k.scope}</td>
              <td role="cell" data-label={t('km.th.created')}>{new Date(k.createdAt).toLocaleDateString()}</td>
              <td role="cell" className="bp-key-actions-cell">
                <div className="bp-key-actions">
                <button className="bp-btn bp-btn-secondary" onClick={() => exportKey(k.id)}>
                  {t('km.export')}
                </button>
                <button className="bp-btn bp-btn-danger" onClick={() => deleteKey(k.id, k.label)}>
                  {t('common.delete')}
                </button>
                </div>
              </td>
            </tr>
          ))}
          {keys.length === 0 ? (
            <tr role="row">
              <td role="cell" colSpan={5} className="bp-hint bp-key-empty">
                {t('km.noKeys')}
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>

      <div className="bp-key-toolbar">
        <button className="bp-btn" onClick={() => void openCreateKeyModal(ctx).then(() => bump())}>
          {t('km.newKey')}
        </button>
        <button
          className="bp-btn bp-btn-secondary"
          onClick={() => openImportKeyModal(ctx, () => bump())}
        >
          {t('km.importKey')}
        </button>
        <button
          className="bp-btn bp-btn-danger"
          style={{ marginLeft: 'auto' }}
          onClick={() => {
            ctx.session.lockAll('manual')
            BdApi.UI.showToast(t('km.allLocked'), { type: 'info' })
            bump()
          }}
        >
          {t('km.lockAllNow')}
        </button>
      </div>

      <h3>{t('km.section.language')}</h3>
      <Row label={t('km.language')} hint={t('km.languageHint')}>
        <SettingsDropdown
          label={t('km.language')}
          value={settings.language}
          options={[
            { value: 'auto', label: t('km.language.auto') },
            { value: 'en', label: 'English' },
            { value: 'tr', label: 'Türkçe' },
            { value: 'ru', label: 'Русский' },
          ]}
          onChange={(language) => {
            patch({ language: language as SettingsData['language'] })
            ctx.forceRerender()
          }}
        />
      </Row>

      <h3>{t('km.section.session')}</h3>
      <Row label={t('km.lockdown')} hint={t('km.lockdownHint')}>
        <input
          type="checkbox"
          checked={settings.lockdown}
          onChange={(e: any) => patch({ lockdown: e.target.checked })}
        />
      </Row>
      {settings.lockdown ? (
        <Row label={t('km.relockScope')} hint={t('km.relockScopeHint')}>
          <SettingsDropdown
            label={t('km.relockScope')}
            value={settings.relockScope}
            options={[
              { value: 'all', label: t('km.relock.all') },
              { value: 'previousChannelOnly', label: t('km.relock.prev') },
            ]}
            onChange={(relockScope) => patch({ relockScope: relockScope as SettingsData['relockScope'] })}
          />
        </Row>
      ) : null}
      <Row label={t('km.timeout')} hint={t('km.timeoutHint')}>
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

      <h3>{t('km.section.appearance')}</h3>
      <Row label={t('km.indicator')} hint={t('km.indicatorHint')}>
        <input
          type="color"
          value={settings.indicatorColor}
          onChange={(e: any) => patch({ indicatorColor: e.target.value })}
        />
      </Row>

      <h3>{t('km.section.media')}</h3>
      <Row label={t('km.maxAuto')} hint={t('km.maxAutoHint')}>
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
      <Row label={t('km.memBudget')} hint={t('km.memBudgetHint')}>
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

      <h3>{t('km.section.advanced')}</h3>
      <Row label={t('km.linkPreviews')}>
        <input
          type="checkbox"
          checked={settings.clientLinkPreviews}
          onChange={(e: any) => patch({ clientLinkPreviews: e.target.checked })}
        />
      </Row>
      <Row label={t('km.master')} hint={t('km.masterHint')}>
        <input type="checkbox" checked={settings.masterPassphraseEnabled} disabled />
      </Row>
    </div>
  )
}

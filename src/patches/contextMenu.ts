/**
 * patches/contextMenu.ts — message + channel/user context menu items (spec §8).
 *
 * Message menu (only when the target is wire-format text or carries a .bpenc
 * attachment): "Copy ciphertext", "Re-decrypt", "Import key for this message…".
 * Channel + user (DM) menus: "Set default BetterPrivacy key" submenu listing
 * keyring entries applicable to that channel plus "None".
 *
 * BdApi.ContextMenu.patch is not a Patcher patch, so every returned unpatch
 * function goes onto ctx.disposers (spec §10 / types.ts ground rules).
 */

import type { KeyEntry, PluginContext } from '../types'
import { parseWire } from '../crypto/wire'
import { t } from '../i18n'

function toast(message: string, type: 'info' | 'success' | 'warning' | 'error'): void {
  try {
    BdApi.UI.showToast(message, { type })
  } catch {
    // Feedback is best-effort.
  }
}

function isWireMessage(message: any): boolean {
  // parseWire keeps this in lockstep with what the render patch treats as ours.
  return typeof message?.content === 'string' && parseWire(message.content) !== null
}

function hasBpencAttachment(message: any): boolean {
  const attachments = message?.attachments
  if (!Array.isArray(attachments)) return false
  return attachments.some(
    (a: any) => typeof a?.filename === 'string' && a.filename.toLowerCase().endsWith('.bpenc'),
  )
}

/**
 * "Import key for this message…" — a minimal blob + passphrase form inside
 * BdApi's confirmation modal. Field values are captured via onChange closures
 * because showConfirmationModal's onConfirm receives no form payload.
 */
function openImportKeyModal(ctx: PluginContext): void {
  const React = BdApi.React
  let blob = ''
  let passphrase = ''

  const content = React.createElement(
    'div',
    { className: 'bp-import-form', style: { display: 'flex', flexDirection: 'column', gap: '8px' } },
    React.createElement('textarea', {
      className: 'bp-import-blob',
      rows: 3,
      placeholder: 'betterprivacy-key:…',
      style: { width: '100%', resize: 'vertical' },
      onChange: (e: any) => {
        blob = String(e?.target?.value ?? '')
      },
    }),
    React.createElement('input', {
      className: 'bp-import-pass',
      type: 'password',
      placeholder: t('cm.passPh'),
      style: { width: '100%' },
      onChange: (e: any) => {
        passphrase = String(e?.target?.value ?? '')
      },
    }),
  )

  try {
    BdApi.UI.showConfirmationModal(t('cm.importTitle'), content, {
      confirmText: t('common.import'),
      cancelText: t('common.cancel'),
      onConfirm: () => {
        // importBlob verifies the passphrase against the KCV and throws a
        // user-readable Error on any failure (types.ts contract).
        ctx.keyring
          .importBlob(blob.trim(), passphrase)
          .then(async (entry: KeyEntry) => {
            // Passphrase just verified — unlock immediately (no double entry).
            try {
              await ctx.session.unlock(entry, passphrase)
            } catch {
              // Unlock can be done later from the key picker.
            }
            toast(t('cm.imported', { label: entry.label }), 'success')
            ctx.forceRerender()
          })
          .catch((err: any) => {
            toast(t('cm.importFailed', { error: err?.message ?? 'unknown error' }), 'error')
          })
      },
    })
  } catch (err) {
    console.error('[BetterPrivacy] import modal failed', err)
    toast(t('cm.importDialogFailed'), 'error')
  }
}

/** Item setups for the message context menu (built via ContextMenu.buildItem). */
function buildMessageItems(ctx: PluginContext, message: any): any[] {
  const wire = isWireMessage(message)
  const items: any[] = []

  if (wire) {
    items.push({
      id: 'bp-copy-ciphertext',
      label: t('cm.copyCipher'),
      action: () => {
        try {
          navigator.clipboard
            .writeText(String(message.content))
            .then(() => toast(t('cm.copied'), 'success'))
            .catch(() => toast(t('cm.copyFailed'), 'error'))
        } catch {
          toast(t('cm.copyFailed'), 'error')
        }
      },
    })
  }

  items.push({
    id: 'bp-redecrypt',
    label: t('cm.redecrypt'),
    action: () => {
      try {
        // DecryptCache purges by keyId, not per-message: purge this message's
        // key when knowable from the wire header; a .bpenc-only message's
        // keyId lives inside the encrypted container, so fall back to a full
        // purge (heavier, still correct — everything re-decrypts from cache
        // misses on the next render).
        const parts = wire ? parseWire(String(message.content)) : null
        ctx.cache.purge(parts ? [parts.keyId] : 'all')
        ctx.forceRerender()
      } catch (err) {
        console.error('[BetterPrivacy] re-decrypt failed', err)
      }
    },
  })

  items.push({
    id: 'bp-import-key',
    label: t('cm.importForMsg'),
    action: () => openImportKeyModal(ctx),
  })

  return items
}

export function applyContextMenuPatches(ctx: PluginContext): void {
  const cm = BdApi?.ContextMenu
  if (!cm || typeof cm.patch !== 'function' || typeof cm.buildItem !== 'function') {
    ctx.modules.failed.push('contextMenu: BdApi.ContextMenu unavailable')
    return
  }

  // ---- Message menu ---------------------------------------------------------
  try {
    const unpatchMessage = cm.patch('message', (tree: any, props: any) => {
      try {
        const message = props?.message
        if (!message) return
        if (!isWireMessage(message) && !hasBpencAttachment(message)) return

        const children = tree?.props?.children
        if (!Array.isArray(children)) return

        children.push(
          cm.buildItem({ type: 'separator' }),
          ...buildMessageItems(ctx, message).map((setup) => cm.buildItem(setup)),
        )
      } catch (err) {
        // A broken menu callback must never break the context menu itself.
        console.error('[BetterPrivacy] message context menu error', err)
      }
    })
    ctx.disposers.push(unpatchMessage)
  } catch (err) {
    console.error('[BetterPrivacy] message context menu patch failed', err)
    ctx.modules.failed.push('contextMenu: message menu')
  }

  // ---- Channel + user (DM) menus: default-key submenu -----------------------
  const defaultKeyCallback = (tree: any, props: any): void => {
    try {
      // channel-context carries props.channel; user-context carries the DM
      // channel when opened from a DM (guild member menus have none — skip).
      const channelId: unknown = props?.channel?.id
      if (typeof channelId !== 'string' || channelId.length === 0) return

      const children = tree?.props?.children
      if (!Array.isArray(children)) return

      let entries: KeyEntry[] = []
      let active: string | null = null
      try {
        entries = ctx.keyring.forChannel(channelId)
        active = ctx.keyring.getActiveSendKey(channelId)
      } catch {
        entries = []
        active = null
      }

      // The menu tree is built once per open with static `checked` flags, so
      // the radio dot can't visibly move after a click. Selection is instead
      // confirmed by closing the menu, toasting, and refreshing the chat-bar
      // key label (which listens for the bp-rerender broadcast).
      const applySelection = (keyId: string | null, label: string): void => {
        try {
          ctx.keyring.setActiveSendKey(channelId, keyId)
          toast(t('cm.defaultSet', { label }), 'success')
          ctx.forceRerender()
        } catch (err) {
          console.error('[BetterPrivacy] set default key failed', err)
          toast(t('cm.defaultSetFailed'), 'error')
        }
        try {
          cm.close?.()
        } catch {
          // Menu stays open — harmless, the toast already confirmed.
        }
      }

      const subItems: any[] = [
        {
          type: 'radio',
          id: 'bp-key-none',
          label: t('cm.none'),
          checked: active === null,
          action: () => applySelection(null, t('cm.none')),
        },
        ...entries.map((e) => ({
          type: 'radio',
          id: `bp-key-${e.id}`,
          label: `${e.label} (${e.id})`,
          checked: active === e.id,
          action: () => applySelection(e.id, `"${e.label}"`),
        })),
      ]

      children.push(
        cm.buildItem({ type: 'separator' }),
        cm.buildItem({
          type: 'submenu',
          id: 'bp-default-key',
          label: t('cm.defaultKey'),
          items: subItems,
        }),
      )
    } catch (err) {
      console.error('[BetterPrivacy] channel context menu error', err)
    }
  }

  for (const navId of ['channel-context', 'user-context']) {
    try {
      ctx.disposers.push(cm.patch(navId, defaultKeyCallback))
    } catch (err) {
      console.error(`[BetterPrivacy] ${navId} menu patch failed`, err)
      ctx.modules.failed.push(`contextMenu: ${navId} menu`)
    }
  }
}

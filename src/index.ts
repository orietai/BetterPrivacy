/**
 * BetterPrivacy — BD plugin entry point.
 *
 * Wires together the crypto/core/patches/ui modules per the MODULE EXPORT
 * CONTRACT in types.ts. Owns plugin lifecycle (start/stop) and the
 * getSettingsPanel hook BetterDiscord calls to render the settings tab.
 */

import { PLUGIN_NAME, type DiscordModules, type PluginContext } from './types'
import { createSettingsStore } from './settings'
import { createKeyring } from './core/keyring'
import { createSession } from './core/session'
import { createDecryptCache } from './core/decryptCache'
import { resolveModules } from './modules'
import { applySendPatch, applyEditPatch } from './patches/send'
import { applyEditComposerPatch } from './patches/editComposer'
import { applyComposerLimitPatch } from './patches/composerLimit'
import { applyRenderPatch } from './patches/render'
import { applyUploadPatch } from './patches/upload'
import { applyAttachmentsPatch } from './patches/attachments'
import { applyChannelSwitchPatch } from './patches/channelSwitch'
import { applyContextMenuPatches } from './patches/contextMenu'
import { applyChatBarPatch } from './ui/ChatBarControls'
import { buildSettingsPanel } from './ui/KeyManagerPanel'
import { injectStyles, removeStyles } from './ui/indicators'
import { initI18n, t } from './i18n'

/** Name of the global DOM event dispatched by ctx.forceRerender(). */
const RERENDER_EVENT = 'bp-rerender'

/**
 * Ordered patch/init steps applied at start(). Each entry's name is used for
 * error reporting if the step throws. injectStyles is included here (not a
 * Patcher patch, but same "apply, catch, report" shape).
 */
const PATCH_STEPS: ReadonlyArray<{ name: string; apply: (ctx: PluginContext) => void }> = [
  { name: 'injectStyles', apply: injectStyles },
  { name: 'applySendPatch', apply: applySendPatch },
  { name: 'applyEditComposerPatch', apply: applyEditComposerPatch },
  // Immediately after the send patch: it reads the send patch's health to
  // decide whether raising the composer limit is safe. Absent from
  // RETRYABLE_PATCHES on purpose — it runs its own quiet retries and never
  // writes to modules.failed.
  { name: 'applyComposerLimitPatch', apply: applyComposerLimitPatch },
  { name: 'applyRenderPatch', apply: applyRenderPatch },
  { name: 'applyUploadPatch', apply: applyUploadPatch },
  { name: 'applyAttachmentsPatch', apply: applyAttachmentsPatch },
  { name: 'applyChannelSwitchPatch', apply: applyChannelSwitchPatch },
  { name: 'applyContextMenuPatches', apply: applyContextMenuPatches },
  { name: 'applyChatBarPatch', apply: applyChatBarPatch },
]

/** Every DiscordModules webpack-lookup field (everything except `failed`). */
const MODULE_FIELDS: ReadonlyArray<Exclude<keyof DiscordModules, 'failed'>> = [
  'MessageActions',
  'MessageStore',
  'SelectedChannelStore',
  'Dispatcher',
  'MessageContent',
  'MarkdownParser',
  'CloudUpload',
  'AttachmentComponent',
  'ChannelTextArea',
]

/**
 * Patch steps that are safe to re-run after a lazy webpack chunk finally
 * loads, keyed by the failure-string prefix the patch itself pushes onto
 * modules.failed. applyAttachmentsPatch is deliberately absent: its DOM
 * fallback (which already carries the feature) would double-start.
 */
const RETRYABLE_PATCHES: ReadonlyArray<{ prefix: string; apply: (ctx: PluginContext) => void }> = [
  { prefix: 'send:', apply: applySendPatch },
  { prefix: 'edit:', apply: applyEditPatch },
  { prefix: 'editComposer:', apply: applyEditComposerPatch },
  { prefix: 'render:', apply: applyRenderPatch },
  { prefix: 'upload:', apply: applyUploadPatch },
  { prefix: 'channelSwitch:', apply: applyChannelSwitchPatch },
  { prefix: 'chatBar', apply: applyChatBarPatch },
]

/**
 * Maps raw modules.failed entries (webpack lookup names and the failure
 * strings patches push) to user-facing feature names, deduped. Used by the
 * degraded-startup toast and the settings panel's Health section.
 */
export function friendlyFailureNames(failed: string[]): string[] {
  const out: string[] = []
  for (const raw of failed) {
    let name: string
    if (raw.includes('send') || raw.includes('edit:') || raw.includes('editComposer:') || raw.includes('MessageActions') || raw.includes('MessageStore')) name = t('feat.sending')
    else if (raw.includes('render') || raw.includes('MessageContent')) name = t('feat.display')
    else if (raw.includes('upload') || raw.includes('CloudUpload')) name = t('feat.upload')
    else if (raw.includes('attachments') || raw.includes('AttachmentComponent')) name = t('feat.fileDisplay')
    else if (raw.includes('chatBar') || raw.includes('ChannelTextArea')) name = t('feat.chatBar')
    else if (raw.includes('channelSwitch') || raw.includes('Dispatcher')) name = t('feat.lockdown')
    else if (raw.includes('MarkdownParser')) name = t('feat.richText')
    else name = raw
    if (!out.includes(name)) out.push(name)
  }
  return out
}

/**
 * Lazy-chunk recovery: resolveModules() runs once at start(), but Discord
 * loads the chat UI in lazy webpack chunks — lookups that miss because a
 * chunk hasn't loaded yet would otherwise stay broken until a manual plugin
 * restart (a plaintext hazard when encrypt mode is persisted ON). Retry the
 * failed lookups at ~15s/45s/120s after start, copy anything newly resolved
 * onto ctx.modules, and re-apply just the patch steps that previously failed.
 */
function scheduleLookupRetries(ctx: PluginContext): void {
  if (ctx.modules.failed.length === 0) return

  // Deltas between attempts — fires at ~15s, 45s and 120s after start.
  const delays = [15_000, 30_000, 75_000]
  let attempt = 0
  let timer: ReturnType<typeof setTimeout> | null = null
  ctx.disposers.push(() => {
    if (timer !== null) clearTimeout(timer)
    timer = null
  })

  const retry = (): void => {
    try {
      const failed = ctx.modules.failed
      if (failed.length === 0) return
      const before = [...failed]

      // Copy any lookup that resolves now onto ctx.modules (patches read the
      // shared ctx.modules object, so recovered fields become visible to all).
      const fresh = resolveModules()
      for (const field of MODULE_FIELDS) {
        if (ctx.modules[field] == null && fresh[field] != null) {
          ctx.modules[field] = fresh[field]
          // Drop the recovered lookup's own failure entry.
          let i: number
          while ((i = failed.indexOf(field)) !== -1) failed.splice(i, 1)
        }
      }

      // Re-run only the patch steps whose earlier application failed. Old
      // failure strings are removed first — a still-failing patch simply
      // pushes a fresh one, so `failed` stays accurate either way.
      for (const { prefix, apply } of RETRYABLE_PATCHES) {
        const stale = failed.filter((f) => f.startsWith(prefix))
        if (stale.length === 0) continue
        for (const f of stale) {
          const i = failed.indexOf(f)
          if (i !== -1) failed.splice(i, 1)
        }
        try {
          apply(ctx)
        } catch (err) {
          console.error(`[${PLUGIN_NAME}] retry of ${prefix} patch failed`, err)
          for (const f of stale) failed.push(f)
        }
      }

      const recovered = before.filter((f) => !failed.includes(f))
      if (recovered.length > 0) {
        BdApi.UI.showToast(
          t('app.recovered', { list: friendlyFailureNames(recovered).join(', ') }),
          { type: 'success' },
        )
        ctx.forceRerender()
      }
    } catch (err) {
      console.error(`[${PLUGIN_NAME}] lookup retry pass failed`, err)
    }
    if (ctx.modules.failed.length > 0 && attempt < delays.length) schedule()
  }

  const schedule = (): void => {
    timer = setTimeout(() => {
      timer = null
      retry()
    }, delays[attempt]!)
    attempt++
  }

  schedule()
}

export default class BetterPrivacy {
  private ctx: PluginContext | null = null

  start(): void {
    const settings = createSettingsStore()
    initI18n(settings)
    const keyring = createKeyring()
    const session = createSession(keyring, settings)
    const cache = createDecryptCache(settings)
    const modules = resolveModules()

    // Thin wrapper around BdApi.Patcher that always registers under
    // PLUGIN_NAME regardless of the caller argument a call site passes —
    // this guarantees stop()'s Patcher.unpatchAll(PLUGIN_NAME) removes every
    // patch this plugin installs even if a patch module is sloppy about the
    // caller string it supplies.
    const patcher: BdPatcher = {
      before: (_caller, mod, method, cb) => BdApi.Patcher.before(PLUGIN_NAME, mod, method, cb),
      after: (_caller, mod, method, cb) => BdApi.Patcher.after(PLUGIN_NAME, mod, method, cb),
      instead: (_caller, mod, method, cb) => BdApi.Patcher.instead(PLUGIN_NAME, mod, method, cb),
      unpatchAll: (_caller) => BdApi.Patcher.unpatchAll(PLUGIN_NAME),
    }

    const ctx: PluginContext = {
      keyring,
      session,
      cache,
      settings,
      modules,
      patcher,
      disposers: [],
      // v1 forceRerender: broadcast a window CustomEvent that render-layer
      // components (message content / attachment patches) subscribe to and
      // respond to by forcing their own local re-render (e.g. via a
      // useState/useReducer bump in a wrapping component, or by calling
      // BdApi's forceUpdate on the patched instance). LIMITATION: this is a
      // best-effort broadcast, not a guaranteed re-render of every mounted
      // message — components that never registered a listener simply won't
      // refresh until they re-render for some other reason (scroll,
      // props change, etc). A more thorough v2 could hook Discord's Flux
      // stores directly to force a real re-render of the message list.
      forceRerender: () => {
        window.dispatchEvent(new CustomEvent(RERENDER_EVENT))
      },
    }
    this.ctx = ctx

    for (const step of PATCH_STEPS) {
      try {
        step.apply(ctx)
      } catch (err) {
        console.error(`[${PLUGIN_NAME}] ${step.name} failed to apply`, err)
        modules.failed.push(step.name)
      }
    }

    session.onRelock((keyIds) => {
      cache.purge(keyIds)
      ctx.forceRerender()
    })

    session.start()

    if (modules.failed.length > 0) {
      BdApi.UI.showToast(
        t('app.degraded', { list: friendlyFailureNames(modules.failed).join(', ') }),
        { type: 'warning' },
      )
      scheduleLookupRetries(ctx)
    }

    const onKeydown = (e: KeyboardEvent): void => {
      if (e.ctrlKey && e.shiftKey && (e.key === 'L' || e.key === 'l')) {
        session.lockAll('manual')
      }
    }
    window.addEventListener('keydown', onKeydown)
    ctx.disposers.push(() => window.removeEventListener('keydown', onKeydown))
  }

  stop(): void {
    BdApi.Patcher.unpatchAll(PLUGIN_NAME)

    if (this.ctx) {
      for (const dispose of this.ctx.disposers) {
        try {
          dispose()
        } catch (err) {
          console.error(`[${PLUGIN_NAME}] disposer failed`, err)
        }
      }
      this.ctx.session.stop()
      this.ctx.cache.purge('all')
    }

    removeStyles()
    this.ctx = null
  }

  getSettingsPanel(): unknown {
    if (!this.ctx) return null
    return buildSettingsPanel(this.ctx)
  }
}

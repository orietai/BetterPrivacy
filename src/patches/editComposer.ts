import type { PluginContext } from '../types'
import { parseWire } from '../crypto/wire'
import { t } from '../i18n'
import { openEditMessageModal } from '../ui/EditMessageModal'

const installs = new WeakMap<PluginContext, { stopped: boolean; targets: WeakMap<object, Set<string>> }>()

function blocked(): void {
  try { BdApi.UI.showToast(t('edit.unsafe'), { type: 'warning' }) } catch { /* best effort */ }
}

/** Confirmed native signatures:
 * startEditMessage(channelId, messageId, content, source)
 * startEditMessageRecord(channelId, messageRecord, source).
 * The dispatcher guard also covers callers bypassing both action methods. */
export function applyEditComposerPatch(ctx: PluginContext): void {
  let state = installs.get(ctx)
  if (!state) {
    state = { stopped: false, targets: new WeakMap() }
    installs.set(ctx, state)
    const owned = state
    ctx.disposers.push(() => { owned.stopped = true })
  }
  if (state.stopped) return
  const owned = state
  let installed = false
  const install = (target: any, method: string, ids: (args: any[]) => [unknown, unknown], isEdit?: (args: any[]) => boolean): void => {
    if (!target || typeof target[method] !== 'function') return
    if (owned.targets.get(target)?.has(method)) { installed = true; return }
    try {
      const undo = ctx.patcher.instead('editComposer', target, method, (thisObj: any, args: any[], original: (...a: any[]) => any) => {
        if (isEdit && !isEdit(args)) return Reflect.apply(original, thisObj, args)
        if (owned.stopped) { blocked(); return undefined }
        try {
          const [channelId, messageId] = ids(args)
          if (typeof channelId !== 'string' || !channelId || typeof messageId !== 'string' || !messageId) { blocked(); return undefined }
          const content = ctx.modules.MessageStore?.getMessage?.(channelId, messageId)?.content
          if (typeof content !== 'string') { blocked(); return undefined }
          if (parseWire(content)) {
            void openEditMessageModal(ctx, channelId, messageId)
            return undefined
          }
          if (/https:\/\/betterprivacy\.app\/m\/?#|^🦇</.test(content)) { blocked(); return undefined }
          return Reflect.apply(original, thisObj, args)
        } catch { blocked(); return undefined }
      })
      let methods = owned.targets.get(target)
      if (!methods) { methods = new Set(); owned.targets.set(target, methods) }
      methods.add(method)
      installed = true
      ctx.disposers.push(() => { if (typeof undo === 'function') undo(); methods!.delete(method) })
    } catch { /* Try the other independently available entry points. */ }
  }
  const actions = ctx.modules.MessageActions
  install(actions, 'startEditMessage', args => [args[0], args[1]])
  install(actions, 'startEditMessageRecord', args => [args[0], args[1]?.id])
  install(ctx.modules.Dispatcher, 'dispatch', args => [args[0]?.channelId ?? args[0]?.channel_id, args[0]?.messageId ?? args[0]?.message_id],
    args => args[0]?.type === 'MESSAGE_START_EDIT')
  if (!installed && !ctx.modules.failed.includes('editComposer: edit entry hooks unavailable')) {
    ctx.modules.failed.push('editComposer: edit entry hooks unavailable')
  }
}

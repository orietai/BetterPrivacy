/**
 * patches/channelSwitch.ts
 *
 * Subscribes to Discord's Flux Dispatcher for channel/thread focus changes.
 * When lockdown mode is ON, forwards the transition to `session.handleChannelSwitch`,
 * which is responsible for purging unlocked keys/cache and triggering re-render
 * (via its `onRelock` listeners, wired up elsewhere). This module only tracks
 * the previously-focused channel id and gates the call on the live settings value.
 *
 * Per spec §10: no Patcher usage here, so cleanup goes on ctx.disposers rather
 * than relying on Patcher.unpatchAll.
 */

import type { PluginContext } from '../types'

const CHANNEL_SELECT = 'CHANNEL_SELECT'
const THREAD_SELECT = 'THREAD_SELECT'

export function applyChannelSwitchPatch(ctx: PluginContext): void {
  const { modules, settings, session } = ctx
  const dispatcher = modules.Dispatcher

  if (!dispatcher || typeof dispatcher.subscribe !== 'function' || typeof dispatcher.unsubscribe !== 'function') {
    modules.failed.push('channelSwitch: Dispatcher unavailable')
    return
  }

  // Seed with whatever channel is currently focused (if resolvable) so the
  // very first CHANNEL_SELECT after plugin start still yields a correct
  // prev -> next transition instead of `null -> next`.
  let prevChannelId: string | null = null
  try {
    const selected = modules.SelectedChannelStore?.getChannelId?.()
    if (typeof selected === 'string' && selected.length > 0) {
      prevChannelId = selected
    }
  } catch {
    // SelectedChannelStore shape changed / unavailable — non-fatal, just start from null.
  }

  const handleSelect = (payload: any): void => {
    const nextChannelId: string | undefined = payload?.channelId
    if (typeof nextChannelId !== 'string' || nextChannelId.length === 0) return
    if (nextChannelId === prevChannelId) return

    const prev = prevChannelId
    prevChannelId = nextChannelId

    if (settings.get().lockdown) {
      session.handleChannelSwitch(prev, nextChannelId)
    }
  }

  // Track both channel and thread focus events.
  dispatcher.subscribe(CHANNEL_SELECT, handleSelect)
  dispatcher.subscribe(THREAD_SELECT, handleSelect)

  ctx.disposers.push(() => {
    dispatcher.unsubscribe(CHANNEL_SELECT, handleSelect)
    dispatcher.unsubscribe(THREAD_SELECT, handleSelect)
  })
}

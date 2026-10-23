import type { KeyEntry, Keyring, PluginContext } from '../types'

/** One policy shared by the composer, text sender and attachment sender.
 * Never guess between several keys or select the most recently unlocked key.
 */
export function resolveSendKey(keyring: Keyring, channelId: string): KeyEntry | undefined {
  const entries = keyring.forChannel(channelId)
  const active = keyring.getActiveSendKey(channelId)
  if (active) return entries.find(entry => entry.id === active)
  return entries.length === 1 ? entries[0] : undefined
}

const pending = new WeakMap<PluginContext, Map<string, object>>()

/** Explicit user choice only. Cancellation and stale unlocks leave selection
 * unchanged; other keys remain unlocked for reading historical messages.
 */
export async function selectSendKey(
  ctx: PluginContext, channelId: string, keyId: string,
  unlock: (entry: KeyEntry) => Promise<boolean>,
): Promise<boolean> {
  let channels = pending.get(ctx)
  if (!channels) { channels = new Map(); pending.set(ctx, channels) }
  const token = {}
  channels.set(channelId, token)
  const revision = ctx.session.revision
  const previous = ctx.keyring.getActiveSendKey(channelId)
  const previousMode = ctx.keyring.isEncryptModeOn(channelId)
  const broken = () => ctx.modules.failed.some(f => /send|MessageActions|upload|CloudUpload/i.test(f))
  try {
    if (broken()) return false
    const entry = ctx.keyring.forChannel(channelId).find(item => item.id === keyId)
    if (!entry) return false
    if (!ctx.session.isUnlocked(keyId) && !(await unlock(entry))) return false
    if (channels.get(channelId) !== token || ctx.session.revision !== revision || broken()) return false
    if (ctx.keyring.getActiveSendKey(channelId) !== previous || ctx.keyring.isEncryptModeOn(channelId) !== previousMode) return false
    if (!ctx.keyring.forChannel(channelId).some(item => item.id === keyId) || !ctx.session.isUnlocked(keyId)) return false
    ctx.keyring.setActiveSendKey(channelId, keyId)
    ctx.keyring.setEncryptMode(channelId, true)
    ctx.forceRerender()
    return true
  } finally {
    if (channels.get(channelId) === token) channels.delete(channelId)
  }
}

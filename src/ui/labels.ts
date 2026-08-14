/**
 * Channel-bound key labels — the v1 "one phrase per channel" convention.
 *
 * The simplified flow creates keys whose label is derived from the channel id
 * (`channel:<id>`). Because the KDF salt derives from the label
 * (kdf.deriveSaltFromLabel), two peers who enter the SAME phrase in the SAME
 * channel derive the identical key with zero coordination — no user-visible
 * label concept needed. Custom-labeled keys (Key Manager / import / `/enc`)
 * remain fully supported alongside.
 */

export const CHANNEL_LABEL_PREFIX = 'channel:'

export function channelKeyLabel(channelId: string): string {
  return CHANNEL_LABEL_PREFIX + channelId
}

export function isChannelKeyLabel(label: string): boolean {
  return label.startsWith(CHANNEL_LABEL_PREFIX)
}

/** Human wording for UI surfaces: hides the synthetic channel-label internals. */
export function friendlyKeyLabel(entry: { label: string }): string {
  return isChannelKeyLabel(entry.label) ? "this channel's key" : `"${entry.label}"`
}

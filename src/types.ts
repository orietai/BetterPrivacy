/**
 * BetterPrivacy — shared contracts.
 *
 * Every module group codes EXACTLY against these types and the export
 * contract below. Do not change a signature without updating every
 * dependent; workers other than the integration agent must not edit
 * this file.
 *
 * ============================================================================
 * MODULE EXPORT CONTRACT (exact export names; src/index.ts imports these)
 * ============================================================================
 *  crypto/kdf.ts     : generateSalt(): string                                  // 16 random bytes, b64url
 *                      deriveKeyMaterial(passphrase: string, saltB64: string): Promise<DerivedKeyMaterial>
 *                      // PBKDF2-HMAC-SHA256, 600_000 iterations -> 256-bit AES-GCM key.
 *                      // Derive bits first, compute keyId (first 6 bytes of SHA-256(raw bits),
 *                      // b64url => 8 chars) and kcv from the bits, then importKey as
 *                      // NON-extractable and drop/overwrite the raw bits.
 *                      // kcv: AES-GCM-encrypt the fixed constant "BPKCV" with IV of 12 zero
 *                      // bytes, take first 4 bytes of ciphertext, b64url. Only used to detect
 *                      // wrong passphrases at unlock time.
 *  crypto/cipher.ts  : encryptText(key: CryptoKey, plaintext: string): Promise<{ iv: string; ct: string }>  // b64url, 12-byte random IV
 *                      decryptText(key: CryptoKey, ivB64: string, ctB64: string): Promise<string>           // throws on GCM auth failure
 *  crypto/wire.ts    : WIRE_REGEX: RegExp        // 🦇<https://betterprivacy.app/m#v1.keyId.salt.iv.ct> — sole format
 *                      MAX_PLAINTEXT_CHARS: number  // ~1400, chosen so the wire message fits 2000 chars
 *                      encodeWire(p: WireParts): string
 *                      parseWire(content: string): WireParts | null   // silently null on malformed
 *  crypto/bpenc.ts   : encryptFileToBpenc(key: CryptoKey, keyId: string, data: Uint8Array, filename: string, mime: string): Promise<Uint8Array>
 *                      peekBpencKeyId(bytes: Uint8Array): string | null   // reads magic + keyId field only
 *                      decryptBpenc(key: CryptoKey, bytes: Uint8Array): Promise<{ header: BpencHeader; data: Uint8Array }>
 *                      // Format per spec §5. NOTE: the 8-byte keyId field stores the 8 ASCII
 *                      // chars of the b64url keyId string. Header IV = bytes 14–25; each data
 *                      // chunk (8 MB) uses IV = header IV + 1 + chunkIndex (big-endian counter
 *                      // increment on the last 4 bytes). header JSON: BpencHeader (incl. chunks).
 *  core/keyring.ts   : createKeyring(): Keyring
 *  core/session.ts   : createSession(keyring: Keyring, settings: SettingsStore): Session
 *  core/decryptCache.ts : createDecryptCache(settings: SettingsStore): DecryptCache
 *  settings.ts       : createSettingsStore(): SettingsStore ; DEFAULT_SETTINGS: SettingsData
 *  modules.ts        : resolveModules(): DiscordModules
 *  patches/send.ts   : applySendPatch(ctx: PluginContext): void
 *  patches/render.ts : applyRenderPatch(ctx: PluginContext): void
 *  patches/upload.ts : applyUploadPatch(ctx: PluginContext): void
 *  patches/attachments.ts : applyAttachmentsPatch(ctx: PluginContext): void
 *  patches/channelSwitch.ts : applyChannelSwitchPatch(ctx: PluginContext): void
 *  patches/contextMenu.ts   : applyContextMenuPatches(ctx: PluginContext): void
 *  ui/ChatBarControls.tsx : applyChatBarPatch(ctx: PluginContext): void
 *  ui/UnlockModal.tsx     : openUnlockModal(ctx: PluginContext, entry: KeyEntry): Promise<boolean>  // resolves true if unlocked
 *  ui/KeyManagerPanel.tsx : buildSettingsPanel(ctx: PluginContext): any   // returned from getSettingsPanel
 *  ui/indicators.ts       : injectStyles(ctx: PluginContext): void ; removeStyles(): void
 * ============================================================================
 *
 * Global ground rules: TS strict; no network calls; no eval; plaintext and
 * derived keys never touch BdApi.Data, localStorage, or the Flux store; all
 * BdApi.Patcher calls use PLUGIN_NAME as caller so stop() can unpatchAll;
 * non-Patcher cleanup (Flux subscriptions, ContextMenu.patch, timers) is
 * pushed onto ctx.disposers.
 */

export const PLUGIN_NAME = 'BetterPrivacy'

/** 'global' | a channel id | a user id (DM peer) */
export type Scope = 'global' | string

export interface KeyEntry {
  /** First 6 bytes of SHA-256(raw derived key), base64url => 8 chars. Public fingerprint. */
  id: string
  label: string
  /** 16-byte KDF salt, b64url. */
  salt: string
  /** 4-byte key check value, b64url — detects wrong passphrase at unlock. */
  check: string
  scope: Scope
  createdAt: number
}

export interface DerivedKeyMaterial {
  key: CryptoKey // AES-256-GCM, non-extractable
  keyId: string
  kcv: string
}

export interface WireParts {
  keyId: string
  /**
   * 16-byte KDF salt, b64url => 22 chars. Rides in the wire so the decrypt
   * page at betterprivacy.app/m can re-derive the key from the phrase alone.
   */
  salt: string
  iv: string // b64url, 12 bytes => 16 chars
  ciphertext: string // b64url
}

export interface BpencHeader {
  filename: string
  mime: string
  size: number
  sha256: string // hex of plaintext file bytes
  chunks: number // number of 8 MB data chunks
}

// ---------------------------------------------------------------------------

export interface Keyring {
  list(): KeyEntry[]
  get(id: string): KeyEntry | undefined
  /** Entries whose scope is 'global' or matches the channel (or DM peer) id. */
  forChannel(channelId: string): KeyEntry[]
  create(label: string, passphrase: string, scope: Scope): Promise<KeyEntry>
  /** Parses `betterprivacy-key:<b64(json{label,salt,check})>`; verifies passphrase against KCV; throws Error with user-readable message on failure. */
  importBlob(blob: string, passphrase: string, scope?: Scope): Promise<KeyEntry>
  exportBlob(id: string): string
  remove(id: string): void
  /** Per-channel remembered send key + encrypt-mode toggle (persisted via BdApi.Data). */
  getActiveSendKey(channelId: string): string | null
  setActiveSendKey(channelId: string, keyId: string | null): void
  isEncryptModeOn(channelId: string): boolean
  setEncryptMode(channelId: string, on: boolean): void
}

export type RelockReason = 'manual' | 'lockdown' | 'timeout' | 'stop'

export interface Session {
  /** Derives from passphrase, verifies KCV; on success holds the CryptoKey in memory. */
  unlock(entry: KeyEntry, passphrase: string): Promise<boolean>
  /** Returns the unlocked CryptoKey or null; touches lastUsedAt on hit. */
  getKey(keyId: string): CryptoKey | null
  isUnlocked(keyId: string): boolean
  lockKey(keyId: string): void
  lockAll(reason: RelockReason): void
  /** Called by the channel-switch patch when lockdown mode is ON. */
  handleChannelSwitch(prevChannelId: string | null, nextChannelId: string): void
  /** Starts the 60s timeout sweep timer. */
  start(): void
  /** Stops timers and purges all keys. */
  stop(): void
  /** Fired after any relock; listeners purge caches and force re-render. */
  onRelock(cb: (keyIds: string[] | 'all', reason: RelockReason) => void): void
}

export type CacheEntry =
  | { kind: 'text'; text: string; keyId: string }
  | { kind: 'media'; blobUrl: string; header: BpencHeader; keyId: string; byteSize: number }
  | { kind: 'failed'; keyId: string } // GCM auth failure — render warning, don't retry

export interface DecryptCache {
  /** Canonical cache key: `${messageId}:${editTimestamp ?? '0'}` (or attachment id). */
  key(messageId: string, editTs?: string | number | null): string
  get(k: string): CacheEntry | undefined
  set(k: string, e: CacheEntry): void
  /** Removes entries (revoking media blob URLs) for the given keys, or all. Media entries LRU-evict beyond settings.memoryBudgetMB. */
  purge(keyIds: string[] | 'all'): void
}

export interface SettingsData {
  lockdown: boolean
  relockScope: 'all' | 'previousChannelOnly'
  /** Seconds; 0 = never. Default 10800 (3 h), range 300–86400. */
  decryptTimeoutSec: number
  masterPassphraseEnabled: boolean
  indicatorColor: string // default '#3ba55d'
  maxAutoDownloadBytes: number // default 25 * 1024 * 1024
  memoryBudgetMB: number // default 200
  clientLinkPreviews: boolean // default false
}

export interface SettingsStore {
  get(): SettingsData
  set(patch: Partial<SettingsData>): void
  onChange(cb: (s: SettingsData) => void): void
}

/** All Discord-internal webpack lookups live in modules.ts; every field nullable and prop-based (never mangled names). */
export interface DiscordModules {
  MessageActions: any | null // .sendMessage(channelId, message, ...)
  MessageStore: any | null
  SelectedChannelStore: any | null
  Dispatcher: any | null // .subscribe / .unsubscribe
  MessageContent: any | null // message content render component (Patcher.after target)
  MarkdownParser: any | null // Discord markdown module: .parse / .parseTopic
  CloudUpload: any | null
  AttachmentComponent: any | null
  ChannelTextArea: any | null // chat bar component for ChatBarControls injection
  /** Human-readable names of lookups that failed — startup self-test toasts these and degrades gracefully. */
  failed: string[]
}

export interface PluginContext {
  keyring: Keyring
  session: Session
  cache: DecryptCache
  settings: SettingsStore
  modules: DiscordModules
  /** BdApi.Patcher — always called with PLUGIN_NAME as caller. */
  patcher: BdPatcher
  /** Cleanup callbacks run on stop() (Flux unsubscribes, ContextMenu unpatch, timers, style removal). */
  disposers: Array<() => void>
  /** Force the visible message list to re-render (after unlock/relock). */
  forceRerender(): void
}

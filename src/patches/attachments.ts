/**
 * patches/attachments.ts — incoming .bpenc attachment render patch (spec §6,
 * "Encrypted attachments — receive").
 *
 * Patcher.after on the attachment component render. modules.ts normalizes the
 * fragile source-marker lookup to `{ module, method }` so the patch target
 * here is stable; a missed lookup degrades to modules.failed.
 *
 * For attachments named *.bpenc, the rendered node is swapped for a wrapper
 * component with the following state machine:
 *   auto path (size <= settings.maxAutoDownloadBytes): fetch CDN bytes →
 *   peekBpencKeyId → keyring lookup → decryptBpenc → inline <img>/<video>/
 *   <audio> from a blob URL, or a "Save decrypted file" button for other mimes.
 *   Oversize → manual "Download & decrypt" button. Unknown key / locked key /
 *   GCM failure → chips mirroring render.ts.
 *
 * NOTE on fetch: attachment.url is Discord's own CDN — a request the vanilla
 * client performs anyway to display the attachment. It is NOT an external or
 * third-party call and is the plugin's only permitted network access.
 *
 * Decrypted blob URLs live in ctx.cache as kind:'media' entries, so lockdown/
 * timeout purges revoke them exactly like text plaintext (spec §6/§7, F3).
 */

import type { KeyEntry, PluginContext } from '../types'
import { resolveCurrentChannelId } from '../modules'
import { decryptBpenc, peekBpencKeyId } from '../crypto/bpenc'
import { openUnlockModal } from '../ui/UnlockModal'

/** Keep in sync with RERENDER_EVENT in index.ts (not exported from there). */
const RERENDER_EVENT = 'bp-rerender'

type Phase = 'idle' | 'fetching' | 'unknown' | 'locked' | 'fetchFailed' | 'done'

/**
 * The channel an attachment truly belongs to, recovered from its CDN URL
 * (/attachments/<channelId>/<attachmentId>/<name>). The FOCUSED channel is
 * wrong for pinned/search-result attachments, which render outside the chat
 * they live in — gating (and the click-to-enable flip) on it would read/write
 * the wrong channel's encrypt mode. Null when the URL doesn't match.
 */
function channelIdFromAttachmentUrl(url: unknown): string | null {
  if (typeof url !== 'string') return null
  const match = /\/attachments\/(\d+)\/\d+\//.exec(url)
  return match ? match[1]! : null
}

interface EncryptedAttachmentProps {
  ctx: PluginContext
  attachment: any
}

function chip(className: string, text: string, onClick?: () => void): any {
  const props: any = { className: `bp-chip ${className}`.trim() }
  if (onClick) {
    props.role = 'button'
    props.tabIndex = 0
    props.onClick = onClick
  }
  return BdApi.React.createElement('span', props, text)
}

function EncryptedAttachment(props: EncryptedAttachmentProps): any {
  const React = BdApi.React
  const { ctx, attachment } = props

  const [, bump] = React.useReducer((n: number) => n + 1, 0)

  // Refs (not state) so async transitions from event handlers/effects can't
  // race React batching; every mutation is followed by a bump().
  const phaseRef = React.useRef('idle' as Phase)
  const keyIdRef = React.useRef(null as string | null)
  // Fetched ciphertext kept only while waiting for an unlock, so unlocking
  // decrypts without a second CDN round-trip; dropped once decrypted.
  const bytesRef = React.useRef(null as Uint8Array | null)

  const cacheKey = ctx.cache.key(`att:${String(attachment?.id ?? '')}`)

  let cached
  let maxAutoDownloadBytes = 0
  try {
    cached = ctx.cache.get(cacheKey)
    maxAutoDownloadBytes = ctx.settings.get().maxAutoDownloadBytes
  } catch {
    cached = undefined
  }

  const size: number = typeof attachment?.size === 'number' ? attachment.size : 0
  const oversize = size > maxAutoDownloadBytes

  // Per-channel display gate, mirroring render.ts: encrypt mode off → locked
  // chip, no fetch/decrypt work. Attachment props don't carry a channel id, so
  // recover it from the CDN URL (correct even for pinned/search results); the
  // focused channel is only the last-resort fallback.
  let gateChannel: string | null = null
  let modeOn = true
  try {
    gateChannel =
      channelIdFromAttachmentUrl(attachment?.url ?? attachment?.proxy_url) ??
      resolveCurrentChannelId(ctx.modules)
    if (gateChannel) modeOn = ctx.keyring.isEncryptModeOn(gateChannel)
  } catch {
    modeOn = true
  }

  const setPhase = (p: Phase): void => {
    phaseRef.current = p
    bump()
  }

  /** Peek keyId from fetched bytes, then decrypt if the key is available. */
  const attemptDecrypt = async (): Promise<void> => {
    const bytes = bytesRef.current
    if (!bytes) return
    try {
      const keyId = peekBpencKeyId(bytes)
      if (!keyId) {
        // Not actually a BPENC1 container (or truncated) — treat as failure.
        ctx.cache.set(cacheKey, { kind: 'failed', keyId: '' })
        bytesRef.current = null
        setPhase('done')
        return
      }
      keyIdRef.current = keyId

      const entry = ctx.keyring.get(keyId)
      if (!entry) {
        setPhase('unknown')
        return
      }
      const key = ctx.session.getKey(keyId) // touches lastUsedAt on hit
      if (!key) {
        setPhase('locked')
        return
      }

      const { header, data } = await decryptBpenc(key, bytes)
      const blob = new Blob([data as unknown as BlobPart], {
        type: header.mime || 'application/octet-stream',
      })
      const blobUrl = URL.createObjectURL(blob)
      // Cache owns the blob URL from here: purge() revokes it (F3), LRU keeps
      // total media under settings.memoryBudgetMB.
      ctx.cache.set(cacheKey, { kind: 'media', blobUrl, header, keyId, byteSize: data.byteLength })
      bytesRef.current = null
      setPhase('done')
    } catch (err) {
      // GCM auth failure (tampered/wrong key) or header parse failure.
      console.error('[BetterPrivacy] attachment decrypt failed', err)
      try {
        ctx.cache.set(cacheKey, { kind: 'failed', keyId: keyIdRef.current ?? '' })
      } catch {
        // Cache write failed — the failure chip is recomputed next render.
      }
      bytesRef.current = null
      setPhase('done')
    }
  }

  /** Full pipeline: CDN fetch → attemptDecrypt. Used by both auto and manual paths. */
  const fetchAndDecrypt = async (): Promise<void> => {
    if (phaseRef.current === 'fetching') return
    setPhase('fetching')
    try {
      const url: unknown = attachment?.url ?? attachment?.proxy_url
      if (typeof url !== 'string' || url.length === 0) throw new Error('attachment has no url')
      // cdn.discordapp.com sends no CORS headers, so a renderer fetch() is
      // blocked by the browser. BdApi.Net.fetch runs in the main process and
      // is exempt; plain fetch stays as a fallback for old BD versions.
      const res = BdApi.Net?.fetch ? await BdApi.Net.fetch(url) : await fetch(url)
      if (!res.ok) throw new Error(`CDN fetch failed: HTTP ${res.status}`)
      bytesRef.current = new Uint8Array(await res.arrayBuffer())
      await attemptDecrypt()
    } catch (err) {
      console.error('[BetterPrivacy] attachment fetch failed', err)
      setPhase('fetchFailed')
    }
  }

  // Global relock/unlock broadcast: after a relock the cache entry (and its
  // blob URL) is already purged — reset to idle so the auto path re-runs and
  // lands back on a locked chip. After an unlock, a 'locked' chip that still
  // holds bytes retries decryption immediately.
  React.useEffect(() => {
    const handler = (): void => {
      try {
        if (!ctx.cache.get(cacheKey)) {
          if (phaseRef.current === 'done') {
            phaseRef.current = 'idle'
            keyIdRef.current = null
          } else if (phaseRef.current === 'locked' && bytesRef.current) {
            void attemptDecrypt()
          }
        }
      } catch {
        // Cache read failed — just re-render.
      }
      bump()
    }
    window.addEventListener(RERENDER_EVENT, handler)
    return () => window.removeEventListener(RERENDER_EVENT, handler)
  }, [cacheKey])

  // Auto path: runs after every render but only fires from 'idle' with no
  // cache hit and an under-cap size (oversize is strictly manual).
  React.useEffect(() => {
    if (!modeOn || cached !== undefined || oversize || phaseRef.current !== 'idle') return
    void fetchAndDecrypt()
  })

  // ---- Render ---------------------------------------------------------------

  // 'done' with no cache entry means the LRU evicted the decrypted media —
  // reset to idle so the auto effect below refetches instead of dead-ending
  // on the bare "Encrypted file" chip.
  if (phaseRef.current === 'done' && cached === undefined) {
    phaseRef.current = 'idle'
    keyIdRef.current = null
  }

  if (!modeOn) {
    return chip(
      'bp-chip-locked',
      '🔒 Encrypted file — encryption off for this channel (click to enable)',
      () => {
        try {
          if (gateChannel) {
            ctx.keyring.setEncryptMode(gateChannel, true)
            ctx.forceRerender()
          }
        } catch {
          // keyring write failed — chip stays, user can retry
        }
      },
    )
  }

  if (cached?.kind === 'media') {
    const header = cached.header
    const mime = header?.mime ?? ''
    const label = ((): string => {
      try {
        return ctx.keyring.get(cached.keyId)?.label ?? cached.keyId
      } catch {
        return cached.keyId
      }
    })()
    const title = `Decrypted: ${header?.filename ?? 'file'} (key: ${label})`

    let media: any
    if (mime.startsWith('image/')) {
      media = React.createElement('img', {
        className: 'bp-decrypted-media',
        src: cached.blobUrl,
        alt: header?.filename ?? 'decrypted image',
      })
    } else if (mime.startsWith('video/')) {
      media = React.createElement('video', {
        className: 'bp-decrypted-media',
        controls: true,
        src: cached.blobUrl,
      })
    } else if (mime.startsWith('audio/')) {
      media = React.createElement('audio', {
        className: 'bp-decrypted-media',
        controls: true,
        src: cached.blobUrl,
      })
    } else {
      media = React.createElement(
        'button',
        {
          className: 'bp-chip bp-save-button',
          onClick: () => {
            try {
              const a = document.createElement('a')
              a.href = cached.blobUrl
              a.download = header?.filename || 'decrypted.bin'
              document.body.appendChild(a)
              a.click()
              a.remove()
            } catch (err) {
              console.error('[BetterPrivacy] save failed', err)
            }
          },
        },
        `Save decrypted file (${header?.filename ?? 'file'})`,
      )
    }
    return React.createElement('div', { className: 'bp-decrypted-attachment', title }, media)
  }

  if (cached?.kind === 'failed') {
    return chip('bp-failed', '⚠ Decryption failed (tampered or wrong key)')
  }

  const keyId = keyIdRef.current
  let entry: KeyEntry | undefined
  try {
    entry = keyId ? ctx.keyring.get(keyId) : undefined
  } catch {
    entry = undefined
  }

  switch (phaseRef.current) {
    case 'fetching':
      return chip('', '🔒 Encrypted file — decrypting…')
    case 'unknown':
      return chip('bp-chip-unknown', `🔒 Encrypted file (unknown key ${keyId ?? '?'})`)
    case 'locked':
      return chip(
        'bp-chip-locked',
        `🔒 Encrypted file (key: ${entry?.label ?? keyId ?? '?'}) — click to unlock`,
        () => {
          if (!entry) return
          openUnlockModal(ctx, entry)
            .then((ok: boolean) => {
              if (ok) void attemptDecrypt()
            })
            .catch(() => {
              // Modal failed — chip stays clickable.
            })
        },
      )
    case 'fetchFailed':
      return chip('bp-chip-error', '🔒 Encrypted file — download failed (click to retry)', () => {
        void fetchAndDecrypt()
      })
    default: {
      if (oversize) {
        const mb = (size / (1024 * 1024)).toFixed(1)
        return chip('bp-chip-oversize', `🔒 Encrypted file (${mb} MB) — Download & decrypt`, () => {
          void fetchAndDecrypt()
        })
      }
      // Belt-and-braces: this chip should be transient (the auto effect picks
      // idle up), but if it ever sticks, a click resets and re-kicks it.
      return chip('', '🔒 Encrypted file', () => {
        phaseRef.current = 'idle'
        keyIdRef.current = null
        bump()
      })
    }
  }
}

// ---------------------------------------------------------------------------
// DOM fallback — the version-proof path.
//
// Verified live (2026-07 build): file attachments render through the media
// mosaic system and NO component in the tree receives an `attachment` prop
// (the card gets {url, fileName, …}), so a webpack render patch keyed on
// props.attachment never fires. Instead of chasing that minified component,
// watch the DOM for rendered file cards whose filename link ends in .bpenc
// (anchor inside [class*="fileNameLink"] / [class*="filenameLinkWrapper"]),
// hide the card and mount EncryptedAttachment beside it, with url/filename/id
// recovered from the link itself. Coexists with the webpack patch: on builds
// where that patch works, no .bpenc filename link ever reaches the DOM.
// ---------------------------------------------------------------------------

/** Best-effort "24.89 KB" → bytes; 0 (= no auto-download cap check) when unparsable. */
function parseSizeText(text: string | null | undefined): number {
  if (!text) return 0
  const m = /([\d.]+)\s*(B|KB|MB|GB)/i.exec(text)
  if (!m) return 0
  const mult: Record<string, number> = { b: 1, kb: 1024, mb: 1024 ** 2, gb: 1024 ** 3 }
  return Math.round(parseFloat(m[1]!) * (mult[m[2]!.toLowerCase()] ?? 1))
}

function startAttachmentDomFallback(ctx: PluginContext): void {
  const mounts: Array<{ host: HTMLElement; card: HTMLElement; root: any }> = []

  /** Undo the hide+mark applied in processAnchor so a card survives stop()/pruning. */
  const restoreCard = (card: HTMLElement): void => {
    card.style.display = ''
    delete card.dataset['bpHandled']
  }

  const cleanupDisconnected = (): void => {
    for (let i = mounts.length - 1; i >= 0; i--) {
      const m = mounts[i]!
      if (!m.host.isConnected) {
        try {
          m.root.unmount()
        } catch {
          // root already gone
        }
        // Host pruned by DOM churn while the original card survived — un-hide
        // it (and clear the marker) so the attachment isn't invisible forever.
        if (m.card.isConnected) restoreCard(m.card)
        mounts.splice(i, 1)
      }
    }
  }

  const processAnchor = (a: HTMLAnchorElement): void => {
    const name = (a.textContent ?? '').trim()
    if (!name.toLowerCase().endsWith('.bpenc')) return
    const card = a.closest('[class*="fileWrapper"], [class*="file__"]') as HTMLElement | null
    if (!card || card.dataset['bpHandled'] === '1') return
    const url = a.href
    if (!url) return
    // CDN path: /attachments/<channelId>/<attachmentId>/<name>
    const idMatch = /\/attachments\/\d+\/(\d+)\//.exec(url)
    const id = idMatch ? idMatch[1]! : url
    const size = parseSizeText(card.querySelector('[class*="metadata"], [class*="fileSize"]')?.textContent)

    // React sometimes recreates the card child while its parent persists: the
    // fresh card has no bpHandled marker, but our previous host is still
    // connected beside it. Reuse it for the same attachment; anything stale
    // (different/no id, or a host we don't own) is unmounted and removed so
    // two components never stack.
    const existing = card.parentElement?.querySelector(':scope > .bp-att-host') as HTMLElement | null
    if (existing) {
      const idx = mounts.findIndex((m) => m.host === existing)
      if (existing.dataset['bpAttId'] === id && idx !== -1) {
        card.dataset['bpHandled'] = '1'
        card.style.display = 'none'
        mounts[idx]!.card = card // track the fresh card for restore-on-dispose
        return
      }
      if (idx !== -1) {
        try {
          mounts[idx]!.root.unmount()
        } catch {
          // root already gone
        }
        mounts.splice(idx, 1)
      }
      existing.remove()
    }

    card.dataset['bpHandled'] = '1'
    const host = document.createElement('div')
    host.className = 'bp-att-host'
    host.dataset['bpAttId'] = id
    card.style.display = 'none'
    card.parentElement?.insertBefore(host, card)
    const root = BdApi.ReactDOM.createRoot(host)
    root.render(
      BdApi.React.createElement(EncryptedAttachment, {
        ctx,
        attachment: { id, url, filename: name, size },
      }),
    )
    mounts.push({ host, card, root })
  }

  const scan = (): void => {
    try {
      cleanupDisconnected()
      const anchors = document.querySelectorAll(
        'a[class*="fileNameLink"], [class*="filenameLinkWrapper"] a, [class*="fileName"] a',
      )
      anchors.forEach((el) => processAnchor(el as HTMLAnchorElement))
    } catch (err) {
      console.error('[BetterPrivacy] attachment DOM scan failed', err)
    }
  }

  // Coalesce mutation bursts into one scan per frame — Discord's DOM churns
  // constantly and querySelectorAll per mutation would be wasteful.
  let scheduled = false
  const observer = new MutationObserver(() => {
    if (scheduled) return
    scheduled = true
    requestAnimationFrame(() => {
      scheduled = false
      scan()
    })
  })
  observer.observe(document.body, { childList: true, subtree: true })
  scan()

  ctx.disposers.push(() => {
    observer.disconnect()
    for (const m of mounts) {
      try {
        m.root.unmount()
      } catch {
        // already unmounted
      }
      m.host.remove()
      // Bring the native card back — otherwise stop() leaves it hidden and
      // the bpHandled marker blocks re-mounting after a restart.
      restoreCard(m.card)
    }
    mounts.length = 0
  })
}

export function applyAttachmentsPatch(ctx: PluginContext): void {
  const { modules } = ctx

  // Always-on DOM fallback (see comment above) — the webpack patch below is
  // an optimization for builds where the attachment component is findable.
  startAttachmentDomFallback(ctx)

  const holder = modules.AttachmentComponent
  const mod: any = holder?.module
  const method: unknown = holder?.method

  if (!mod || typeof method !== 'string' || typeof mod[method] !== 'function') {
    // Not a degradation anymore — the DOM fallback carries the feature.
    console.info('[BetterPrivacy] attachment component not found; DOM fallback active')
    return
  }

  ctx.patcher.after('attachments', mod, method, (_thisObj: any, args: any[], ret: any) => {
    try {
      const attachment = args?.[0]?.attachment
      const filename: unknown = attachment?.filename ?? attachment?.fileName
      if (typeof filename !== 'string' || !filename.toLowerCase().endsWith('.bpenc')) return ret
      if (attachment?.id === undefined || attachment?.id === null) return ret

      return BdApi.React.createElement(EncryptedAttachment, {
        key: `bp-att-${String(attachment.id)}`,
        ctx,
        attachment,
      })
    } catch (err) {
      // Never break attachment rendering — fall back to the original node.
      console.error('[BetterPrivacy] attachments patch error', err)
      return ret
    }
  })
}

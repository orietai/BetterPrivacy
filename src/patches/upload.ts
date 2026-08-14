/**
 * patches/upload.ts — outgoing attachment interception (spec §6, "Encrypted
 * attachments — send").
 *
 * Patcher.instead on CloudUpload.prototype.uploadFileToCloud (the class is
 * resolved in modules.ts by probing prototypes — spec §11 flags this pipeline
 * as the least stable one; if the lookup missed, this patch no-ops onto
 * modules.failed and the manual "encrypt file yourself" fallback described in
 * the spec is the escape hatch).
 *
 * When encrypt mode is ON for the focused channel, the pending File is read,
 * encrypted to the .bpenc container (spec §5) and swapped in under a random
 * 8-char name BEFORE the original upload runs — Discord's CDN only ever sees
 * ciphertext with the true filename/mime hidden inside the encrypted header.
 *
 * Fail-safe rule mirrors send.ts: with encrypt mode ON, any state we can't
 * positively handle (unreadable file shape, no key, locked key declined,
 * oversize, crypto failure) ABORTS the upload by throwing — plaintext is never
 * silently uploaded.
 */

import type { PluginContext } from '../types'
import { resolveCurrentChannelId } from '../modules'
import { encryptFileToBpenc } from '../crypto/bpenc'
import { openUnlockModal } from '../ui/UnlockModal'
import { isPlaintextOverrideActive } from './send'

/**
 * Hard ceiling regardless of the user's Discord upload cap (spec §5: files
 * ≥ ~64 MB are rejected). Anything under this but over the account's actual
 * Discord limit still fails server-side in the original pipeline — the ~33%
 * isn't an issue since .bpenc adds only a small fixed header + GCM tags.
 */
const HARD_CAP_BYTES = 64 * 1024 * 1024

/** Marker error: carries a user-facing message and intentionally aborts the upload. */
class UploadAbort extends Error {}

function toast(message: string, type: 'info' | 'success' | 'warning' | 'error'): void {
  try {
    BdApi.UI.showToast(message, { type })
  } catch {
    // Feedback is best-effort.
  }
}

/** 8 random [a-z0-9] chars for the .bpenc upload name (true name hidden inside). */
function randomBasename(): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789'
  const bytes = new Uint8Array(8)
  crypto.getRandomValues(bytes)
  let out = ''
  for (let i = 0; i < bytes.length; i++) out += alphabet[bytes[i]! % alphabet.length]
  return out
}

export function applyUploadPatch(ctx: PluginContext): void {
  const { modules } = ctx
  const CloudUpload = modules.CloudUpload

  if (!CloudUpload?.prototype || typeof CloudUpload.prototype.uploadFileToCloud !== 'function') {
    modules.failed.push('upload: CloudUpload.uploadFileToCloud unavailable')
    return
  }

  ctx.patcher.instead(
    'upload',
    CloudUpload.prototype,
    'uploadFileToCloud',
    (thisObj: any, args: any[], original: (...a: any[]) => any) => {
      const passthrough = (): any => Reflect.apply(original, thisObj, args)

      // The whole synchronous prelude is fail-safe: any throw below aborts the
      // upload rather than falling through to a plaintext passthrough.
      try {
        // Which channel is this upload for? CloudUpload doesn't reliably carry a
        // channel id across versions, so use the focused channel — uploads are
        // initiated from the focused chat.
        const channelId = resolveCurrentChannelId(modules)

        if (channelId === null) {
          // Can't tell whether encrypt mode is armed anywhere. With keys in the
          // keyring, the user may rely on encryption — blocking beats leaking
          // plaintext. With an empty keyring, plaintext is the only possibility.
          if (ctx.keyring.list().length > 0) {
            throw new UploadAbort(
              'BetterPrivacy: cannot determine the channel — upload blocked to avoid a plaintext leak; switch channels once and retry',
            )
          }
          return passthrough()
        }

        // Plaintext paths: mode off / '/pt ' override for this channel's send.
        if (!ctx.keyring.isEncryptModeOn(channelId) || isPlaintextOverrideActive(channelId)) {
          return passthrough()
        }

        // Known instance shapes (mid-2025): the file rides on this.item.file;
        // older builds kept it on this.file directly. Both probed defensively.
        const file: unknown = thisObj?.item?.file ?? thisObj?.file
        const currentName: string =
          typeof thisObj?.filename === 'string'
            ? thisObj.filename
            : file instanceof File
              ? file.name
              : ''

        // Already-encrypted payload (e.g. an internal retry re-invoking upload) —
        // don't double-encrypt.
        if (currentName.toLowerCase().endsWith('.bpenc')) return passthrough()

        // Encryption needed: async from here (file read + WebCrypto), so return
        // the promise — uploadFileToCloud is promise-returning anyway.
        return (async () => {
          try {
            if (!(file instanceof Blob)) {
              // Encrypt mode is ON but the upload item shape is unrecognized.
              // NEVER fall through to a plaintext upload — abort instead.
              throw new UploadAbort(
                'BetterPrivacy: cannot access the file to encrypt it — upload aborted',
              )
            }

            const activeId = ctx.keyring.getActiveSendKey(channelId)
            const entry = activeId ? ctx.keyring.get(activeId) : undefined
            if (!entry) {
              throw new UploadAbort(
                'BetterPrivacy: encrypt mode is ON but no key is selected — upload aborted',
              )
            }

            let key = ctx.session.getKey(entry.id)
            if (!key) {
              // Locked: offer to unlock; declining cancels the upload.
              let ok = false
              try {
                ok = await openUnlockModal(ctx, entry)
              } catch {
                ok = false
              }
              key = ok ? ctx.session.getKey(entry.id) : null
              if (!key) throw new UploadAbort('BetterPrivacy: upload cancelled — key locked')
            }

            if (file.size > HARD_CAP_BYTES) {
              throw new UploadAbort(
                'BetterPrivacy: file too large to encrypt (64 MB max) — upload aborted',
              )
            }

            const data = new Uint8Array(await file.arrayBuffer())
            const trueName = file instanceof File && file.name ? file.name : currentName || 'file'
            const trueMime = file.type || 'application/octet-stream'

            const encrypted = await encryptFileToBpenc(key, entry.id, data, trueName, trueMime)
            const uploadName = `${randomBasename()}.bpenc`
            const newFile = new File([encrypted as unknown as BlobPart], uploadName, {
              type: 'application/octet-stream',
            })

            // Swap the ciphertext file into the CloudUpload instance; mirror the
            // rename/resize onto whichever metadata fields this build carries.
            if (thisObj?.item && 'file' in thisObj.item) thisObj.item.file = newFile
            else thisObj.file = newFile
            if (typeof thisObj.filename === 'string') thisObj.filename = uploadName
            if (thisObj?.item && typeof thisObj.item.filename === 'string') {
              thisObj.item.filename = uploadName
            }
            if (typeof thisObj.size === 'number') thisObj.size = newFile.size
            if (typeof thisObj.mimeType === 'string') thisObj.mimeType = 'application/octet-stream'

            toast(`BetterPrivacy: attachment encrypted with "${entry.label}"`, 'success')
            return await passthrough()
          } catch (err: any) {
            const message =
              err instanceof UploadAbort
                ? err.message
                : 'BetterPrivacy: attachment encryption failed — upload aborted'
            if (!(err instanceof UploadAbort)) {
              console.error('[BetterPrivacy] upload patch error', err)
            }
            toast(message, 'error')
            // Re-throw so Discord's upload pipeline treats this as a failed
            // upload instead of proceeding without the file.
            throw err
          }
        })()
      } catch (err: any) {
        // Fail SAFE: a throwing prelude means the encrypt/plaintext decision
        // could not be made — abort the upload, never fall through to a
        // possibly-plaintext passthrough.
        const message =
          err instanceof UploadAbort
            ? err.message
            : 'BetterPrivacy: upload check failed — upload aborted'
        if (!(err instanceof UploadAbort)) {
          console.error('[BetterPrivacy] upload patch error', err)
        }
        toast(message, 'error')
        throw err
      }
    },
  )
}

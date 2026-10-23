/**
 * patches/composerLimit.ts — lets long text actually reach the send patch.
 *
 * WHY THIS EXISTS: Discord enforces its character limit in the COMPOSER, long
 * before MessageActions.sendMessage is ever called. Past the native cap (2000,
 * or 4000 with Nitro) the chat box simply refuses to send and shows its
 * "message too long" alert (or, without Nitro, a MESSAGE_LENGTH_UPSELL) — so
 * send.ts's auto-splitter, which happily chunks arbitrarily long plaintext
 * into consecutive encrypted messages, was unreachable for exactly the
 * messages it was written for. This patch neutralizes that gate WHILE the
 * focused channel is encrypted; the send patch then receives the whole text
 * and splits it.
 *
 * The submit-time message-length validator is resolved by its stable source
 * markers. The composer's length ceiling is a bundle constant, not an
 * exported getter. The paste-to-file prompt is patched separately below.
 *
 * HOW THE GATE IS NEUTRALIZED: not by forcing `{ valid: true }` — that would
 * also throw away the slowmode, rate-limit, @everyone and API-token checks the
 * same function performs, which protect the user from Discord-side
 * consequences. Instead the call is re-issued with `content` SHORTENED to the
 * native limit, so only the length comparison changes verdict and every other
 * check still runs. The shortened copy is used for validation ONLY; the caller
 * sends its own untouched text, which then reaches send.ts.
 *   Cost of the shortcut: the @everyone / API-token warning popouts only see
 *   the first DISCORD_MESSAGE_LIMIT characters. Under encryption that is moot
 *   — the plaintext never leaves the client, so a mention buried past that
 *   point cannot ping anyone anyway.
 *
 * ASSUMPTION — BD's webpack override: the validator is a webpack namespace
 * export, and stock webpack defines those as non-configurable getters that
 * cannot be assigned. BetterDiscord replaces __webpack_require__.d at startup
 * with a version that adds `configurable: true` and a setter, which is what
 * makes Patcher able to touch it at all. install() therefore VERIFIES the
 * property actually changed and reports it if not, rather than assuming.
 *
 * WHY RAISING IT IS SAFE — the bypass is gated on encrypt mode being ON, and
 * with mode ON every send through this channel is either encrypted (and split
 * into wire messages that each fit Discord's real 2000-char limit, which the
 * SERVER also enforces independently) or cancelled fail-closed. Nothing
 * over-long can be handed to Discord as plaintext:
 *   - mode OFF        → no bypass at all; the native limit applies unchanged;
 *   - send patch dead → no bypass; without interception the composer must keep
 *                       Discord's own cap, since text would go out verbatim;
 *   - '/pt ' override → send.ts cancels an over-long passthrough itself.
 *
 * DEGRADATION: every target here is optional. If one is missing (Discord
 * refactor, lazy chunk not loaded yet) the patch retries quietly twice and
 * then gives up with a console note — typing falls back to Discord's native
 * cap and long pastes keep becoming message.txt. Sending, splitting and
 * encryption are unaffected; users just can't send past the native limit.
 * Nothing lands on modules.failed, so this never triggers the degraded-startup
 * toast.
 *
 * SECOND GATE — the paste-to-file prompt. Pasting more than ~4000 characters
 * at once never reaches the length validator at all: Discord's paste handler
 * converts the text into a `message.txt` attachment before the composer holds
 * it, gated on the ChannelTextArea `uploadPromptCharacterCount` PROP rather
 * than on any length check. So the same feature needs a second, unrelated
 * patch: a Patcher.before on the same ChannelTextArea render the chat-bar
 * button is injected through, raising that prop under the same three gates
 * (prior art: DevilBro's SplitLargeMessages does exactly this).
 *   THIS ONE IS UX, NOT SAFETY. With encrypt mode ON an unraised prompt leaks
 *   nothing — the resulting message.txt goes through upload.ts and lands on
 *   Discord as an encrypted `.bpenc`. The raise only changes the SHAPE of the
 *   result: a paste becomes several split encrypted messages the recipient can
 *   read inline, instead of an encrypted text file they must download. If the
 *   prop is absent on a given build, nothing is invented — the paste keeps
 *   Discord's behaviour.
 */

import type { PluginContext } from '../types'
import { DISCORD_MESSAGE_LIMIT } from '../crypto/wire'
import {
  resolveCurrentChannelId,
  resolveMessageLengthValidator,
} from '../modules'
import { resolveTextAreaRenderTarget } from '../ui/ChatBarControls'

/**
 * The allowance handed to the composer while a channel is encrypted:
 * effectively unlimited for anything a human types or pastes. It is a finite
 * number only as a sanity bound — Infinity would risk a caller looping or
 * formatting on it. Used for the paste-to-file prompt's
 * `uploadPromptCharacterCount`. The real ceiling on a send is the splitter's
 * (none) plus send.ts's many-parts confirmation.
 */
const EXTENDED_COMPOSER_LIMIT = 1_000_000

/** Quiet re-probe schedule (deltas): fires at ~15s and ~45s after start. */
const RETRY_DELAYS = [15_000, 30_000]

/**
 * The validator takes ONE options object and carries the target channel on it
 * as a channel record. It is null for call sites that have no channel yet
 * (sending to a user from their profile), where the focused channel is again
 * the right answer.
 */
function channelIdForValidatorCall(ctx: PluginContext, options: any): string | null {
  const id = options?.channel?.id
  if (typeof id === 'string' && id.length > 0) return id
  return resolveCurrentChannelId(ctx.modules)
}

/**
 * Which channel is this composer for? ChannelTextArea has carried the target
 * as a full channel record (`props.channel`) for years, but thread/forum and
 * modal composers on some builds pass only an id (`props.channelId`) — both are
 * probed defensively, and neither is assumed to exist. The focused channel is
 * the last resort: this render IS a composer, so if it isn't telling us which
 * one, the one the user is looking at is the best available answer.
 */
function channelIdForProps(ctx: PluginContext, props: any): string | null {
  const fromRecord = props?.channel?.id
  if (typeof fromRecord === 'string' && fromRecord.length > 0) return fromRecord
  const fromId = props?.channelId
  if (typeof fromId === 'string' && fromId.length > 0) return fromId
  return resolveCurrentChannelId(ctx.modules)
}

/**
 * The bypass is only safe while send.ts is actually intercepting sends. If its
 * lookup or patch failed, over-limit text would leave as plaintext — so the
 * composer keeps Discord's own cap instead.
 */
function sendPatchHealthy(ctx: PluginContext): boolean {
  return !ctx.modules.failed.some((f) => f.includes('send') || /^edit(?:Composer)?:/.test(f) || f.includes('MessageActions') || f.includes('MessageStore'))
}

/**
 * Confirms a Patcher call actually landed. Webpack namespace exports are
 * getter-backed; they are only writable because BetterDiscord replaces
 * __webpack_require__.d (see the file header). If that ever stops being true
 * the assignment is a silent no-op, and a silent no-op is exactly the failure
 * mode this whole rewrite exists to eliminate — so it gets its own message.
 */
function verifyInstalled(module: any, method: string, before: unknown, label: string): boolean {
  let after: unknown
  try {
    after = module[method]
  } catch {
    after = before
  }
  if (after === before) {
    console.warn(
      `[BetterPrivacy] composer limit patch did not take on ${label}.${method} ` +
        '(webpack export is not writable); composer keeps the native limit',
    )
    return false
  }
  console.info(`[BetterPrivacy] composer limit patched via ${label}.${method}`)
  return true
}

/**
 * PRIMARY TARGET — the submit-time validator. Re-issues the call with a
 * shortened `content` when, and only when, the three gates hold.
 */
function installValidatorPatch(
  ctx: PluginContext,
  target: { module: any; method: string },
): boolean {
  const { module, method } = target
  if (!module || typeof module[method] !== 'function') return false
  const before = module[method]

  ctx.patcher.instead(
    'composerLimit',
    module,
    method,
    (thisObj: any, args: any[], original: (...a: any[]) => any) => {
      // Decided inside the try; the original is invoked exactly once, below
      // and outside it — if Discord's own validator throws, that is Discord's
      // behaviour and not something this patch should swallow.
      let callArgs = args
      try {
        const options = args?.[0]
        const content = options?.content
        // Anything Discord would have accepted unchanged is left completely
        // alone, so short messages keep 100% native behaviour (warning
        // popouts included).
        if (
          options &&
          typeof content === 'string' &&
          content.length > DISCORD_MESSAGE_LIMIT &&
          sendPatchHealthy(ctx)
        ) {
          const channelId = channelIdForValidatorCall(ctx, options)
          if (channelId !== null && ctx.keyring.isEncryptModeOn(channelId)) {
            // A COPY: the caller's options object must not be mutated, and the
            // real text it goes on to send must stay untouched.
            callArgs = [
              { ...options, content: content.slice(0, DISCORD_MESSAGE_LIMIT) },
              ...args.slice(1),
            ]
          }
        }
      } catch (err) {
        // Any failure degrades to exactly what Discord would have done.
        console.error('[BetterPrivacy] composer limit patch error', err)
        callArgs = args
      }
      return Reflect.apply(original, thisObj, callArgs)
    },
  )

  return verifyInstalled(module, method, before, 'message-length validator')
}

/**
 * PASTE-PROMPT TARGET — the ChannelTextArea render. A Patcher.before that
 * raises `uploadPromptCharacterCount` on the props of the render about to run,
 * so a big paste stays text in the composer (where the length validator patch
 * above then lets it through to send.ts's splitter) instead of being turned
 * into a message.txt attachment.
 *
 * Props are mutated in place on purpose: the prop is read by the paste handler
 * of the very render this hook precedes, so a copy would be ignored. React
 * only freezes props in development builds; Discord ships production React, and
 * a frozen-props host is handled below by disabling the raise instead of
 * throwing on every render.
 */
function installPastePromptPatch(ctx: PluginContext, renderTarget: any): boolean {
  if (!renderTarget || typeof renderTarget.render !== 'function') return false

  // One-shot flags: this hook runs on EVERY composer render, so neither the
  // success breadcrumb nor a failure may be logged more than once, and a host
  // that refuses the assignment is given up on rather than retried forever.
  let logged = false
  let disabled = false

  ctx.patcher.before('composerLimit', renderTarget, 'render', (_thisObj: any, args: any[]) => {
    if (disabled) return
    try {
      const props = args?.[0]
      if (!props || typeof props !== 'object') return
      const current = props.uploadPromptCharacterCount
      // Absent on this build, or already generous enough — either way there is
      // nothing to do, and no prop is ever invented.
      if (typeof current !== 'number' || current >= EXTENDED_COMPOSER_LIMIT) return
      // Same three gates as the rest of this file: healthy interception, a
      // resolvable channel, encrypt mode ON for it.
      if (!sendPatchHealthy(ctx)) return
      const channelId = channelIdForProps(ctx, props)
      if (channelId === null) return
      if (!ctx.keyring.isEncryptModeOn(channelId)) return

      // Math.max, never a bare constant: a build whose prompt already sits
      // higher than ours must not be lowered by this patch.
      props.uploadPromptCharacterCount = Math.max(current, EXTENDED_COMPOSER_LIMIT)
      if (props.uploadPromptCharacterCount === current) {
        // Assignment silently didn't take (frozen/read-only props) — stop
        // trying rather than repeating a no-op on every keystroke's render.
        disabled = true
        console.info(
          '[BetterPrivacy] paste-to-file prompt is not writable; long pastes keep becoming message.txt',
        )
        return
      }
      if (!logged) {
        logged = true
        console.info('[BetterPrivacy] paste-to-file prompt raised while encrypted')
      }
    } catch (err) {
      // A throw here would break the composer's render outright, so it is
      // swallowed and the raise is abandoned: Discord's own paste behaviour.
      disabled = true
      console.error('[BetterPrivacy] paste prompt patch error', err)
    }
  })

  return true
}

/** Tracks which of the two targets are already patched across probe rounds. */
interface ProbeState {
  validator: boolean
  paste: boolean
}

/**
 * One probe round. Installs whatever it finds; returns true once both the
 * PRIMARY target and the paste prompt are secured, which is the signal to stop
 * re-probing. Every lookup and every install is wrapped: this is an
 * enhancement, and no part of it may escape into index.ts's PATCH_STEPS error
 * path (that would push the step name onto modules.failed and toast a degraded
 * startup).
 */
function probeOnce(ctx: PluginContext, state: ProbeState): boolean {
  if (!state.validator) {
    let found: { module: any; method: string } | null = null
    try {
      found = resolveMessageLengthValidator()
    } catch {
      found = null
    }
    if (found) {
      try {
        state.validator = installValidatorPatch(ctx, found)
      } catch (err) {
        console.warn('[BetterPrivacy] composer limit patch could not be applied', err)
      }
    }
  }

  if (!state.paste) {
    // ctx.modules.ChannelTextArea is shared and index.ts's lookup retries
    // repopulate it, so a late-loading composer chunk is picked up by simply
    // re-reading it on the next round.
    try {
      const renderTarget = resolveTextAreaRenderTarget(ctx.modules.ChannelTextArea)
      if (renderTarget) state.paste = installPastePromptPatch(ctx, renderTarget)
    } catch (err) {
      console.warn('[BetterPrivacy] paste prompt patch could not be applied', err)
    }
  }

  return state.validator && state.paste
}

/**
 * The validator can be missing simply because its webpack chunk hasn't loaded
 * yet, so re-probe twice before giving up. Silent throughout: a user who never
 * types past 2000 chars should never learn it went missing.
 */
function scheduleProbeRetries(ctx: PluginContext, state: ProbeState): void {
  let attempt = 0
  let timer: ReturnType<typeof setTimeout> | null = null

  ctx.disposers.push(() => {
    if (timer !== null) clearTimeout(timer)
    timer = null
  })

  const schedule = (): void => {
    timer = setTimeout(() => {
      timer = null
      if (probeOnce(ctx, state)) return
      if (attempt < RETRY_DELAYS.length) {
        schedule()
        return
      }
      if (!state.validator) {
        console.info(
          '[BetterPrivacy] message-length validator not found; composer keeps the native limit',
        )
      }
      if (!state.paste) {
        console.info(
          '[BetterPrivacy] chat text area not found; long pastes keep becoming message.txt',
        )
      }
    }, RETRY_DELAYS[attempt]!)
    attempt++
  }

  schedule()
}

export function applyComposerLimitPatch(ctx: PluginContext): void {
  const state: ProbeState = { validator: false, paste: false }
  if (probeOnce(ctx, state)) return
  scheduleProbeRetries(ctx, state)
}

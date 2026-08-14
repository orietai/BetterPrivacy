/**
 * modules.ts — ALL Discord-internal webpack lookups, centralized.
 *
 * Ground rules (spec §10/§11):
 *  - prop-based / source-string-based filters only, never mangled export names;
 *  - every lookup individually wrapped so one miss can't take down the rest;
 *  - each miss pushes a human-readable name onto `failed` — index.ts's startup
 *    self-test toasts the list and the plugin degrades gracefully;
 *  - resolveModules() itself NEVER throws.
 *
 * Shape notes for consumers (DiscordModules fields are `any` by contract):
 *  - MessageContent      : normalized to `{ module, method }` where
 *                          `module[method]` is the render function to
 *                          Patcher.after (render.ts consumes this).
 *  - AttachmentComponent : normalized to `{ module, method }` likewise
 *                          (attachments.ts consumes this).
 *  - CloudUpload         : the CloudUpload CLASS; patch prototype.uploadFileToCloud.
 */

import type { DiscordModules } from './types'

/**
 * Resolve the currently focused channel id. Primary source is
 * SelectedChannelStore; if that lookup failed (or returns nothing, which
 * happens transiently during app boot), fall back to parsing the SPA route —
 * Discord URLs are /channels/<guildId|@me>/<channelId>[/threads/<threadId>].
 * In a thread the THREAD id is the focused channel (it's what the send gate
 * keys on), so it wins over the parent channel id when present. Returns null
 * when neither source yields an id.
 */
export function resolveCurrentChannelId(modules: DiscordModules): string | null {
  try {
    const selected = modules.SelectedChannelStore?.getChannelId?.()
    if (typeof selected === 'string' && selected.length > 0) return selected
  } catch {
    // store shape changed — fall through to the URL
  }
  const match = /^\/channels\/(?:@me|\d+)\/(\d+)(?:\/threads\/(\d+))?/.exec(window.location.pathname)
  if (!match) return null
  return match[2] ?? match[1]!
}

/**
 * Runs one lookup defensively. A lookup "fails" if it throws OR returns
 * null/undefined; either way the human-readable name lands on `failed` and the
 * field ends up null. Nothing in here is allowed to escape.
 */
function resolve(failed: string[], name: string, lookup: () => any): any | null {
  try {
    const found = lookup()
    if (found === null || found === undefined) {
      console.warn(`[BetterPrivacy] webpack lookup failed: ${name}`)
      failed.push(name)
      return null
    }
    return found
  } catch (err) {
    console.warn(`[BetterPrivacy] webpack lookup threw: ${name}`, err)
    failed.push(name)
    return null
  }
}

/** Best-effort source text of a function/module value for marker probing. */
function src(value: any): string {
  try {
    return String(value)
  } catch {
    return ''
  }
}

export function resolveModules(): DiscordModules {
  const failed: string[] = []
  const Webpack = BdApi?.Webpack

  // If BdApi.Webpack itself is missing (catastrophically old/broken BD host),
  // report every lookup as failed rather than throwing.
  if (!Webpack) {
    return {
      MessageActions: null,
      MessageStore: null,
      SelectedChannelStore: null,
      Dispatcher: null,
      MessageContent: null,
      MarkdownParser: null,
      CloudUpload: null,
      AttachmentComponent: null,
      ChannelTextArea: null,
      failed: [
        // MessageStore is intentionally absent — unconsumed, silent on miss.
        'MessageActions',
        'SelectedChannelStore',
        'Dispatcher',
        'MessageContent',
        'MarkdownParser',
        'CloudUpload',
        'AttachmentComponent',
        'ChannelTextArea',
      ],
    }
  }

  // --- Stable, prop-based lookups (low churn risk) -------------------------

  const MessageActions = resolve(failed, 'MessageActions', () =>
    Webpack.getByKeys('sendMessage', 'editMessage'),
  )

  // MessageStore is resolved for debugging/future use but no patch consumes
  // it, so a miss must NOT land on `failed` (it would only add noise to the
  // degraded-mode toast) — resolve silently, null on miss.
  let MessageStore: any = null
  try {
    MessageStore = Webpack.getStore('MessageStore') ?? null
  } catch {
    MessageStore = null
  }

  const SelectedChannelStore = resolve(failed, 'SelectedChannelStore', () =>
    Webpack.getStore('SelectedChannelStore'),
  )

  const Dispatcher = resolve(failed, 'Dispatcher', () => {
    const isDispatcher = (m: any): boolean =>
      Boolean(m && typeof m.dispatch === 'function' && typeof m.subscribe === 'function')
    const direct = Webpack.getByKeys('dispatch', 'subscribe')
    if (isDispatcher(direct)) return direct
    // getByKeys misses the dispatcher when it rides a default export or its
    // methods moved onto the prototype (observed 2026 builds). Every Flux
    // store keeps a reference to the singleton, and the stores resolve via
    // the stable getStore path — so borrow it from one of them.
    for (const storeName of ['SelectedChannelStore', 'UserStore', 'ChannelStore', 'GuildStore']) {
      try {
        const store = Webpack.getStore(storeName)
        const viaStore = store?._dispatcher ?? store?.getDispatcher?.()
        if (isDispatcher(viaStore)) return viaStore
      } catch {
        // try the next store
      }
    }
    return null
  })

  // Discord's own markdown module — .parse renders markdown to a React tree.
  const MarkdownParser = resolve(failed, 'MarkdownParser', () =>
    Webpack.getByKeys('parse', 'parseTopic'),
  )

  // --- Class lookups (medium churn risk) ------------------------------------

  // The CloudUpload class: the only export whose prototype carries
  // uploadFileToCloud. Prototype methods are not mangled, so this survives
  // minification churn better than name-based lookups.
  const CloudUpload = resolve(failed, 'CloudUpload', () =>
    Webpack.getModule(
      (m: any) => Boolean(typeof m === 'function' && m?.prototype?.uploadFileToCloud),
      { searchExports: true },
    ),
  )

  // --- Component lookups (HIGH churn risk — inherently fragile) -------------

  // Message content component. Verified against a live 2026-07 build via a
  // React-fiber probe: exported as memo(fn) under a minified key, and the
  // inner function destructures {className, message, children, content,
  // onUpdate, contentRef, compact}. Those PROP-NAME literals survive
  // minification (they're object keys), unlike the old 'messageContent'
  // class-name marker, which now lives only in CSS-mapping modules and never
  // appears in component source. Wrapper shapes probed: memo(fn) → 'type',
  // memo(forwardRef(fn)) → 'render', bare fn → its export key. Normalized to
  // { module, method } so render.ts always has a concrete, function-valued
  // property to Patcher.after.
  const MessageContent = resolve(failed, 'MessageContent', () => {
    const srcHasAll = (v: any, needles: string[]): boolean => {
      if (typeof v !== 'function') return false
      const s = src(v)
      return needles.every((n) => s.includes(n))
    }
    // Current builds: prop-key markers. Legacy (< 2026) builds: inline
    // 'messageContent' class literal. Tried in that order.
    const probes: Array<(v: any) => boolean> = [
      (v) => srcHasAll(v, ['contentRef', 'onUpdate', 'compact', 'message']),
      (v) => srcHasAll(v, ['messageContent']),
    ]
    for (const probe of probes) {
      const memoLike = Webpack.getModule(
        (x: any) => Boolean(x?.type) && (probe(x.type) || probe(x.type?.render) || probe(x.type?.type)),
        { searchExports: true },
      )
      if (memoLike) {
        if (probe(memoLike.type)) return { module: memoLike, method: 'type' }
        if (probe(memoLike.type?.render)) return { module: memoLike.type, method: 'render' }
        if (probe(memoLike.type?.type)) return { module: memoLike.type, method: 'type' }
      }
      // Bare function export: getWithKey hands back the export holder so a
      // named property exists to patch.
      const withKey = Webpack.getWithKey?.((x: any) => probe(x))
      if (Array.isArray(withKey) && withKey[0] && typeof withKey[1] === 'string') {
        return { module: withKey[0], method: withKey[1] }
      }
    }
    return null
  })

  // Attachment renderer: probe module records for a function-valued export
  // whose source carries attachment render markers ('attachment' + 'spoiler'
  // both appear in the compiled attachment component). FRAGILE. Normalized to
  // { module, method } so attachments.ts has a stable patch target.
  const AttachmentComponent = resolve(failed, 'AttachmentComponent', () => {
    const isAttachmentRender = (fn: any): boolean => {
      if (typeof fn !== 'function') return false
      const s = src(fn)
      // 'spoiler' has appeared as 'obscure*' hidden-media naming in newer builds.
      return s.includes('attachment') && (s.includes('spoiler') || s.includes('obscure'))
    }
    // Probe the module record and one level of memo/forwardRef nesting; return
    // the concrete { module, method } holding the render function.
    const pick = (holder: any): { module: any; method: string } | null => {
      if (!holder) return null
      if (isAttachmentRender(holder.default)) return { module: holder, method: 'default' }
      if (isAttachmentRender(holder.type)) return { module: holder, method: 'type' }
      if (isAttachmentRender(holder.default?.type)) return { module: holder.default, method: 'type' }
      if (isAttachmentRender(holder.default?.render)) return { module: holder.default, method: 'render' }
      if (isAttachmentRender(holder.type?.render)) return { module: holder.type, method: 'render' }
      return null
    }
    const holder = Webpack.getModule(
      (m: any) => {
        try {
          return pick(m) !== null
        } catch {
          return false
        }
      },
      // Keep the whole module record so a named property exists to patch.
      { defaultExport: false, searchExports: false },
    )
    const picked = pick(holder)
    if (picked) return picked
    // Second pass over individual exports (memo/forwardRef exported directly).
    const exp = Webpack.getModule(
      (x: any) => {
        try {
          return Boolean(x?.type) && (isAttachmentRender(x.type) || isAttachmentRender(x.type?.render))
        } catch {
          return false
        }
      },
      { searchExports: true },
    )
    if (exp) {
      if (isAttachmentRender(exp.type)) return { module: exp, method: 'type' }
      if (isAttachmentRender(exp.type?.render)) return { module: exp.type, method: 'render' }
    }
    return null
  })

  // Chat text area component (ChatBarControls injection point): a forwardRef
  // object whose render source mentions the CHANNEL_TEXT_AREA constant.
  // FRAGILE for the same source-marker reasons as above.
  const ChannelTextArea = resolve(failed, 'ChannelTextArea', () =>
    Webpack.getModule(
      (m: any) => Boolean(m?.type?.render && src(m.type.render).includes('CHANNEL_TEXT_AREA')),
      { searchExports: true },
    ),
  )

  return {
    MessageActions,
    MessageStore,
    SelectedChannelStore,
    Dispatcher,
    MessageContent,
    MarkdownParser,
    CloudUpload,
    AttachmentComponent,
    ChannelTextArea,
    failed,
  }
}

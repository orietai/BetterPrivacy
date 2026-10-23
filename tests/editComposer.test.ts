import { afterEach, describe, expect, it, vi } from 'vitest'
import { JSDOM } from 'jsdom'
import { createKeyring } from '../src/core/keyring'
import { createSession } from '../src/core/session'
import { createSettingsStore } from '../src/settings'
import { applyEditPatch } from '../src/patches/send'
import { applyEditComposerPatch } from '../src/patches/editComposer'
import { openEditMessageModal } from '../src/ui/EditMessageModal'
import { openRecoverKeyModal, openUnlockModal } from '../src/ui/UnlockModal'
import * as cipher from '../src/crypto/cipher'
import { encodeWire, parseWire } from '../src/crypto/wire'
import type { PluginContext } from '../src/types'

vi.mock('../src/ui/UnlockModal', () => ({ openUnlockModal: vi.fn(), openRecoverKeyModal: vi.fn() }))

const CHANNEL = '123456789012345678'
const MESSAGE = '987654321098765432'
const PHRASE = 'four tiny moons over the rooftop'
const SECRET = 'A private draft 🦇\nwith a second line'
const cleanups: Array<() => void> = []
afterEach(() => {
  cleanups.splice(0).forEach(fn => fn())
  vi.restoreAllMocks()
  vi.mocked(openUnlockModal).mockReset()
  vi.mocked(openRecoverKeyModal).mockReset()
  vi.unstubAllGlobals()
})

async function harness() {
  const dom = new JSDOM('<!doctype html><body></body>')
  vi.stubGlobal('window', dom.window)
  const disk = new Map<string, any>()
  const toasts = vi.fn()
  // Minimal hook host: mount the real component, attach its textarea ref and
  // run its effects/cleanups, including the actual DOM-clearing relock path.
  let effects: Array<() => (() => void)> = []
  let rendering: { refs: any[]; cursor: number; mounted: boolean; render(): void }
  const closeModal = vi.fn()
  const getByKeys = vi.fn((): any => ({ openModal: vi.fn(), closeModal }))
  const modals: Array<{ content: any; options: any; input: HTMLTextAreaElement; save: HTMLButtonElement; budget: HTMLElement; error: string | null; change(value: string): void; unmount(): void }> = []
  const confirm = vi.fn((_title: string, content: any, options: any) => {
    effects = []
    const input = dom.window.document.createElement('textarea')
    const save = dom.window.document.createElement('button')
    const budget = dom.window.document.createElement('div')
    let textarea: any
    let error: string | null = null
    const host = { refs: [] as any[], cursor: 0, mounted: false, render() {
      rendering = host
      host.cursor = 0
      const tree = content.type(content.props)
      textarea = tree.props.children.find((child: any) => child?.type === 'textarea')
      input.value = textarea.props.value
      input.disabled = textarea.props.disabled
      textarea.props.ref.current = input
      const button = tree.props.children.find((child: any) => child?.type === 'button')
      save.disabled = button.props.disabled
      save.onclick = button.props.onClick
      const counter = tree.props.children.find((child: any) => child?.props?.['aria-live'])
      budget.textContent = counter.props.children.join('')
      const alert = tree.props.children.find((child: any) => child?.props?.role === 'alert')
      error = alert ? alert.props.children.join('') : null
    } }
    host.render()
    dom.window.document.body.append(input, save, budget)
    host.mounted = true
    const unmounts = effects.map(effect => effect())
    let unmounted = false
    modals.push({ content, options, input, save, budget, get error() { return error },
      change(value) { input.value = value; textarea.props.onChange({ target: input }) },
      unmount() {
        if (unmounted) return
        unmounted = true
        unmounts.forEach(fn => fn())
        input.remove()
        save.remove()
        budget.remove()
      },
    })
    return 'modal'
  })
  vi.stubGlobal('BdApi', {
    Data: {
      load: (_plugin: string, key: string) => disk.get(key),
      save: (_plugin: string, key: string, value: any) => disk.set(key, structuredClone(value)),
    },
    React: {
      createElement: (type: any, props: any, ...children: any[]) => ({ type, props: { ...props, children } }),
      useReducer: () => { const host = rendering; return [0, () => host.render()] },
      useRef: (current: any) => {
        const index = rendering.cursor++
        return rendering.refs[index] ??= { current }
      },
      useEffect: (effect: () => (() => void)) => { if (!rendering.mounted) effects.push(effect) },
    },
    UI: { showToast: toasts, showConfirmationModal: confirm },
    Webpack: { getByKeys },
  })
  const keyring = createKeyring()
  const settings = createSettingsStore()
  const session = createSession(keyring, settings)
  const entry = await keyring.create('historical', PHRASE, CHANNEL)
  await session.unlock(entry, PHRASE)
  const key = session.getKey(entry.id)!
  const encrypted = await cipher.encryptText(key, SECRET)
  const content = encodeWire({ keyId: entry.id, salt: entry.salt, iv: encrypted.iv, ciphertext: encrypted.ct })
  const record = Object.freeze({ id: MESSAGE, channel_id: CHANNEL, content })
  const getMessage = vi.fn((_channel: string, _message: string): any => record)
  const dispatch = vi.fn((..._args: any[]): any => 'native dispatch')
  const dispatcher = { dispatch }
  const actions = {
    startEditMessage: vi.fn((channelId: string, messageId: string, content: string, source: any) =>
      dispatcher.dispatch({ type: 'MESSAGE_START_EDIT', channelId, messageId, content, source })),
    startEditMessageRecord: vi.fn((channelId: string, message: any, source: any) =>
      dispatcher.dispatch({ type: 'MESSAGE_START_EDIT', channelId, messageId: message.id, content: message.content, source })),
    editMessage: vi.fn(async (..._args: any[]): Promise<any> => ({ ok: true })),
  }
  const nativeStart = actions.startEditMessage
  const nativeRecord = actions.startEditMessageRecord
  const nativeEdit = actions.editMessage
  const unpatches: Array<() => void> = []
  const ctx = {
    keyring, settings, session,
    modules: { MessageActions: actions, MessageStore: { getMessage }, Dispatcher: dispatcher,
      SelectedChannelStore: { getChannelId: () => CHANNEL }, failed: [] },
    patcher: { instead(_caller: string, target: any, method: string, callback: any) {
      const native = target[method]
      target[method] = function (...args: any[]) { return callback(this, args, native) }
      let removed = false
      const undo = () => { if (!removed) { removed = true; target[method] = native } }
      unpatches.push(undo)
      return undo
    } },
    disposers: [],
    forceRerender: () => dom.window.dispatchEvent(new dom.window.Event('bp-rerender')),
  } as unknown as PluginContext
  const stop = () => { ctx.disposers.forEach(fn => fn()); session.stop() }
  cleanups.push(() => { stop(); modals.forEach(modal => modal.unmount()); unpatches.reverse().forEach(fn => fn()); dom.window.close() })
  applyEditPatch(ctx)
  return { ctx, entry, key, record, getMessage, actions, nativeStart, nativeRecord, nativeEdit, dispatcher, dispatch, toasts, confirm, modals, disk, stop, closeModal, getByKeys }
}

async function modal(h: Awaited<ReturnType<typeof harness>>) {
  await vi.waitFor(() => expect(h.modals).toHaveLength(1))
  return h.modals[0]!
}

describe('private edit composer', () => {
  it.each(['startEditMessage', 'startEditMessageRecord', 'dispatcher', 'snake case'])('prefills plaintext from original ciphertext through %s', async method => {
    const h = await harness()
    applyEditComposerPatch(h.ctx)
    if (method === 'startEditMessage') h.actions.startEditMessage(CHANNEL, MESSAGE, 'untrusted argument', 'keyboard')
    if (method === 'startEditMessageRecord') h.actions.startEditMessageRecord(CHANNEL, { id: MESSAGE, content: 'untrusted argument' }, 'menu')
    if (method === 'dispatcher') h.dispatcher.dispatch({ type: 'MESSAGE_START_EDIT', channelId: CHANNEL, messageId: MESSAGE, content: h.record.content })
    if (method === 'snake case') h.dispatcher.dispatch({ type: 'MESSAGE_START_EDIT', channel_id: CHANNEL, message_id: MESSAGE })
    const m = await modal(h)
    expect(m.input.value).toBe(SECRET)
    expect(h.nativeStart).not.toHaveBeenCalled()
    expect(h.nativeRecord).not.toHaveBeenCalled()
    expect(h.dispatch).not.toHaveBeenCalled()
    expect(h.record.content).toMatch(/^🦇</)
    expect(h.getMessage(CHANNEL, MESSAGE)).toBe(h.record)
    expect(JSON.stringify([...h.disk.values()])).not.toContain(SECRET)
    m.options.onCancel()
    m.options.onCloseCallback()
    expect(m.input.value).toBe('')
    expect(h.nativeEdit).not.toHaveBeenCalled()
  })

  it('saves the synchronous closure draft through the real protected edit action with the historical key', async () => {
    const h = await harness()
    h.ctx.keyring.setEncryptMode(CHANNEL, false)
    const done = openEditMessageModal(h.ctx, CHANNEL, MESSAGE)
    const m = await modal(h)
    m.change('changed privately 🦇')
    expect(m.options.confirmText).toBeNull()
    m.save.click()
    await done
    expect(h.nativeEdit).toHaveBeenCalledOnce()
    const [channelId, messageId, update] = h.nativeEdit.mock.calls[0]!
    expect([channelId, messageId]).toEqual([CHANNEL, MESSAGE])
    const parts = parseWire(update.content)!
    expect(parts.keyId).toBe(h.entry.id)
    await expect(cipher.decryptText(h.key, parts.iv, parts.ciphertext)).resolves.toBe('changed privately 🦇')
    expect(m.content.props.draft.value).toBe('')
    expect(h.record.content).toMatch(/^🦇</)
    expect(h.dispatch).not.toHaveBeenCalled()
    expect(h.getByKeys).toHaveBeenCalledWith('openModal', 'closeModal')
    expect(h.closeModal).toHaveBeenCalledWith('modal')
  })

  it.each(['resolved', 'rejected', 'cancelled'])('retains the edited draft after a %s failure and allows retry', async failure => {
    const h = await harness()
    if (failure === 'resolved') h.nativeEdit.mockResolvedValueOnce({ ok: false })
    else if (failure === 'rejected') h.nativeEdit.mockRejectedValueOnce(new Error('network'))
    else h.nativeEdit.mockResolvedValueOnce(undefined)
    const done = openEditMessageModal(h.ctx, CHANNEL, MESSAGE)
    const m = await modal(h)
    m.change('keep my correction')
    m.save.click()
    expect(m.save.disabled).toBe(true)
    await vi.waitFor(() => expect(m.save.disabled).toBe(false))
    expect(m.input.value).toBe('keep my correction')
    expect(h.closeModal).not.toHaveBeenCalled()
    m.save.click()
    await done
    expect(h.nativeEdit).toHaveBeenCalledTimes(2)
    expect(m.input.value).toBe('')
  })

  it('does not restore a draft closed while a failed save is pending', async () => {
    const h = await harness()
    let reject!: (reason: Error) => void
    h.nativeEdit.mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail }))
    const done = openEditMessageModal(h.ctx, CHANNEL, MESSAGE)
    const m = await modal(h)
    m.change('must be cleared')
    m.save.click()
    await vi.waitFor(() => expect(h.nativeEdit).toHaveBeenCalledOnce())
    m.options.onCloseCallback()
    await done
    reject(new Error('offline'))
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(m.input.value).toBe('')
    expect(m.save.disabled).toBe(true)
  })

  it('discards drafts on backdrop close and allows a fresh launch', async () => {
    const h = await harness()
    const done = openEditMessageModal(h.ctx, CHANNEL, MESSAGE)
    const m = await modal(h)
    m.change('do not save')
    m.options.onCloseCallback()
    await done
    expect(m.input.value).toBe('')
    expect(h.nativeEdit).not.toHaveBeenCalled()
    const again = openEditMessageModal(h.ctx, CHANNEL, MESSAGE)
    await vi.waitFor(() => expect(h.modals).toHaveLength(2))
    h.modals[1]!.options.onCancel()
    await again
  })

  it('keeps oversized drafts visible and unsent until shortened to the UTF-8 budget', async () => {
    const h = await harness()
    const done = openEditMessageModal(h.ctx, CHANNEL, MESSAGE)
    const m = await modal(h)
    const oversized = '🦇'.repeat(341)
    m.change(oversized)
    expect(m.input.value).toBe(oversized)
    expect(m.content.props.draft.value).toBe(oversized)
    expect(m.input.disabled).toBe(false)
    expect(m.save.disabled).toBe(true)
    expect(m.budget.textContent).toContain('1364 / 1360')
    expect(m.error).toContain('1360')
    m.save.click()
    // Even a direct callback before the disabled UI updates cannot lose text.
    m.options.onConfirm()
    expect(h.nativeEdit).not.toHaveBeenCalled()
    expect(h.closeModal).not.toHaveBeenCalled()
    expect(m.input.value).toBe(oversized)
    m.change('🦇'.repeat(340))
    expect(m.save.disabled).toBe(false)
    expect(m.error).toBeNull()
    expect(m.budget.textContent).toContain('1360 / 1360')
    m.save.click()
    await done
    expect(h.nativeEdit).toHaveBeenCalledOnce()
    const parts = parseWire(h.nativeEdit.mock.calls[0]![2].content)!
    await expect(cipher.decryptText(h.key, parts.iv, parts.ciphertext)).resolves.toBe('🦇'.repeat(340))
    expect(h.closeModal).toHaveBeenCalledWith('modal')
  })

  it.each(['missing', 'throws'])('keeps a cleared disabled modal cancellable when closing API %s', async failure => {
    const h = await harness()
    if (failure === 'missing') h.getByKeys.mockReturnValue(null)
    else h.getByKeys.mockImplementation(() => { throw new Error('lookup unavailable') })
    const done = openEditMessageModal(h.ctx, CHANNEL, MESSAGE)
    const m = await modal(h)
    m.change('safe save')
    m.save.click()
    await done
    expect(h.nativeEdit).toHaveBeenCalledOnce()
    expect(m.input.value).toBe('')
    expect(m.input.disabled).toBe(true)
    expect(m.save.disabled).toBe(true)
    expect(h.closeModal).not.toHaveBeenCalled()
    m.options.onCancel()
    m.options.onCloseCallback()
  })

  it.each([false, true])('handles a locked historical key, unlock success=%s', async success => {
    const h = await harness()
    h.ctx.session.lockKey(h.entry.id)
    vi.mocked(openUnlockModal).mockImplementation(async () => success ? h.ctx.session.unlock(h.entry, PHRASE) : false)
    const done = openEditMessageModal(h.ctx, CHANNEL, MESSAGE)
    if (success) {
      const m = await modal(h)
      expect(m.input.value).toBe(SECRET)
      m.options.onCancel()
    }
    await done
    expect(openUnlockModal).toHaveBeenCalledWith(h.ctx, h.entry)
    if (!success) expect(h.confirm).not.toHaveBeenCalled()
    expect(h.nativeEdit).not.toHaveBeenCalled()
  })

  it('recovers only the advertised historical key and authenticates before showing plaintext', async () => {
    const h = await harness()
    vi.spyOn(h.ctx.keyring, 'get').mockReturnValueOnce(undefined)
    vi.mocked(openRecoverKeyModal).mockImplementation(async (_ctx, parts, channelId, authenticate) => {
      expect(parts.keyId).toBe(h.entry.id)
      expect(channelId).toBe(CHANNEL)
      await authenticate(h.key)
      return true
    })
    const done = openEditMessageModal(h.ctx, CHANNEL, MESSAGE)
    const m = await modal(h)
    expect(openRecoverKeyModal).toHaveBeenCalledOnce()
    expect(m.input.value).toBe(SECRET)
    m.options.onCancel()
    await done
  })

  it('does not open an editor after cancelled recovery', async () => {
    const h = await harness()
    vi.spyOn(h.ctx.keyring, 'get').mockReturnValueOnce(undefined)
    vi.mocked(openRecoverKeyModal).mockResolvedValue(false)
    await openEditMessageModal(h.ctx, CHANNEL, MESSAGE)
    expect(h.confirm).not.toHaveBeenCalled()
    expect(h.nativeEdit).not.toHaveBeenCalled()
  })

  it('deduplicates concurrent action, record, dispatcher and manual launches', async () => {
    const h = await harness()
    applyEditComposerPatch(h.ctx)
    h.actions.startEditMessage(CHANNEL, MESSAGE, h.record.content, 'key')
    h.actions.startEditMessageRecord(CHANNEL, h.record, 'menu')
    h.dispatcher.dispatch({ type: 'MESSAGE_START_EDIT', channelId: CHANNEL, messageId: MESSAGE })
    await openEditMessageModal(h.ctx, CHANNEL, MESSAGE)
    const m = await modal(h)
    expect(h.confirm).toHaveBeenCalledOnce()
    m.options.onCancel()
  })

  it.each(['lock', 'stop', 'source', 'replacement key'])('synchronously clears visible plaintext on %s and prevents save', async change => {
    const h = await harness()
    const onRelock = vi.spyOn(h.ctx.session, 'onRelock')
    const done = openEditMessageModal(h.ctx, CHANNEL, MESSAGE)
    const m = await modal(h)
    const remove = vi.spyOn(window, 'removeEventListener')
    if (change === 'lock') h.ctx.session.lockKey(h.entry.id)
    if (change === 'stop') h.stop()
    if (change === 'source') h.getMessage.mockReturnValue({ content: 'changed remotely' })
    if (change === 'replacement key') await h.ctx.session.unlock(h.entry, PHRASE)
    h.ctx.forceRerender()
    expect(m.input.value).toBe('')
    expect(m.input.disabled).toBe(true)
    expect(m.content.props.draft.value).toBe('')
    m.options.onConfirm()
    await done
    expect(h.nativeEdit).not.toHaveBeenCalled()
    expect(onRelock).not.toHaveBeenCalled()
    m.unmount()
    expect(remove).toHaveBeenCalledWith('bp-rerender', expect.any(Function))
  })

  it.each(['stop', 'source', 'lock'])('does not open a late modal after %s during decryption', async change => {
    const h = await harness()
    const decrypt = cipher.decryptText
    vi.spyOn(cipher, 'decryptText').mockImplementationOnce(async (...args) => {
      const value = await decrypt(...args)
      if (change === 'stop') h.stop()
      if (change === 'source') h.getMessage.mockReturnValue({ content: 'changed remotely' })
      if (change === 'lock') h.ctx.session.lockKey(h.entry.id)
      return value
    })
    await openEditMessageModal(h.ctx, CHANNEL, MESSAGE)
    expect(h.confirm).not.toHaveBeenCalled()
    expect(h.nativeEdit).not.toHaveBeenCalled()
  })

  it('does not open a late modal after disposal during unlock', async () => {
    const h = await harness()
    h.ctx.session.lockKey(h.entry.id)
    let complete!: (ok: boolean) => void
    vi.mocked(openUnlockModal).mockImplementation(() => new Promise(resolve => { complete = resolve }))
    const done = openEditMessageModal(h.ctx, CHANNEL, MESSAGE)
    h.stop()
    await done
    complete(true)
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(h.confirm).not.toHaveBeenCalled()
    expect(h.nativeEdit).not.toHaveBeenCalled()
  })

  it.each(['source', 'key', 'health'])('rechecks %s at save even without a rerender event', async change => {
    const h = await harness()
    const done = openEditMessageModal(h.ctx, CHANNEL, MESSAGE)
    const m = await modal(h)
    if (change === 'source') h.getMessage.mockReturnValue({ content: 'changed' })
    if (change === 'key') h.ctx.session.stop()
    if (change === 'health') h.ctx.modules.failed.push('edit: hook unavailable')
    m.options.onConfirm()
    await done
    expect(h.nativeEdit).not.toHaveBeenCalled()
  })

  it('preserves both native plain entry signatures and unrelated dispatches', async () => {
    const h = await harness()
    h.getMessage.mockReturnValue({ content: 'public message' })
    applyEditComposerPatch(h.ctx)
    const source = { keyboard: true }
    h.actions.startEditMessage(CHANNEL, MESSAGE, 'public draft', source)
    expect(h.nativeStart).toHaveBeenCalledWith(CHANNEL, MESSAGE, 'public draft', source)
    const record = { id: MESSAGE, content: 'public record' }
    h.actions.startEditMessageRecord(CHANNEL, record, source)
    expect(h.nativeRecord).toHaveBeenCalledWith(CHANNEL, record, source)
    expect(h.nativeRecord.mock.calls[0]![1]).toBe(record)
    const event = { type: 'UNRELATED', secret: 'not ours' }
    expect(h.dispatcher.dispatch(event)).toBe('native dispatch')
    expect(h.dispatch.mock.calls[2]![0]).toBe(event)
    expect(h.confirm).not.toHaveBeenCalled()
  })

  it.each(['store missing', 'message missing', 'malformed wire', 'bad record', 'broken edit health'])('blocks %s without exposing the raw native editor', async failure => {
    const h = await harness()
    if (failure === 'store missing') h.ctx.modules.MessageStore = null
    if (failure === 'message missing') h.getMessage.mockReturnValue(null)
    if (failure === 'malformed wire') h.getMessage.mockReturnValue({ content: '🦇<https://betterprivacy.app/m#broken>' })
    if (failure === 'broken edit health') h.ctx.modules.failed.push('edit: unavailable')
    applyEditComposerPatch(h.ctx)
    h.actions.startEditMessageRecord(CHANNEL, failure === 'bad record' ? {} : h.record, 'menu')
    expect(h.nativeRecord).not.toHaveBeenCalled()
    expect(h.confirm).not.toHaveBeenCalled()
    expect(h.toasts).toHaveBeenCalled()
  })

  it('retries missing native entry hooks idempotently and releases them on disposal', async () => {
    const h = await harness()
    delete (h.actions as any).startEditMessage
    delete (h.actions as any).startEditMessageRecord
    h.ctx.modules.Dispatcher = null
    applyEditComposerPatch(h.ctx)
    expect(h.ctx.modules.failed).toContain('editComposer: edit entry hooks unavailable')
    h.actions.startEditMessage = h.nativeStart
    h.actions.startEditMessageRecord = h.nativeRecord
    h.ctx.modules.Dispatcher = h.dispatcher
    applyEditComposerPatch(h.ctx)
    const patched = h.actions.startEditMessageRecord
    applyEditComposerPatch(h.ctx)
    expect(h.actions.startEditMessageRecord).toBe(patched)
    h.stop()
    expect(h.actions.startEditMessageRecord).toBe(h.nativeRecord)
    expect(h.actions.startEditMessage).toBe(h.nativeStart)
    expect(h.dispatcher.dispatch).toBe(h.dispatch)
  })

  it('catches decrypt and modal exceptions without opening native editing or sending', async () => {
    const h = await harness()
    vi.spyOn(cipher, 'decryptText').mockRejectedValueOnce(new Error('authentication failure'))
    await openEditMessageModal(h.ctx, CHANNEL, MESSAGE)
    expect(h.confirm).not.toHaveBeenCalled()
    h.confirm.mockImplementationOnce(() => { throw new Error('UI failure') })
    await openEditMessageModal(h.ctx, CHANNEL, MESSAGE)
    expect(h.nativeEdit).not.toHaveBeenCalled()
    expect(h.nativeStart).not.toHaveBeenCalled()
    expect(h.toasts).toHaveBeenCalledTimes(2)
  })
})

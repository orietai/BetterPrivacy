import { afterEach, describe, expect, it, vi } from 'vitest'
import * as kdf from '../src/crypto/kdf'
import { createKeyring } from '../src/core/keyring'
import { createSession } from '../src/core/session'
import { createSettingsStore } from '../src/settings'
import { buildSettingsPanel } from '../src/ui/KeyManagerPanel'
import { applyContextMenuPatches } from '../src/patches/contextMenu'
import { t } from '../src/i18n'
import type { PluginContext } from '../src/types'

const phrase = 'synthetic import lifecycle phrase'
const channel = '123456789012345678'
const cleanups: Array<() => void> = []
afterEach(() => { cleanups.splice(0).forEach(fn => fn()); vi.restoreAllMocks(); vi.unstubAllGlobals() })
function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>(r => { resolve = r })
  return { promise, resolve }
}
function nodes(tree: any): any[] {
  if (!tree || typeof tree !== 'object') return []
  if (Array.isArray(tree)) return tree.flatMap(nodes)
  return [tree, ...nodes(tree.props?.children)]
}
async function harness(surface: string) {
  const disk = new Map<string, any>(), menus = new Map<string, any>()
  let modal: any
  const toast = vi.fn()
  vi.stubGlobal('BdApi', {
    Data: { load: (_: string, key: string) => disk.get(key), save: (_: string, key: string, value: any) => disk.set(key, structuredClone(value)) },
    React: { createElement: (type: any, props: any, ...children: any[]) => ({ type, props: { ...props, children } }), useReducer: () => [0, vi.fn()], useState: () => [null, vi.fn()] },
    UI: { showToast: toast, showConfirmationModal: (_: string, content: any, options: any) => { modal = { content, options } } },
    ContextMenu: { patch: (name: string, callback: any) => { menus.set(name, callback); return () => {} }, buildItem: (item: any) => item },
  })
  const keyring = createKeyring(), settings = createSettingsStore(), session = createSession(keyring, settings)
  const entry = await keyring.create('imported', phrase, channel)
  const blob = keyring.exportBlob(entry.id)
  keyring.remove(entry.id)
  const ctx = { keyring, session, settings, modules: { failed: [] }, disposers: [], forceRerender: vi.fn() } as unknown as PluginContext
  cleanups.push(() => { ctx.disposers.forEach(fn => fn()); session.stop() })
  if (surface === 'settings') {
    const root = buildSettingsPanel(ctx)
    const panel = root.type(root.props)
    nodes(panel).find(node => node.type === 'button' && node.props.children.includes(t('km.importKey'))).props.onClick()
    Object.assign(modal.content.props.state, { blob, pass: phrase })
  } else {
    applyContextMenuPatches(ctx)
    const tree = { props: { children: [] as any[] } }
    menus.get('message')(tree, { message: { attachments: [{ filename: 'synthetic.bpenc' }] } })
    tree.props.children.find(item => item.id === 'bp-import-key').action()
    modal.content.props.children.find((node: any) => node.type === 'textarea').props.onChange({ target: { value: blob } })
    modal.content.props.children.find((node: any) => node.type === 'input').props.onChange({ target: { value: phrase } })
  }
  const actual = kdf.deriveKeyMaterial
  function pause(phase: number) {
    const started = deferred(), release = deferred()
    let count = 0
    vi.spyOn(kdf, 'deriveKeyMaterial').mockImplementation(async (...args) => {
      if (++count === phase) { started.resolve(); await release.promise }
      return actual(...args)
    })
    return { started, release }
  }
  return { ctx, entry, modal, pause, toast }
}

describe('import modal callbacks', () => {
  for (const surface of ['settings', 'context menu']) {
    for (const phase of [1, 2]) {
      it.each(['lock', 'stop', 'cancel', 'dispose'])(`${surface}: %s during ${phase === 1 ? 'import' : 'unlock'} cannot reopen the key`, async action => {
        const h = await harness(surface)
        const gate = h.pause(phase)
        const imported = deferred()
        const original = h.ctx.keyring.importBlob.bind(h.ctx.keyring)
        vi.spyOn(h.ctx.keyring, 'importBlob').mockImplementation(async (...args) => {
          try { return await original(...args) } finally { imported.resolve() }
        })
        const unlock = vi.spyOn(h.ctx.session, 'unlock')
        h.modal.options.onConfirm()
        h.modal.options.onCloseCallback()
        await gate.started.promise
        if (action === 'lock') h.ctx.session.lockAll('manual')
        if (action === 'stop') h.ctx.session.stop()
        if (action === 'cancel') h.modal.options.onCancel()
        if (action === 'dispose') h.ctx.disposers.forEach(fn => fn())
        gate.release.resolve()
        await imported.promise
        if (phase === 2) await unlock.mock.results[0]!.value
        // Allow the real callback's promise continuations to complete.
        await new Promise<void>(resolve => setTimeout(resolve, 0))
        expect(h.ctx.session.isUnlocked(h.entry.id)).toBe(false)
        if (phase === 1) expect(unlock).not.toHaveBeenCalled()
        expect(h.ctx.forceRerender).not.toHaveBeenCalled()
      })
    }
    it(`${surface}: normal confirm uses its phrase snapshot and survives normal modal close`, async () => {
      const h = await harness(surface)
      const gate = h.pause(1)
      h.modal.options.onConfirm()
      h.modal.options.onCloseCallback()
      await gate.started.promise
      if (surface === 'settings') h.modal.content.props.state.pass = 'changed phrase'
      else h.modal.content.props.children.find((node: any) => node.type === 'input').props.onChange({ target: { value: 'changed phrase' } })
      gate.release.resolve()
      await vi.waitFor(() => expect(h.ctx.session.isUnlocked(h.entry.id)).toBe(true))
      expect(h.ctx.forceRerender).toHaveBeenCalledOnce()
    })
  }
})

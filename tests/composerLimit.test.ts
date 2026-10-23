import { afterEach, describe, expect, it, vi } from 'vitest'
import { applyComposerLimitPatch } from '../src/patches/composerLimit'
import { resolveModules } from '../src/modules'
import type { PluginContext } from '../src/types'

afterEach(() => { vi.unstubAllGlobals() })

function composer(encrypted: boolean, failed: string[] = []) {
  const validator = {
    validate(options: any) {
      // These are the actual stable markers used to locate the current validator.
      const labels = ['Message Too Long Alert', 'MESSAGE_LENGTH_UPSELL']
      return { valid: options.content.length <= 2000 && !options.slowmode, options, labels }
    },
  }
  vi.stubGlobal('BdApi', {
    Webpack: {
      getModule: () => null,
      *getWithKey() { yield validator; yield 'validate' },
    },
  })
  const render = { render: (props: any) => props }
  const ctx = {
    modules: { ChannelTextArea: { type: render }, failed },
    keyring: { isEncryptModeOn: () => encrypted },
    disposers: [],
    patcher: {
      instead(_caller: string, module: any, method: string, callback: any) {
        const original = module[method]
        module[method] = function (...args: any[]) { return callback(this, args, original) }
        return () => { module[method] = original }
      },
      before(_caller: string, module: any, method: string, callback: any) {
        const original = module[method]
        module[method] = function (...args: any[]) { callback(this, args); return original.apply(this, args) }
        return () => { module[method] = original }
      },
    },
  } as unknown as PluginContext
  applyComposerLimitPatch(ctx)
  return { validator, render }
}

describe('first-release composer integration', () => {
  it('allows splitting long encrypted text without bypassing slowmode or mutating the real message', () => {
    const { validator } = composer(true)
    const options = { content: 'a'.repeat(6000), channel: { id: '123' }, slowmode: true }
    const checked = validator.validate(options)
    expect(checked.options.content.length).toBe(2000)
    expect(checked.valid).toBe(false)
    expect(options.content.length).toBe(6000)
    expect(validator.validate({ ...options, slowmode: false }).valid).toBe(true)
  })

  it.each([
    [false, []],
    [true, ['send: MessageActions unavailable']],
    [true, ['edit: editMessage unavailable']],
    [true, ['editComposer: unavailable']],
    [true, ['MessageStore']],
  ])('keeps the native limit when encryption is %s and failures are %j', (encrypted, failed) => {
    const { validator, render } = composer(encrypted as boolean, failed as string[])
    const options = { content: 'a'.repeat(6000), channel: { id: '123' } }
    expect(validator.validate(options).valid).toBe(false)
    expect(validator.validate(options).options).toBe(options)
    expect(render.render({ channel: { id: '123' }, uploadPromptCharacterCount: 4000 }).uploadPromptCharacterCount).toBe(4000)
  })

  it('raises the current paste prompt only in encrypted channels', () => {
    const { render } = composer(true)
    const props = { channel: { id: '123' }, uploadPromptCharacterCount: 4000 }
    expect(render.render(props).uploadPromptCharacterCount).toBe(1_000_000)
  })

  it('locates message content through current props, not the obsolete CSS-name marker', () => {
    const current = { type: function (props: any) { return [props.contentRef, props.onUpdate, props.compact, props.message] } }
    const obsolete = { type: function () { return 'messageContent' } }
    const candidates = [obsolete, current]
    vi.stubGlobal('BdApi', { Webpack: {
      getModule: (filter: any) => candidates.find(filter),
      getStore: () => null,
      getByKeys: () => null,
      *getWithKey() {},
    } })
    expect(resolveModules().MessageContent).toEqual({ module: current, method: 'type' })
    candidates.pop()
    expect(resolveModules().MessageContent).toBeNull()
  })
})

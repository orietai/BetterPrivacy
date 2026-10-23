import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildSettingsPanel } from '../src/ui/KeyManagerPanel'
import { DEFAULT_SETTINGS } from '../src/settings'
import type { KeyEntry, PluginContext } from '../src/types'
import { injectStyles } from '../src/ui/indicators'
import { setLocale, t } from '../src/i18n'

afterEach(() => { setLocale('en'); vi.unstubAllGlobals() })

function settingsPanel(lockdown = true, available = true, keys: KeyEntry[] = []) {
  let settings = { ...DEFAULT_SETTINGS, lockdown }
  const set = vi.fn((patch: any) => { settings = { ...settings, ...patch } })
  const forceRerender = vi.fn()
  // Deliberately assert against the host API component, not an invented
  // popup implementation. Native Electron popup behavior needs a live test.
  const DropdownInput = function HostDropdownInput() {}
  vi.stubGlobal('BdApi', {
    Components: available ? { DropdownInput } : {},
    React: {
      createElement: (type: any, props: any, ...children: any[]) => ({ type, props: { ...props, children } }),
      useReducer: () => [0, vi.fn()],
      useState: () => [null, vi.fn()],
    },
  })
  const ctx = { settings: { get: () => settings, set }, keyring: { list: () => keys },
    modules: { failed: [] }, forceRerender } as unknown as PluginContext
  const render = () => {
    const nodes: any[] = []
    const visit = (node: any): void => {
      if (Array.isArray(node)) { node.forEach(visit); return }
      if (!node || typeof node !== 'object') return
      nodes.push(node)
      if (typeof node.type === 'function' && node.type !== DropdownInput) visit(node.type(node.props))
      else visit(node.props?.children)
    }
    visit(buildSettingsPanel(ctx))
    return nodes
  }
  const dropdowns = () => render().filter(node => node.type === DropdownInput)
  return { render, dropdowns, set, forceRerender, settings: () => settings }
}

describe('settings dropdown host integration', () => {
  it.each(['en', 'tr', 'ru'] as const)('names all five settings inputs with their corresponding translated Row labels in %s', lang => {
    setLocale(lang)
    const nodes = settingsPanel().render()
    const inputs = nodes.filter(node => node.type === 'input')
    expect(inputs).toHaveLength(5)
    expect(inputs.map(input => input.props['aria-label'])).toEqual([
      t('km.lockdown'), t('km.timeout'), t('km.indicator'), t('km.maxAuto'), t('km.memBudget'),
    ])
    const rows = nodes.filter(node => node.props?.label && node.props?.children?.some((child: any) => child?.type === 'input'))
    expect(rows).toHaveLength(5)
    for (const row of rows) {
      const input = row.props.children.find((child: any) => child?.type === 'input')
      expect(input.props['aria-label']).toBe(row.props.label)
    }
  })

  it('uses the same BetterDiscord DropdownInput for language and relock scope', () => {
    const h = settingsPanel()
    const fields = h.dropdowns()
    expect(fields).toHaveLength(2)
    expect(fields[0].type).toBe(fields[1].type)
    expect(fields[0].props.options.map((option: any) => option.value)).toEqual(['auto', 'en', 'tr', 'ru'])
    expect(fields[1].props.options.map((option: any) => option.value)).toEqual(['all', 'previousChannelOnly'])
    expect(h.render().some(node => node.type === 'select' || node.props?.role === 'radiogroup')).toBe(false)
  })

  it('accepts a host value callback, persists language and refreshes existing UI', () => {
    const h = settingsPanel()
    h.dropdowns()[0].props.onChange('tr')
    expect(h.set).toHaveBeenCalledWith({ language: 'tr' })
    expect(h.forceRerender).toHaveBeenCalledOnce()
    expect(h.dropdowns()[0].props.value).toBe('tr')
  })

  it('persists scope changes using the same callback contract', () => {
    const h = settingsPanel()
    h.dropdowns()[1].props.onChange('previousChannelOnly')
    expect(h.set).toHaveBeenCalledWith({ relockScope: 'previousChannelOnly' })
    expect(h.dropdowns()[1].props.value).toBe('previousChannelOnly')
    expect(h.forceRerender).not.toHaveBeenCalled()
  })

  it('keeps component identity stable and does not write settings when opening or re-rendering', () => {
    const h = settingsPanel()
    const before = h.dropdowns()
    const after = h.dropdowns()
    expect(after[0].type).toBe(before[0].type)
    expect(after[1].type).toBe(before[1].type)
    expect(h.set).not.toHaveBeenCalled()
    before[0].props.onChange('auto')
    before[1].props.onChange('all')
    expect(h.set).not.toHaveBeenCalled()
  })

  it('rejects DOM events and unsupported values rather than saving undefined', () => {
    const h = settingsPanel()
    const fields = h.dropdowns()
    fields[0].props.onChange({ target: { value: 'tr' } })
    fields[0].props.onChange('not-a-language')
    fields[1].props.onChange('tr')
    expect(h.set).not.toHaveBeenCalled()
  })

  it('shows relock scope only after enabling lockdown', () => {
    const h = settingsPanel(false)
    expect(h.dropdowns()).toHaveLength(1)
    const checkbox = h.render().find(node => node.type === 'input' && node.props.type === 'checkbox')
    checkbox.props.onChange({ target: { checked: true } })
    expect(h.settings().lockdown).toBe(true)
    expect(h.dropdowns()).toHaveLength(2)
  })

  it('reports an unavailable host component without silently reintroducing native selects', () => {
    const h = settingsPanel(true, false)
    expect(h.dropdowns()).toHaveLength(0)
    expect(h.render().filter(node => node.props?.role === 'status')).toHaveLength(2)
    expect(h.render().some(node => node.type === 'select')).toBe(false)
    expect(h.set).not.toHaveBeenCalled()
  })
})

describe('key manager responsive layout', () => {
  it('keeps all key fields and actions available without an unbreakable action row', () => {
    const label = 'channel:123456789012345678-' + 'a'.repeat(200)
    const scope = '123456789012345678'
    const h = settingsPanel(true, true, [{ id: 'AAAAAAAA', label, scope,
      salt: 'salt', check: 'check', createdAt: 1 }])
    const nodes = h.render()
    const fields = nodes.filter(node => node.type === 'td' && node.props['data-label'])
    expect(fields).toHaveLength(4)
    expect(fields[0].props.children).toContain(label)
    expect(fields[2].props.children).toContain(scope)
    expect(nodes.find(node => node.type === 'table').props.role).toBe('table')
    const actions = nodes.find(node => node.props?.className === 'bp-key-actions')
    expect(actions.props.children).toHaveLength(2)
    actions.props.children.forEach((button: any) => expect(typeof button.props.onClick).toBe('function'))
    expect(nodes.some(node => node.props?.style?.whiteSpace === 'nowrap')).toBe(false)
    expect(nodes.find(node => node.props?.className === 'bp-key-toolbar')).toBeDefined()
  })

  it('keeps the empty state spanning the entire table', () => {
    const cell = settingsPanel().render().find(node => node.props?.className === 'bp-hint bp-key-empty')
    expect(cell.props.colSpan).toBe(5)
    expect(cell.props.children[0].length).toBeGreaterThan(0)
  })

  it('adapts to the panel container rather than the full Discord window', () => {
    const addStyle = vi.fn()
    vi.stubGlobal('BdApi', { DOM: { addStyle } })
    vi.stubGlobal('document', { documentElement: { style: { setProperty: vi.fn() } } })
    injectStyles({ settings: { get: () => DEFAULT_SETTINGS, onChange: vi.fn() } } as unknown as PluginContext)
    const css = addStyle.mock.calls[0][1] as string
    expect(css).toContain('container: bp-settings / inline-size')
    expect(css).toContain('@container bp-settings (max-width: 620px)')
    expect(css).toContain('grid-template-columns: repeat(2, minmax(0, 1fr))')
    expect(css).toContain('table-layout: fixed')
    expect(css).toContain('overflow-wrap: anywhere')
    expect(css).toContain('content: attr(data-label)')
    expect(css).toMatch(/\.bp-key-actions, \.bp-key-toolbar\s*\{[^}]*flex-wrap: wrap/)
  })
})

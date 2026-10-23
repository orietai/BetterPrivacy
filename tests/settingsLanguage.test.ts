import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildSettingsPanel } from '../src/ui/KeyManagerPanel'
import { DEFAULT_SETTINGS } from '../src/settings'
import type { PluginContext } from '../src/types'

afterEach(() => { vi.unstubAllGlobals() })

function settingsPanel() {
  let settings = { ...DEFAULT_SETTINGS }
  const set = vi.fn((patch: any) => { settings = { ...settings, ...patch } })
  const forceRerender = vi.fn()
  vi.stubGlobal('BdApi', { React: {
    createElement: (type: any, props: any, ...children: any[]) => ({ type, props: { ...props, children } }),
    useReducer: () => [0, vi.fn()],
    useState: () => [null, vi.fn()],
  } })
  const ctx = { settings: { get: () => settings, set }, keyring: { list: () => [] },
    modules: { failed: [] }, forceRerender } as unknown as PluginContext
  const render = () => {
    const element = buildSettingsPanel(ctx)
    const root = element.type(element.props)
    const nodes: any[] = []
    const visit = (node: any): void => {
      if (Array.isArray(node)) { node.forEach(visit); return }
      if (!node || typeof node !== 'object') return
      nodes.push(node)
      visit(node.props?.children)
    }
    visit(root)
    return nodes
  }
  return { render, set, forceRerender }
}

describe('settings language selection without native popup menus', () => {
  it('shows all four languages as directly selectable native radio controls', () => {
    const h = settingsPanel()
    const nodes = h.render()
    const radios = nodes.filter(node => node.type === 'input' && node.props.name === 'bp-plugin-language')
    expect(radios.map(node => node.props.value)).toEqual(['auto', 'en', 'tr', 'ru'])
    expect(radios.every(node => node.props.type === 'radio')).toBe(true)
    expect(nodes.some(node => node.props?.role === 'radiogroup')).toBe(true)
    expect(nodes.some(node => node.type === 'select')).toBe(false)
  })

  it('persists a selection and refreshes the checked state without opening a dropdown', () => {
    const h = settingsPanel()
    const turkish = h.render().find(node => node.type === 'input' && node.props.value === 'tr')
    turkish.props.onChange()
    expect(h.set).toHaveBeenCalledWith({ language: 'tr' })
    expect(h.forceRerender).toHaveBeenCalledOnce()
    const selected = h.render().filter(node => node.props?.name === 'bp-plugin-language' && node.props.checked)
    expect(selected.map(node => node.props.value)).toEqual(['tr'])
  })
})

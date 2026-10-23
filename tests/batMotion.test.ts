import { readFileSync } from 'node:fs'
import { JSDOM } from 'jsdom'
import { afterEach, describe, expect, it, vi } from 'vitest'

const script = readFileSync(new URL('../site/assets/bat-motion.js', import.meta.url), 'utf8')
const css = readFileSync(new URL('../site/assets/bat-motion.css', import.meta.url), 'utf8')
const windows: any[] = []
afterEach(() => { windows.splice(0).forEach(w => w.close()); vi.useRealTimers() })
function setup({ reduced = false, mobile = false, seen = false, storageBlocked = false } = {}) {
  const dom = new JSDOM('<main><input id="phrase"><button id="go">Decrypt</button></main>', {
    url: 'https://betterprivacy.app/m/', runScripts: 'outside-only', pretendToBeVisual: true,
  })
  const w: any = dom.window
  windows.push(w)
  let preferenceListener: () => void
  const preference = { matches: reduced, addEventListener: (_name: string, fn: () => void) => { preferenceListener = fn } }
  w.matchMedia = (query: string) => query.includes('reduced-motion') ? preference : { matches: mobile }
  if (seen) w.sessionStorage.setItem('bp-bat-welcome', 'seen')
  if (storageBlocked) Object.defineProperty(w, 'sessionStorage', { get() { throw new Error('denied') } })
  w.eval(script)
  w.document.dispatchEvent(new w.Event('DOMContentLoaded'))
  return { w, doc: w.document, button: w.document.getElementById('go'),
    reduce() { preference.matches = true; preferenceListener!() } }
}
async function mutations() { await Promise.resolve(); await Promise.resolve() }

describe('bat brand motion', () => {
  it.each([false, true])('runs one non-blocking bounded welcome, mobile=%s', mobile => {
    vi.useFakeTimers()
    const h = setup({ mobile })
    expect(h.doc.querySelectorAll('.bp-bat-flight')).toHaveLength(mobile ? 5 : 10)
    const layer = h.doc.querySelector('.bp-bat-welcome')
    expect(layer.getAttribute('aria-hidden')).toBe('true')
    expect(layer.hasAttribute('inert')).toBe(true)
    expect(h.doc.querySelector('main').hasAttribute('inert')).toBe(false)
    expect(h.button.disabled).toBe(false)
    expect(layer.querySelectorAll('svg')).toHaveLength(mobile ? 5 : 10)
    expect(layer.querySelectorAll('.bp-bat-wing')).toHaveLength(mobile ? 10 : 20)
    vi.advanceTimersByTime(1250)
    expect(h.doc.querySelector('.bp-bat-welcome')).toBeNull()
    expect(h.w.sessionStorage.getItem('bp-bat-welcome')).toBe('seen')
    expect(h.w.localStorage.length).toBe(0)
  })
  it.each(['pointerdown', 'keydown'])('dismisses the welcome immediately on %s without consuming input', event => {
    const h = setup()
    const interaction = new h.w.Event(event, { cancelable: true, bubbles: true })
    h.doc.getElementById('phrase').dispatchEvent(interaction)
    expect(interaction.defaultPrevented).toBe(false)
    expect(h.doc.querySelector('.bp-bat-welcome')).toBeNull()
  })
  it('skips repeat welcomes and still works when session storage is unavailable', () => {
    expect(setup({ seen: true }).doc.querySelector('.bp-bat-welcome')).toBeNull()
    expect(setup({ storageBlocked: true }).doc.querySelector('.bp-bat-welcome')).not.toBeNull()
  })
  it('follows actual busy state and label replacement without changing button behavior', async () => {
    const h = setup({ seen: true })
    h.button.disabled = true
    await mutations()
    expect(h.button.querySelectorAll('.bp-bat-working')).toHaveLength(1)
    expect(h.button.querySelectorAll('.bp-bat-working svg')).toHaveLength(1)
    h.button.textContent = 'Çöz'
    await mutations()
    expect(h.button.querySelectorAll('.bp-bat-working')).toHaveLength(1)
    expect(h.button.disabled).toBe(true)
    h.button.disabled = false
    await mutations()
    expect(h.button.querySelector('.bp-bat-working')).toBeNull()
    expect(h.button.textContent).toBe('Çöz')
  })
  it('does not animate with reduced motion and cancels on a live preference change', async () => {
    const reduced = setup({ reduced: true })
    reduced.button.disabled = true
    await mutations()
    expect(reduced.doc.querySelector('.bp-bat-welcome,.bp-bat-working')).toBeNull()
    const h = setup()
    h.button.disabled = true
    await mutations()
    h.reduce()
    expect(h.doc.querySelector('.bp-bat-welcome,.bp-bat-working')).toBeNull()
  })
  it('cleans up on pagehide and resumes observers, not the intro, after back/forward restore', async () => {
    const h = setup()
    h.button.disabled = true
    await mutations()
    h.w.dispatchEvent(new h.w.Event('pagehide'))
    expect(h.doc.querySelector('.bp-bat-welcome,.bp-bat-working')).toBeNull()
    h.button.disabled = false
    h.button.disabled = true
    await mutations()
    expect(h.doc.querySelector('.bp-bat-working')).toBeNull()
    h.w.dispatchEvent(new h.w.PageTransitionEvent('pageshow', { persisted: true }))
    expect(h.doc.querySelector('.bp-bat-welcome')).toBeNull()
    expect(h.doc.querySelectorAll('.bp-bat-working')).toHaveLength(1)
  })
  it('stops decorative work while the tab is hidden and resumes only an ongoing operation', async () => {
    const h = setup()
    h.button.disabled = true
    await mutations()
    Object.defineProperty(h.doc, 'hidden', { value: true, configurable: true })
    h.doc.dispatchEvent(new h.w.Event('visibilitychange'))
    expect(h.doc.querySelector('.bp-bat-welcome,.bp-bat-working')).toBeNull()
    Object.defineProperty(h.doc, 'hidden', { value: false, configurable: true })
    h.doc.dispatchEvent(new h.w.Event('visibilitychange'))
    expect(h.doc.querySelector('.bp-bat-welcome')).toBeNull()
    expect(h.doc.querySelectorAll('.bp-bat-working')).toHaveLength(1)
  })
  it('ships motion on all entry routes with no overlay input interception', () => {
    for (const route of ['index.html', 'create/index.html', 'm/index.html']) {
      const html = readFileSync(new URL('../site/' + route, import.meta.url), 'utf8')
      expect(html).toContain('src="/assets/bat-motion.js" defer')
      expect(html).toContain('href="/assets/bat-motion.css"')
    }
    expect(css).toContain('pointer-events: none')
    expect(css).toContain('prefers-reduced-motion: reduce')
    expect(css).not.toContain('transition: all')
  })
})

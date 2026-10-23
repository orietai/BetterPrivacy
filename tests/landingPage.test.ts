import { readFileSync } from 'node:fs'
import { JSDOM, VirtualConsole } from 'jsdom'
import { describe, expect, it } from 'vitest'

const html = readFileSync(new URL('../site/index.html', import.meta.url), 'utf8')

function landing(reduced = false) {
  const errors: string[] = []
  const console = new VirtualConsole()
  console.on('jsdomError', (error: unknown) => errors.push(String(error)))
  const dom = new JSDOM(html, {
    url: 'http://localhost:4173/', runScripts: 'dangerously',
    pretendToBeVisual: true, virtualConsole: console,
    beforeParse(w: any) {
      w.matchMedia = (query: string) => ({ matches: query.includes('reduced-motion') ? reduced : false })
      w.requestAnimationFrame = () => 1
      w.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} }
      w.HTMLCanvasElement.prototype.getContext = () => ({
        setTransform() {}, fillText() {}, drawImage() {}, clearRect() {},
      })
    },
  })
  return { dom, doc: dom.window.document, errors }
}

describe('restored animated landing page', () => {
  it('retains the original illustration, lens, navigation and reveal controls', () => {
    const { dom, doc, errors } = landing()
    try {
      expect(errors).toEqual([])
      for (const id of ['lens', 'demo', 'chat', 'phrase-card', 'fxc', 'sredact', 'sbat']) {
        expect(doc.getElementById(id)).not.toBeNull()
      }
      expect(doc.querySelector('.hero-grid')).not.toBeNull()
      expect(doc.querySelector('.nav .nav-dl')?.getAttribute('href')).toBe('#install')
      expect(doc.querySelector('a[href="/create/"]')).not.toBeNull()
      expect(doc.querySelector('a[href="/m/"]')).not.toBeNull()
      expect(doc.querySelectorAll('link[href*="fonts.googleapis"]')).toHaveLength(0)
      expect(doc.querySelector('meta[name="author"]')?.getAttribute('content')).toBe('oriet.ai')
      const credit = doc.querySelector('footer .oriet-credit-link')
      expect(credit?.getAttribute('href')).toBe('https://oriet.ai/')
      expect(credit?.querySelector('img')?.getAttribute('src')).toBe('/assets/oriet-logo.svg')
    } finally { dom.window.close() }
  })

  it('lets the visitor reveal and re-lock the statement without blocking input', () => {
    const { dom, doc } = landing()
    try {
      const button = doc.getElementById('sbat') as HTMLButtonElement
      button.click()
      expect(button.getAttribute('aria-pressed')).toBe('true')
      expect(doc.getElementById('statement')?.classList.contains('on')).toBe(true)
      button.click()
      expect(button.getAttribute('aria-pressed')).toBe('false')
      expect(doc.getElementById('srtext')?.textContent).toBe("what it can't see.")
    } finally { dom.window.close() }
  })

  it('shows the complete demo and content without movement when reduced motion is enabled', () => {
    const { dom, doc, errors } = landing(true)
    try {
      expect(errors).toEqual([])
      expect(doc.getElementById('chat')?.classList.contains('armed')).toBe(true)
      expect((doc.getElementById('msg2') as HTMLElement).hidden).toBe(false)
      expect(doc.getElementById('statement')?.classList.contains('on')).toBe(true)
      expect([...doc.querySelectorAll('.reveal')].every(el => el.classList.contains('in'))).toBe(true)
    } finally { dom.window.close() }
  })
})

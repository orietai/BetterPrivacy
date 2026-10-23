import { readFileSync } from 'node:fs'
import { JSDOM, VirtualConsole } from 'jsdom'
import { describe, expect, it, vi } from 'vitest'

const html = readFileSync(new URL('../site/index.html', import.meta.url), 'utf8').replace(
  /<script src="\/assets\/(home-i18n|site)\.js"><\/script>/g,
  (_, name: string) => '<script>' + readFileSync(new URL('../site/assets/' + name + '.js', import.meta.url), 'utf8') + '</script>',
)

function landing(reduced = false, lang = 'en') {
  const errors: string[] = []
  const console = new VirtualConsole()
  console.on('jsdomError', (error: unknown) => errors.push(String(error)))
  const dom = new JSDOM(html, {
    url: 'http://localhost:4173/', runScripts: 'dangerously',
    pretendToBeVisual: true, virtualConsole: console,
    beforeParse(w: any) {
      w.localStorage.setItem('bp-lang', lang)
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
  it('translates real copy and preserves nested markup, animation nodes and route locale', () => {
    const { dom, doc, errors } = landing()
    try {
      const retained = [...doc.querySelectorAll('canvas, .redact, #sredact, #sbat, .sub strong, .facts code, #faq a, #install code')]
      const writes = vi.spyOn(dom.window.Storage.prototype, 'setItem')
      const events = vi.fn()
      dom.window.addEventListener('bp-language-change', events)
      for (const lang of ['tr', 'ru', 'en']) {
        ;(doc.querySelector('[data-lang="' + lang + '"]') as HTMLButtonElement).click()
        expect(doc.documentElement.lang).toBe(lang)
        expect(dom.window.localStorage.getItem('bp-lang')).toBe(lang)
        expect(doc.querySelector('[data-lang="' + lang + '"]')?.getAttribute('aria-pressed')).toBe('true')
        expect(doc.querySelectorAll('[data-lang][aria-pressed="true"]')).toHaveLength(1)
        const other = landing(true, lang)
        expect(other.doc.documentElement.lang).toBe(lang)
        other.dom.window.close()
        if (lang === 'en') continue
        expect(doc.querySelector('h1')?.textContent).toContain(lang === 'tr' ? 'Discord’dan çıkmadan.' : 'оставаясь в Discord.')
        expect(doc.querySelector('.nav a[href="#how"]')?.textContent).toBe(lang === 'tr' ? 'Nasıl çalışır' : 'Как это работает')
        expect(doc.querySelector('#faq summary')?.textContent).toBe(lang === 'tr' ? 'Eklentisi olmayanlar ne görür?' : 'Что видят люди без плагина?')
        expect(doc.querySelector('#srtext')?.textContent).toBe(lang === 'tr' ? 'göremediğini.' : 'то, чего не видит.')
        expect(doc.querySelector('#install h2')?.textContent).toBe(lang === 'tr' ? 'İki dakika, dört adım.' : 'Две минуты, четыре шага.')
        expect(doc.querySelector('footer .legal')?.textContent).not.toContain('is an independent open project')
      }
      expect(writes).toHaveBeenCalledTimes(3)
      expect(events).toHaveBeenCalledTimes(3)
      expect(dom.window.localStorage.length).toBe(1)
      expect(retained.every(node => node.isConnected)).toBe(true)
      expect(doc.querySelector('h1')?.textContent).toBe('Privacy, without leaving Discord.')
      expect(doc.querySelector('#srtext')?.textContent).toBe("what it can't see.")
      expect(errors).toEqual([])
      writes.mockRestore()
    } finally { dom.window.close() }
  })

  it('keeps reduced-motion demo state localized when switching languages', () => {
    const { dom, doc, errors } = landing(true, 'tr')
    try {
      expect(doc.querySelector('#enc-tag')?.textContent).toBe('cihazında çözüldü')
      ;(doc.querySelector('[data-lang="ru"]') as HTMLButtonElement).click()
      expect(doc.querySelector('#enc-tag')?.textContent).toBe('расшифровано на устройстве')
      expect(doc.querySelector('#hint')?.textContent).toContain('Сообщения шифруются')
      expect(doc.querySelector('#decode')?.textContent).toContain('интерактивный пример')
      expect(doc.querySelector('#srtext')?.textContent).toBe('то, чего не видит.')
      expect(doc.querySelector('#statement')?.classList.contains('on')).toBe(true)
      expect(errors).toEqual([])
    } finally { dom.window.close() }
  })

  it('uses the active locale in subsequent animated demo steps', async () => {
    vi.useFakeTimers()
    const { dom, doc, errors } = landing()
    try {
      ;(doc.querySelector('[data-lang="tr"]') as HTMLButtonElement).click()
      await vi.advanceTimersByTimeAsync(6000)
      expect(doc.querySelector('#enc-tag')?.textContent).toBe('anahtar türetildi — kanal hazır')
      ;(doc.querySelector('[data-lang="ru"]') as HTMLButtonElement).click()
      await vi.advanceTimersByTimeAsync(6000)
      expect(doc.querySelector('#enc-tag')?.textContent).toBe('расшифровано на устройстве')
      expect(doc.querySelector('#hint')?.textContent).toContain('Знающие фразу')
      expect(dom.window.localStorage.length).toBe(1)
      expect(errors).toEqual([])
    } finally { dom.window.close(); vi.useRealTimers() }
  })
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

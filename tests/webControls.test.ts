import { readFileSync } from 'node:fs'
import { JSDOM } from 'jsdom'
import { describe, expect, it } from 'vitest'

const read = (path: string) => readFileSync(new URL('../site/' + path, import.meta.url), 'utf8')
function page(path: string) {
  // Load the shipped styles in the same order as the real page, without
  // opening a browser or changing any cryptographic/interaction code.
  let html = read(path).replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '')
  html = html.replace(/<link rel="stylesheet" href="\/([^"?]+)">/g,
    (_tag, css) => '<style>' + read(css) + '</style>')
  return new JSDOM(html, { url: 'http://localhost:4173/' + path })
}

describe('shared message-tool controls', () => {
  it('uses identical button geometry on create, message decrypt and file decrypt', () => {
    const create = page('create/index.html')
    const open = page('m/index.html')
    try {
      const controls = [
        [create, '#create-submit'], [open, '#go'], [open, '#fgo'],
        [create, '#copy-link'], [open, '#copy'], [open, '#file-dl'],
        [create, '#show-phrase'], [open, '#show-reader-phrase'],
      ] as const
      for (const [dom, selector] of controls) {
        const node = dom.window.document.querySelector(selector)
        const style = dom.window.getComputedStyle(node)
        expect(node.classList.contains('button'), selector).toBe(true)
        expect(style.minHeight, selector).toBe('46px')
        expect(style.borderRadius, selector).toBe('9px')
        expect(style.fontSize, selector).toBe('14px')
        expect(style.fontWeight, selector).toBe('650')
      }
      const primary = create.window.getComputedStyle(create.window.document.getElementById('create-submit'))
      const secondary = open.window.getComputedStyle(open.window.document.getElementById('show-reader-phrase'))
      expect(primary.getPropertyValue('--control-fill')).toBe('#5abc7c')
      expect(secondary.getPropertyValue('--control-fill')).not.toBe(primary.getPropertyValue('--control-fill'))
    } finally { create.window.close(); open.window.close() }
  })

  it('keeps form submits primary and phrase visibility controls secondary', () => {
    for (const path of ['create/index.html', 'm/index.html']) {
      const dom = page(path)
      try {
        const doc = dom.window.document
        for (const submit of doc.querySelectorAll('button[type=submit]')) {
          expect(submit.classList.contains('button')).toBe(true)
          expect(submit.classList.contains('block')).toBe(true)
          expect(submit.classList.contains('secondary')).toBe(false)
        }
        const visibility = doc.querySelector('[aria-controls][aria-pressed]')
        expect(visibility.classList.contains('secondary')).toBe(true)
        expect(visibility.parentElement.classList.contains('phrase-field')).toBe(true)
      } finally { dom.window.close() }
    }
  })

  it('preserves hidden result, sharing and decryption controls', () => {
    const create = page('create/index.html')
    const open = page('m/index.html')
    try {
      expect(create.window.getComputedStyle(create.window.document.getElementById('generated')).display).toBe('none')
      expect(create.window.getComputedStyle(create.window.document.getElementById('share-native')).display).toBe('none')
      expect(open.window.getComputedStyle(open.window.document.getElementById('tools')).display).toBe('none')
      expect(open.window.document.querySelector('#file-dl[download]')).not.toBeNull()
    } finally { create.window.close(); open.window.close() }
  })
})

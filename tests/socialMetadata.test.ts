import { readFileSync } from 'node:fs'
import { JSDOM } from 'jsdom'
import { describe, it, expect } from 'vitest'

describe('public social previews', () => {
  const image = 'https://betterprivacy.app/assets/social-card.png'
  for (const page of ['index.html', 'm/index.html', 'create/index.html', 'terms/index.html']) {
    it(`${page}: static large-image metadata without private payload`, () => {
      const doc = new JSDOM(readFileSync(`site/${page}`, 'utf8')).window.document
      const meta = (key: string) => {
        const nodes = doc.querySelectorAll(`meta[property="${key}"],meta[name="${key}"]`)
        expect(nodes).toHaveLength(1)
        return nodes[0].getAttribute('content')!
      }
      expect(meta('og:site_name')).toBe('BetterPrivacy')
      expect(meta('twitter:card')).toBe('summary_large_image')
      expect(meta('og:image')).toBe(image)
      expect(meta('twitter:image')).toBe(image)
      expect(meta('og:image:width')).toBe('1200')
      expect(meta('og:image:height')).toBe('630')
      expect(meta('og:image:type')).toBe('image/png')
      expect(meta('og:image:alt')).toBeTruthy()
      for (const key of ['og:description', 'twitter:description']) {
        expect(meta(key).length).toBeGreaterThan(20)
        expect(meta(key).length).toBeLessThanOrEqual(125)
      }
      expect(new URL(meta('og:url')).hash).toBe('')
      expect(new URL(meta('og:url')).search).toBe('')
    })
  }
  it('ships a real 1200×630 PNG, not an SVG renamed as PNG', () => {
    const bytes = readFileSync('site/assets/social-card.png')
    expect(Array.from(bytes.subarray(0, 8))).toEqual([137, 80, 78, 71, 13, 10, 26, 10])
    const header = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    expect(header.getUint32(16)).toBe(1200)
    expect(header.getUint32(20)).toBe(630)
    expect(bytes.length).toBeLessThan(1_000_000)
  })
})

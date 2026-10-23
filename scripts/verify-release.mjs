import { readFile, access } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { Script } from 'node:vm'
import { JSDOM } from 'jsdom'

const root = new URL('../', import.meta.url)
const read = (path) => readFile(new URL(path, root), 'utf8')
const manifest = JSON.parse(await read('package.json'))
const lock = JSON.parse(await read('package-lock.json'))
const headers = await read('site/_headers')
for (const required of ['X-Content-Type-Options: nosniff', 'X-Frame-Options: DENY', 'Referrer-Policy: no-referrer', "frame-ancestors 'none'", "base-uri 'none'"]) {
  if (!headers.includes(required)) throw new Error(`Missing static security header: ${required}`)
}
if (lock.version !== manifest.version || lock.packages[''].version !== manifest.version) {
  throw new Error('Package/lock versions disagree')
}
const plugin = await read('dist/BetterPrivacy.plugin.js')
const downloadUrl = `https://github.com/orietai/BetterPrivacy/releases/download/v${manifest.version}/BetterPrivacy.plugin.js`
const redirects = await read('site/_redirects')
if (!redirects.split('\n').includes(`/BetterPrivacy.plugin.js ${downloadUrl} 302`)) {
  throw new Error('Legacy download must redirect to the pinned GitHub Release')
}
try {
  await access(new URL('site/BetterPrivacy.plugin.js', root))
  throw new Error('Stale plugin artifact remains in website assets')
} catch (error) { if (error.code !== 'ENOENT') throw error }
if (!plugin.startsWith('/**') || !plugin.includes(`@version ${manifest.version}\n`)) {
  throw new Error('Plugin metadata/version is missing or inconsistent')
}
new Script(plugin, { filename: 'BetterPrivacy.plugin.js' })

const routes = {
  '/': 'index.html', '/create/': 'create/index.html',
  '/m/': 'm/index.html', '/terms/': 'terms/index.html',
}
const docs = new Map()
for (const [route, path] of Object.entries(routes)) {
  const html = await read('site/' + path)
  docs.set(route, new JSDOM(html).window.document)
  for (const match of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)) {
    if (match[1].trim()) new Script(match[1], { filename: path })
  }
}

for (const [route, doc] of docs) {
  if (route === '/' && ![...doc.querySelectorAll('a[href]')].some(a => a.getAttribute('href') === downloadUrl)) {
    throw new Error('Install link must point to the pinned GitHub Release')
  }
  if (doc.querySelectorAll('h1').length !== 1) throw new Error(`${route}: expected one page heading`)
  const languages = [...doc.querySelectorAll('button[type="button"][data-lang]')]
    .map((node) => node.getAttribute('data-lang')).sort()
  if (languages.join(',') !== 'en,ru,tr') throw new Error(`${route}: EN/TR/RU language controls missing or duplicated`)
  if (!doc.querySelector('link[rel="stylesheet"][href="/assets/controls.css"]')) {
    throw new Error(`${route}: shared control stylesheet is missing`)
  }
  const ids = [...doc.querySelectorAll('[id]')].map((node) => node.id)
  if (new Set(ids).size !== ids.length) throw new Error(`${route}: duplicate element IDs`)
  for (const node of doc.querySelectorAll('a[href],script[src],img[src],link[rel=stylesheet]')) {
    const raw = node.getAttribute('href') || node.getAttribute('src')
    if (!raw || raw === '#' || !/^(\/|#)/.test(raw)) continue
    const url = new URL(raw, 'https://betterprivacy.app' + route)
    const normalized = url.pathname.endsWith('/') ? url.pathname : url.pathname + '/'
    const other = docs.get(normalized)
    const path = routes[normalized] || url.pathname.slice(1)
    await access(new URL('site/' + path, root))
    if (url.hash && !url.hash.startsWith('#v1.') && other && !other.getElementById(url.hash.slice(1))) {
      throw new Error(`${route}: missing anchor ${raw}`)
    }
    if (node.tagName === 'SCRIPT') new Script(await read('site/' + path), { filename: path })
  }
  console.log(`OK ${route}: assets, links, headings and script syntax`)
}
console.log(`OK v${manifest.version}: GitHub Release download and legacy redirect agree`)
console.log(`SHA-256 ${createHash('sha256').update(plugin).digest('hex')}`)

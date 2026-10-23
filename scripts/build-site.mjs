import { copyFile } from 'node:fs/promises'

await import('../build.mjs')
await copyFile(
  new URL('../dist/BetterPrivacy.plugin.js', import.meta.url),
  new URL('../site/BetterPrivacy.plugin.js', import.meta.url),
)
console.log('Site ready: serve site/ as the web root.')

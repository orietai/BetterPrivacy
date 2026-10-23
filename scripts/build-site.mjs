import { copyFile, readFile } from 'node:fs/promises'
import { build } from 'esbuild'

// Checked-in output keeps npm test usable before build:site on a fresh clone.
const qrLicense = await readFile(new URL('../node_modules/qr/LICENSE-MIT', import.meta.url), 'utf8')
await build({
  entryPoints: [new URL('../site/assets/qr-source.js', import.meta.url).pathname],
  outfile: new URL('../site/assets/qr-vendor.js', import.meta.url).pathname,
  bundle: true, format: 'iife', globalName: 'BPQR', minify: true,
  target: ['es2020'], charset: 'utf8', legalComments: 'inline',
  banner: { js: '/*! qr 0.7.2 — https://github.com/paulmillr/qr\n' + qrLicense + '\n*/' },
})
await copyFile(new URL('../node_modules/qr/LICENSE-MIT', import.meta.url),
  new URL('../site/assets/qr-LICENSE.txt', import.meta.url))

await import('../build.mjs')
await copyFile(
  new URL('../dist/BetterPrivacy.plugin.js', import.meta.url),
  new URL('../site/BetterPrivacy.plugin.js', import.meta.url),
)
console.log('Site ready: serve site/ as the web root.')

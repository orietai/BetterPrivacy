import { build } from 'esbuild'

const meta = `/**
 * @name BetterPrivacy
 * @author oriet.ai
 * @authorLink https://oriet.ai
 * @description Client-side E2E encryption layer for Discord chats, channels and DMs. Passphrase-based symmetric encryption; see README for threat model and ToS disclaimer.
 * @version 1.0.0
 * @website https://betterprivacy.app
 */
`

await build({
  entryPoints: ['src/index.ts'],
  bundle: true,
  outfile: 'dist/BetterPrivacy.plugin.js',
  format: 'cjs',
  platform: 'browser',
  target: ['chrome120'],
  jsxFactory: 'BdApi.React.createElement',
  jsxFragment: 'BdApi.React.Fragment',
  banner: { js: meta },
  footer: { js: '\nmodule.exports = module.exports.default ?? module.exports;' },
  logLevel: 'info',
})

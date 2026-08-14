/**
 * BetterPrivacy — injected stylesheet + indicator-color plumbing.
 *
 * All plugin styling lives in one BdApi.DOM.addStyle sheet, namespaced with
 * `.bp-*` classes and driven by Discord's own CSS custom properties (with
 * hard-coded fallbacks) so both dark and light themes look native.
 *
 * The user-configurable indicator color is exposed as the `--bp-indicator`
 * custom property on <html>, so a settings change recolors every decrypted
 * message/media border instantly without touching the style sheet.
 */

import { PLUGIN_NAME, type PluginContext } from '../types'

const STYLE_ID = PLUGIN_NAME // 'BetterPrivacy'
const INDICATOR_PROP = '--bp-indicator'

/**
 * True while our styles are mounted. The settings-store subscription cannot
 * be removed (SettingsStore.onChange has no unsubscribe), so the callback
 * checks this flag and becomes a no-op after removeStyles().
 */
let stylesActive = false

const CSS = `
/* ---- decrypted message text ------------------------------------------- */
.bp-decrypted {
  color: var(${INDICATOR_PROP}, #3ba55d);
}
.bp-decrypted::before {
  content: '\\1F987'; /* 🦇 — BetterPrivacy's logo marks decrypted content */
  font-size: 0.85em;
  opacity: 0.7;
  margin-right: 4px;
}

/* ---- locked / unknown-key chip ---------------------------------------- */
.bp-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  background: color-mix(in srgb, var(--background-secondary, #2b2d31) 85%, transparent);
  color: var(--text-muted, #949ba4);
  padding: 2px 8px;
  border-radius: 8px;
  cursor: pointer;
  font-size: 0.9em;
  user-select: none;
  border: 1px solid color-mix(in srgb, var(--background-tertiary, #1e1f22) 60%, transparent);
}
.bp-chip:hover {
  background: var(--background-secondary, #2b2d31);
  color: var(--text-normal, #dbdee1);
}

/* ---- decryption failure (GCM auth error / tamper) ---------------------- */
.bp-failed {
  color: var(--status-danger, #ed4245);
  background: color-mix(in srgb, var(--status-danger, #ed4245) 10%, transparent);
  border-color: color-mix(in srgb, var(--status-danger, #ed4245) 40%, transparent);
}

/* ---- decrypted inline media (img / video / audio) ----------------------- */
.bp-decrypted-media {
  max-width: 400px;
  border: 2px solid var(${INDICATOR_PROP}, #3ba55d);
  border-radius: 4px;
}

/* ---- chat-bar controls -------------------------------------------------- */
.bp-chatbar-controls {
  display: inline-flex;
  gap: 4px;
  align-items: center;
  position: relative;
  margin: 0 4px;
}
.bp-chatbar-btn {
  background: none;
  border: none;
  cursor: pointer;
  padding: 4px 6px;
  border-radius: 4px;
  color: var(--interactive-normal, #b5bac1);
  font-size: 16px;
  line-height: 1;
}
.bp-chatbar-btn:hover {
  background: var(--background-modifier-hover, rgba(78, 80, 88, 0.3));
  color: var(--interactive-hover, #dbdee1);
}
.bp-chatbar-btn.bp-on {
  color: var(${INDICATOR_PROP}, #3ba55d);
  background: color-mix(in srgb, var(${INDICATOR_PROP}, #3ba55d) 18%, transparent);
  box-shadow: inset 0 0 0 1px var(${INDICATOR_PROP}, #3ba55d);
}
/* Key exists but is locked — phrase needed. */
.bp-chatbar-btn.bp-locked {
  color: var(--status-warning, #faa61a);
  background: color-mix(in srgb, var(--status-warning, #faa61a) 18%, transparent);
  box-shadow: inset 0 0 0 1px var(--status-warning, #faa61a);
}
/* Send patch broken — encryption unavailable, messages would go plaintext. */
.bp-chatbar-btn.bp-broken {
  color: var(--status-danger, #ed4245);
  background: color-mix(in srgb, var(--status-danger, #ed4245) 18%, transparent);
  box-shadow: inset 0 0 0 1px var(--status-danger, #ed4245);
}
.bp-chatbar-host {
  display: inline-flex;
  align-items: center;
  align-self: center;
}
.bp-key-btn {
  font-size: 12px;
  max-width: 140px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* ---- key-picker popover -------------------------------------------------- */
.bp-popover {
  position: absolute;
  bottom: calc(100% + 8px);
  right: 0;
  min-width: 220px;
  max-height: 320px;
  overflow-y: auto;
  background: var(--background-floating, #111214);
  color: var(--text-normal, #dbdee1);
  border-radius: 8px;
  box-shadow: var(--elevation-high, 0 8px 16px rgba(0, 0, 0, 0.24));
  padding: 6px;
  z-index: 1000;
}
.bp-popover-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 8px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 13px;
}
.bp-popover-item:hover {
  background: var(--background-modifier-hover, rgba(78, 80, 88, 0.3));
}
.bp-popover-item.bp-active {
  color: var(${INDICATOR_PROP}, #3ba55d);
}
.bp-popover-remove {
  opacity: 0.45;
  padding: 2px 5px;
  border-radius: 3px;
  font-size: 12px;
  line-height: 1;
  cursor: pointer;
}
.bp-popover-remove:hover {
  opacity: 1;
  color: var(--status-danger, #ed4245);
  background: color-mix(in srgb, var(--status-danger, #ed4245) 15%, transparent);
}
.bp-popover-hint {
  padding: 6px 8px 2px;
  color: var(--text-muted, #949ba4);
  font-size: 11px;
  line-height: 1.4;
}
.bp-popover-hint code {
  font-size: 10px;
  background: color-mix(in srgb, var(--background-secondary, #2b2d31) 80%, transparent);
  padding: 1px 3px;
  border-radius: 3px;
}
.bp-popover-sep {
  height: 1px;
  margin: 4px 0;
  background: var(--background-modifier-accent, rgba(78, 80, 88, 0.48));
}

/* ---- modal form inputs ---------------------------------------------------- */
.bp-modal-input {
  width: 100%;
  box-sizing: border-box;
  padding: 8px 10px;
  margin: 6px 0;
  border-radius: 3px;
  border: none;
  outline: none;
  background: var(--input-background, #1e1f22);
  color: var(--text-normal, #dbdee1);
  font-size: 14px;
  font-family: inherit;
}
.bp-modal-label {
  display: block;
  margin-top: 8px;
  color: var(--header-secondary, #b5bac1);
  font-size: 12px;
  font-weight: 600;
  text-transform: uppercase;
}

/* ---- settings panel -------------------------------------------------------- */
.bp-settings {
  color: var(--text-normal, #dbdee1);
  padding: 4px 0 16px;
}
.bp-settings h3 {
  color: var(--header-primary, #f2f3f5);
  margin: 16px 0 8px;
  font-size: 16px;
  font-weight: 600;
}
.bp-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}
.bp-table th,
.bp-table td {
  text-align: left;
  padding: 6px 8px;
  border-bottom: 1px solid var(--background-modifier-accent, rgba(78, 80, 88, 0.48));
}
.bp-table th {
  color: var(--header-secondary, #b5bac1);
  font-size: 11px;
  text-transform: uppercase;
}
.bp-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin: 10px 0;
}
.bp-hint {
  color: var(--text-muted, #949ba4);
  font-size: 12px;
  margin-top: 2px;
}
.bp-btn {
  background: var(${INDICATOR_PROP}, #3ba55d);
  color: #fff;
  border: none;
  border-radius: 3px;
  padding: 6px 12px;
  cursor: pointer;
  font-size: 13px;
}
.bp-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.bp-btn-secondary {
  background: var(--button-secondary-background, #4e5058);
}
.bp-btn-danger {
  background: var(--status-danger, #ed4245);
}
`

export function injectStyles(ctx: PluginContext): void {
  stylesActive = true
  BdApi.DOM.addStyle(STYLE_ID, CSS)

  document.documentElement.style.setProperty(INDICATOR_PROP, ctx.settings.get().indicatorColor)

  // SettingsStore.onChange offers no unsubscribe; the flag makes this a no-op
  // once removeStyles() has run (the store itself is discarded on stop()).
  ctx.settings.onChange((s) => {
    if (!stylesActive) return
    document.documentElement.style.setProperty(INDICATOR_PROP, s.indicatorColor)
  })
}

export function removeStyles(): void {
  stylesActive = false
  BdApi.DOM.removeStyle(STYLE_ID)
  document.documentElement.style.removeProperty(INDICATOR_PROP)
}

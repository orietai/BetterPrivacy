// Ambient declarations for the BetterDiscord runtime (docs.betterdiscord.app/api).
// Kept intentionally loose — Discord internals are untyped by nature.

interface BdPatcher {
  before(caller: string, mod: any, method: string, cb: (thisObj: any, args: any[]) => any): () => void
  after(caller: string, mod: any, method: string, cb: (thisObj: any, args: any[], ret: any) => any): () => void
  instead(caller: string, mod: any, method: string, cb: (thisObj: any, args: any[], original: (...a: any[]) => any) => any): () => void
  unpatchAll(caller: string): void
}

declare const BdApi: {
  React: any
  ReactDOM: any
  Webpack: {
    getModule(filter: (m: any) => boolean, options?: { first?: boolean; defaultExport?: boolean; searchExports?: boolean }): any
    getByKeys(...args: any[]): any
    getByStrings(...args: any[]): any
    getStore(name: string): any
    getWithKey(filter: (m: any) => boolean, options?: any): any
    Filters: {
      byKeys(...keys: string[]): (m: any) => boolean
      byStrings(...strings: string[]): (m: any) => boolean
      byStoreName(name: string): (m: any) => boolean
      combine(...filters: Array<(m: any) => boolean>): (m: any) => boolean
    }
  }
  Patcher: BdPatcher
  Data: {
    load(pluginName: string, key: string): any
    save(pluginName: string, key: string, value: any): void
    delete(pluginName: string, key: string): void
  }
  DOM: {
    addStyle(id: string, css: string): void
    removeStyle(id: string): void
  }
  UI: {
    showToast(content: string, options?: { type?: 'info' | 'success' | 'warning' | 'error'; timeout?: number }): void
    showConfirmationModal(title: string, content: any, options?: any): string
    alert(title: string, content: any): void
  }
  ContextMenu: {
    patch(navId: string, cb: (tree: any, props: any) => any): () => void
    unpatch(navId: string, cb: any): void
    buildItem(props: any): any
    buildMenuChildren(setup: any[]): any
    close?(): void
  }
  Components?: any
  /** Main-process fetch (no renderer CORS restrictions). BD ≥ 1.10. */
  Net?: {
    fetch(url: string, options?: any): Promise<{
      ok: boolean
      status: number
      arrayBuffer(): Promise<ArrayBuffer>
      headers?: any
    }>
  }
}

// Minimal JSX support without @types/react (BdApi.React is untyped).
declare namespace JSX {
  type Element = any
  interface IntrinsicElements { [elemName: string]: any }
  interface ElementChildrenAttribute { children: {} }
}

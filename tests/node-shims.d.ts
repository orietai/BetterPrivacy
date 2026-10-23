/**
 * Minimal ambient declarations for the one Node built-in the test suite reads
 * files with.
 *
 * The project ships no @types/node on purpose: the plugin runs in Discord's
 * renderer, not in Node, and a types package that hands every source file a
 * Node global would hide real mistakes. This keeps `tsc --noEmit` honest
 * while letting tests/webPageParity.test.ts read the shipped decrypt page.
 */
declare module 'node:fs' {
  export function readFileSync(path: string | URL, encoding: 'utf8'): string
}

/**
 * jsdom ships no type definitions of its own. tests/webPageFlow.test.ts loads
 * the real decrypt page into a DOM and drives it through events; `window` is
 * deliberately `any` because the page's own globals live on it.
 */
declare module 'jsdom' {
  export class VirtualConsole {
    on(event: string, handler: (...args: any[]) => void): this
  }
  export interface JSDOMOptions {
    runScripts?: 'dangerously' | 'outside-only'
    url?: string
    pretendToBeVisual?: boolean
    virtualConsole?: VirtualConsole
    beforeParse?(window: any): void
  }
  export class JSDOM {
    constructor(html: string, options?: JSDOMOptions)
    readonly window: any
  }
}

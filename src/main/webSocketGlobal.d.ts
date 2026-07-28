// Minimal ambient typing for the WebSocket client built into Node (stable
// since Node 22, which Electron 42 bundles — see presenceService.ts). Not
// covered by @types/node itself, and this project's main-process tsconfig
// intentionally has no "dom" lib (that would pull in a much bigger surface,
// like `window`/`document`, that has no business existing in the main
// process). Declares only the small subset presenceService.ts actually uses.
declare global {
  class WebSocket {
    static readonly OPEN: number
    readonly readyState: number
    constructor(url: string)
    send(data: string): void
    close(code?: number, reason?: string): void
    addEventListener(type: 'open', listener: () => void): void
    addEventListener(type: 'message', listener: (event: { data: unknown }) => void): void
    addEventListener(type: 'close', listener: (event: { code: number; reason: string }) => void): void
    addEventListener(type: 'error', listener: (event: unknown) => void): void
  }
}

export {}

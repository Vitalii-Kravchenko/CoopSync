import type { BrowserWindow } from 'electron'

// Tracks which screen (Sidebar tab) the renderer is currently showing, plus
// a reference to the one main window it's showing in — lets main-process
// code (see updater.ts's showUpdateToast) answer "is the user genuinely
// looking at screen X on screen right now" without its own IPC plumbing, and
// without a circular import (ipc.ts, which actually receives the renderer's
// 'window:active-screen' message, already imports updater.ts — see
// updater.ts's own doc comment on the same problem for showToast/
// dismissToastsOfKind). This is deliberately ephemeral, in-memory, never
// persisted — a fresh launch starts knowing nothing until the renderer's
// first report arrives.

let activeScreen: string | null = null
let mainWindowRef: BrowserWindow | null = null

export function setActiveScreen(screen: string, win: BrowserWindow): void {
  activeScreen = screen
  mainWindowRef = win
}

/** True only when the main window is genuinely on-screen right now (not
 *  hidden to the tray, not minimized) AND the renderer says it's showing
 *  this exact screen — e.g. gates the update-available toast: no point
 *  popping it up bottom-center while the same information is already
 *  sitting in the Games-tab banner right in front of the user. */
export function isScreenVisible(screen: string): boolean {
  return (
    activeScreen === screen &&
    mainWindowRef !== null &&
    !mainWindowRef.isDestroyed() &&
    mainWindowRef.isVisible() &&
    !mainWindowRef.isMinimized()
  )
}

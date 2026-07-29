import { contextBridge, ipcRenderer } from 'electron'
import type { ToastShowPayload } from '../shared/types'

// Bridge for the separate toast overlay window (see
// main/services/toastWindow.ts) — deliberately its own tiny surface
// (window.toastApi, not window.api) rather than reusing the main preload:
// this window never needs auth/sync/settings, just "show me toasts and let
// me report back size + clicks."
const toastApi = {
  /** Sent once, right after this window's React tree has actually mounted
   *  — main holds back EVERY toast payload until it hears this, so a toast
   *  never mounts (and starts its own countdown) while the page might still
   *  be busy evaluating its bundle for the first time (dev-mode cold Vite
   *  transform of the whole i18n set can genuinely stall the JS thread for
   *  a couple of seconds — the countdown would "honestly" burn through that
   *  stall before the user ever sees anything, then appear already half-gone). */
  signalReady: (): void => ipcRenderer.send('toast:ready'),
  /** Subscribe to a new toast to show. Returns an unsubscribe function. */
  onShow: (callback: (toast: ToastShowPayload) => void): (() => void) => {
    const listener = (_event: unknown, toast: ToastShowPayload): void => callback(toast)
    ipcRenderer.on('toast:show', listener)
    return () => ipcRenderer.removeListener('toast:show', listener)
  },
  /** Tell main the stack's current rendered height, in px, so the
   *  (otherwise invisible/transparent) window can be resized+repositioned
   *  to exactly hug its content, bottom-center anchored. */
  reportHeight: (height: number): void => ipcRenderer.send('toast:resize', height),
  /** The stack is empty — hide the window entirely (nothing left to click
   *  through even though it's transparent). */
  reportEmpty: (): void => ipcRenderer.send('toast:hide'),
  /** Clicked the toast's own body (not a button) — just bring the main
   *  window up, no side effect. */
  openMain: (): void => ipcRenderer.send('toast:open-main'),
  /** Clicked the toast's action button (e.g. "Update now"/"Restore") — main
   *  performs the kind-specific effect AND brings the main window up. */
  action: (kind: string, params: Record<string, string>): void =>
    ipcRenderer.send('toast:action', kind, params)
}

contextBridge.exposeInMainWorld('toastApi', toastApi)

export type ToastApi = typeof toastApi

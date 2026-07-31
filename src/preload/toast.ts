import { contextBridge, ipcRenderer } from 'electron'
import type { ToastKind, ToastShowPayload, UpdateStatus } from '../shared/types'

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
  /** Tell main the stack's current rendered width+height, in px, so the
   *  (otherwise invisible/transparent) window can be resized+repositioned
   *  to exactly hug its content, bottom-center anchored — width included
   *  since 2026-07-30 (cards no longer wrap/truncate text, they grow to fit
   *  instead, so the window itself must grow to match). */
  reportSize: (width: number, height: number): void => ipcRenderer.send('toast:resize', width, height),
  /** The stack is empty — hide the window entirely (nothing left to click
   *  through even though it's transparent). */
  reportEmpty: (): void => ipcRenderer.send('toast:hide'),
  /** Clicked the toast's own body (not a button) — just bring the main
   *  window up, no side effect. */
  openMain: (): void => ipcRenderer.send('toast:open-main'),
  /** Clicked the toast's action button (e.g. "Update now"/"Restore") — main
   *  performs the kind-specific effect AND brings the main window up (except
   *  update-available, see toastWindow.ts). */
  action: (kind: string, params: Record<string, string>): void =>
    ipcRenderer.send('toast:action', kind, params),
  /** Clicked "Install update" on the toast once a download it's tracking
   *  live finished — see toastWindow.ts's setInstallHandler. */
  installUpdate: (): void => ipcRenderer.send('toast:install-update'),
  /** Answered an 'experimental-confirm' toast's "так"/"є проблеми" — see
   *  toastWindow.ts's setConfirmHandler. Its own tiny channel rather than
   *  overloading `action` above, same reasoning as installUpdate: two
   *  equal-weight answers instead of one action + implicit dismiss. */
  confirmExperimental: (gameId: string, gameName: string, answer: 'yes' | 'no'): void =>
    ipcRenderer.send('toast:confirm-experimental', gameId, gameName, answer),
  /** Live auto-update state, same 'updater:status' broadcast every window
   *  gets — lets the update-available toast track a download in progress
   *  instead of staying frozen with whatever it showed when it first
   *  appeared (see ToastCard). */
  onUpdateStatus: (callback: (status: UpdateStatus) => void): (() => void) => {
    const listener = (_event: unknown, status: UpdateStatus): void => callback(status)
    ipcRenderer.on('updater:status', listener)
    return () => ipcRenderer.removeListener('updater:status', listener)
  },
  /** Main is telling this window to drop any currently-shown toast of this
   *  kind — used when the update download was started from a different
   *  surface (Settings/Games-tab banner), making this toast's own prompt
   *  stale (see toastWindow.ts's dismissToastsOfKind). */
  onDismissKind: (callback: (kind: ToastKind) => void): (() => void) => {
    const listener = (_event: unknown, kind: ToastKind): void => callback(kind)
    ipcRenderer.on('toast:dismiss-kind', listener)
    return () => ipcRenderer.removeListener('toast:dismiss-kind', listener)
  }
}

contextBridge.exposeInMainWorld('toastApi', toastApi)

export type ToastApi = typeof toastApi

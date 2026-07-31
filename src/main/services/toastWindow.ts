import { BrowserWindow, ipcMain, screen } from 'electron'
import { randomUUID } from 'crypto'
import { join } from 'path'
import { readSettings } from './settingsStore'
import { log } from './logger'
import type { ToastKind, ToastShowPayload } from '../../shared/types'

// The OS-level toast popup — replaces the native Windows Notification API
// everywhere in the app (see App.tsx's old friend-save toast and updater.ts's
// old update toast) with a fully custom, RIFT//SYNC-styled overlay, since the
// native Action Center toast can't be styled at all. A second, tiny
// always-on-top window (own preload/own renderer entry — see
// electron.vite.config.ts) rather than anything drawn inside the main
// window, so toasts still show up while the main window is hidden in the
// tray (the whole point of a background sync app).
//
// This module owns ONLY the window's lifecycle + wiring. It deliberately
// imports nothing from ipc.ts/updater.ts/customGames.ts — those would-be
// imports go the other way (see setActionHandler/setShowWindowCallback
// below) to avoid a circular import, since updater.ts and notificationStore.ts
// both need to call showToast() from here.

// The window's width is now DYNAMIC — it resizes (and recenters) to match
// whatever ToastCard.tsx's own fit-content card actually renders at,
// reported live via 'toast:resize' (see reposition below). This is only the
// INITIAL width the window is created with, before any real content has
// been measured — matches ToastCard.tsx's own card minWidth (340) + the
// same shadow padding either side (V_PAD_X in ToastStack.tsx). Cards no
// longer wrap or truncate their text on any language (Vitalii's request,
// 2026-07-30) — they grow instead, and the window grows with them.
const DEFAULT_WIDTH = 340 + 40 * 2
// Nudged down from 22 (Vitalii's request, 2026-07-30) — still enough room
// for the shadow below the card, just closer to the screen edge.
const BOTTOM_MARGIN = 14

// A toast fired the instant the app starts (or, in dev, while the toast
// window's own bundle is still being cold-transformed by Vite for the
// first time) could show up already mostly through its own countdown, or
// get lost entirely. Anything asked to show within this window after
// startup is queued instead, and flushed once it's elapsed — the window
// has had time to actually exist and load by then either way.
const STARTUP_GRACE_MS = 8000
let pending: Array<{ kind: ToastKind; params: Record<string, string> }> = []
let graceTimer: ReturnType<typeof setTimeout> | null = setTimeout(() => {
  log(`toast: grace elapsed, flushing ${pending.length} queued`)
  graceTimer = null
  const queued = pending
  pending = []
  for (const { kind, params } of queued) dispatch(kind, params)
}, STARTUP_GRACE_MS)

let win: BrowserWindow | null = null
// Set once per window instance by its 'toast:ready' ping (see
// preload/toast.ts) — every payload waits for this instead of relying on
// 'did-finish-load' alone, which only means the HTML/scripts were
// requested, not that React has actually mounted and is ready to receive.
let rendererReady = false
let readyQueue: Array<() => void> = []
// Only ever grows (a new toast arriving, or a wider one) or resets on the
// stack going fully empty — deliberately NEVER shrinks mid-stack. Windows
// visibly flickers/flashes a transparent frameless window's content on
// setBounds, and shrinking on every single dismissal (or every time a
// narrower toast is the only one left) was causing the REST of the stack to
// flicker each time one toast disappeared. Only resizing on growth (or the
// one shrink-to-empty reset) means setBounds fires far less often, and only
// when there's genuinely new content filling the frame rather than existing
// content being disturbed. Width joined this same grow-only treatment
// 2026-07-30, when cards stopped having a fixed width.
let lastReportedHeight = 0
let lastReportedWidth = 0

// Registered by ipc.ts (has downloadUpdate/restoreOrphanedCustomGame/
// restoreOrphanedFolder already in scope) and index.ts (has the actual
// mainWindow/showWindow closure) respectively — see their call sites.
let actionHandler: ((kind: ToastKind, params: Record<string, string>) => void) | null = null
let showWindowCb: (() => void) | null = null
// Wired by ipc.ts to quitAndInstall() — kept as its own tiny channel rather
// than overloading actionHandler/'toast:action' above: this is the ONE
// button whose meaning changes live out from under the toast's own fixed
// `kind` (see ToastCard's update-available special-case), so it's simpler
// as a dedicated round-trip than teaching the generic action dispatch about
// a kind that isn't really a ToastKind.
let installHandler: (() => void) | null = null
// Wired by ipc.ts to experimentalConfirm.recordExperimentalAnswer — its own
// channel for the same reason as installHandler above: 'experimental-confirm'
// carries two equal-weight answers, not the single action+params shape
// actionHandler expects.
let confirmHandler: ((gameId: string, gameName: string, answer: 'yes' | 'no') => void) | null = null

export function setActionHandler(fn: (kind: ToastKind, params: Record<string, string>) => void): void {
  actionHandler = fn
}

export function setInstallHandler(fn: () => void): void {
  installHandler = fn
}

export function setConfirmHandler(fn: (gameId: string, gameName: string, answer: 'yes' | 'no') => void): void {
  confirmHandler = fn
}

export function setToastShowWindowCallback(fn: () => void): void {
  showWindowCb = fn
}

/** Tell the toast window to drop any currently-shown toast of this kind —
 *  used when the update download was started from a DIFFERENT surface
 *  (Settings/the Games-tab banner) than this toast itself: that toast's
 *  "Download update" prompt is now stale/redundant, so it just goes away
 *  instead of sitting there with a button that no longer does anything
 *  useful (Vitalii's call, 2026-07-30). A no-op if the window was never
 *  created or has nothing of that kind showing. */
export function dismissToastsOfKind(kind: ToastKind): void {
  if (!win || win.isDestroyed()) return
  win.webContents.send('toast:dismiss-kind', kind)
}

function ensureWindow(): BrowserWindow {
  if (win && !win.isDestroyed()) return win

  log('toast: creating window')
  rendererReady = false
  readyQueue = []
  lastReportedHeight = 0
  lastReportedWidth = 0

  win = new BrowserWindow({
    width: DEFAULT_WIDTH,
    height: 1,
    show: false,
    frame: false,
    transparent: true,
    hasShadow: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    // Mouse clicks (buttons, dismiss ×) still work with focusable:false — it
    // only opts out of KEYBOARD focus/activation, which is exactly what an
    // overlay toast wants: it must never steal focus from a fullscreen game
    // or whatever the user was just doing.
    focusable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    webPreferences: {
      preload: join(__dirname, '../preload/toast.js'),
      sandbox: false
    }
  })
  win.setAlwaysOnTop(true, 'screen-saver')
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  // Shown right away (still 1px tall — imperceptible) rather than waiting
  // for the first real content resize: a HIDDEN Electron/Chromium window
  // throttles/suspends its own layout, which meant ResizeObserver in the
  // renderer never fired again once truly hidden, and the window could
  // never earn its way back to being shown — a real deadlock this exact
  // window hit in testing. Staying nominally "visible" at all times (even
  // when empty, just very short) keeps layout/ResizeObserver running.
  win.showInactive()

  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/toast.html`)
  } else {
    win.loadFile(join(__dirname, '../renderer/toast.html'))
  }
  win.webContents.on('did-fail-load', (_e, code, desc) => log(`toast: did-fail-load ${code} ${desc}`))
  win.webContents.on('console-message', (_e, level, message) => log(`toast: renderer console[${level}] ${message}`))

  const w = win
  ipcMain.on('toast:ready', (event) => {
    if (BrowserWindow.fromWebContents(event.sender) !== w) return
    log(`toast: renderer ready, flushing ${readyQueue.length} queued`)
    rendererReady = true
    const queued = readyQueue
    readyQueue = []
    for (const send of queued) {
      try {
        send()
      } catch (e) {
        log(`toast: send() threw: ${e instanceof Error ? e.stack : String(e)}`)
      }
    }
  })
  ipcMain.on('toast:resize', (event, width: number, height: number) => {
    if (BrowserWindow.fromWebContents(event.sender) !== w) return
    // Grow-only, per axis — see lastReportedWidth/Height's doc comment above.
    const nextWidth = Math.max(width, lastReportedWidth)
    const nextHeight = Math.max(height, lastReportedHeight)
    if (nextWidth === lastReportedWidth && nextHeight === lastReportedHeight) return
    lastReportedWidth = nextWidth
    lastReportedHeight = nextHeight
    reposition(w, nextWidth, nextHeight)
  })
  ipcMain.on('toast:hide', (event) => {
    if (BrowserWindow.fromWebContents(event.sender) !== w) return
    log('toast: hide reported (shrinking to 1px, staying visible)')
    // Deliberately NOT w.hide() — see showInactive()'s doc comment above.
    // Width resets too (not just height) — otherwise the NEXT toast, even a
    // narrower one, would be stuck inheriting whatever the widest toast in
    // the previous, now-fully-dismissed stack happened to be.
    lastReportedHeight = 1
    lastReportedWidth = 0
    reposition(w, DEFAULT_WIDTH, 1)
  })
  ipcMain.on('toast:open-main', (event) => {
    if (BrowserWindow.fromWebContents(event.sender) !== w) return
    showWindowCb?.()
  })
  ipcMain.on(
    'toast:action',
    (event, kind: ToastKind, params: Record<string, string>) => {
      if (BrowserWindow.fromWebContents(event.sender) !== w) return
      actionHandler?.(kind, params)
      // update-available deliberately stays in the tray (Vitalii's call,
      // 2026-07-30): the download runs entirely in main and this same toast
      // tracks its progress live (see ToastCard), so there's no need to yank
      // the main window forward just for clicking this button — unlike the
      // restore actions below, which need the app open to actually show
      // their result.
      if (kind !== 'update-available') showWindowCb?.()
    }
  )
  ipcMain.on('toast:install-update', (event) => {
    if (BrowserWindow.fromWebContents(event.sender) !== w) return
    installHandler?.()
  })
  ipcMain.on(
    'toast:confirm-experimental',
    (event, gameId: string, gameName: string, answer: 'yes' | 'no') => {
      if (BrowserWindow.fromWebContents(event.sender) !== w) return
      confirmHandler?.(gameId, gameName, answer)
      // "так" stays quiet in the tray — nothing to show. "є проблеми" needs
      // the main window up so the pre-filled Support modal is actually
      // visible (see ipc.ts's setConfirmHandler wiring).
      if (answer === 'no') showWindowCb?.()
    }
  )

  return win
}

function reposition(w: BrowserWindow, width: number, height: number): void {
  const { workArea } = screen.getPrimaryDisplay()
  // Recomputed from the CURRENT reported width every time (not a fixed
  // constant) — the window recenters itself as it grows/shrinks with
  // whatever the widest current toast actually needs (2026-07-30).
  const x = Math.round(workArea.x + (workArea.width - width) / 2)
  const y = Math.round(workArea.y + workArea.height - BOTTOM_MARGIN - height)
  w.setBounds({ x, y, width: Math.max(1, Math.round(width)), height: Math.max(1, Math.round(height)) })
}

export function showToast(kind: ToastKind, params: Record<string, string>): void {
  if (graceTimer !== null) {
    pending.push({ kind, params })
    return
  }
  dispatch(kind, params)
}

function dispatch(kind: ToastKind, params: Record<string, string>): void {
  const w = ensureWindow()
  const payload: ToastShowPayload = {
    id: randomUUID(),
    kind,
    params,
    createdAt: new Date().toISOString(),
    language: readSettings().language
  }
  const send = (): void => w.webContents.send('toast:show', payload)
  // Waits for the renderer's OWN 'toast:ready' ping (see its doc comment on
  // rendererReady above) rather than 'did-finish-load' — that only means
  // the page's HTML/scripts were requested, not that React has actually
  // mounted.
  if (rendererReady) send()
  else readyQueue.push(send)
}

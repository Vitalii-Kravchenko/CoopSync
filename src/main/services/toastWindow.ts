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

const WIDTH = 452 // 420 card + room either side for the hover glow/shadow to not get clipped
const BOTTOM_MARGIN = 22

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
// Only ever grows (a new toast arriving) or resets to 1 (the stack went
// fully empty) — deliberately NEVER shrinks mid-stack. Windows visibly
// flickers/flashes a transparent frameless window's content on setBounds,
// and shrinking on every single dismissal was causing the REST of the
// stack to flicker each time one toast disappeared. Only resizing on
// growth (or the one shrink-to-empty reset) means setBounds fires far less
// often, and only when there's genuinely new content filling the frame
// rather than existing content being disturbed.
let lastReportedHeight = 0

// Registered by ipc.ts (has downloadUpdate/restoreOrphanedCustomGame/
// restoreOrphanedFolder already in scope) and index.ts (has the actual
// mainWindow/showWindow closure) respectively — see their call sites.
let actionHandler: ((kind: ToastKind, params: Record<string, string>) => void) | null = null
let showWindowCb: (() => void) | null = null

export function setActionHandler(fn: (kind: ToastKind, params: Record<string, string>) => void): void {
  actionHandler = fn
}

export function setToastShowWindowCallback(fn: () => void): void {
  showWindowCb = fn
}

function ensureWindow(): BrowserWindow {
  if (win && !win.isDestroyed()) return win

  log('toast: creating window')
  rendererReady = false
  readyQueue = []
  lastReportedHeight = 0

  win = new BrowserWindow({
    width: WIDTH,
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
  ipcMain.on('toast:resize', (event, height: number) => {
    if (BrowserWindow.fromWebContents(event.sender) !== w) return
    // Grow-only — see lastReportedHeight's doc comment above.
    if (height <= lastReportedHeight) return
    lastReportedHeight = height
    reposition(w, height)
  })
  ipcMain.on('toast:hide', (event) => {
    if (BrowserWindow.fromWebContents(event.sender) !== w) return
    log('toast: hide reported (shrinking to 1px, staying visible)')
    // Deliberately NOT w.hide() — see showInactive()'s doc comment above.
    lastReportedHeight = 1
    reposition(w, 1)
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
      showWindowCb?.()
    }
  )

  return win
}

function reposition(w: BrowserWindow, height: number): void {
  const { workArea } = screen.getPrimaryDisplay()
  const x = Math.round(workArea.x + (workArea.width - WIDTH) / 2)
  const y = Math.round(workArea.y + workArea.height - BOTTOM_MARGIN - height)
  w.setBounds({ x, y, width: WIDTH, height: Math.max(1, Math.round(height)) })
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

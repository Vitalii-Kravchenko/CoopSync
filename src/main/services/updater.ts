import { app, BrowserWindow } from 'electron'
import { autoUpdater } from 'electron-updater'
import type { UpdateStatus } from '../../shared/types'

// autoDownload/autoInstallOnAppQuit are both off — the user decides via the
// Settings screen (About card) when to download and when to restart, so an
// update never lands or applies without them noticing.
autoUpdater.autoDownload = false
autoUpdater.autoInstallOnAppQuit = false

function send(status: UpdateStatus): void {
  // Single window app (see index.ts) — broadcasting to all windows is
  // simplest and there's never more than one anyway.
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('updater:status', status)
  }
}

autoUpdater.on('checking-for-update', () => send({ state: 'checking' }))
autoUpdater.on('update-available', (info) => send({ state: 'available', version: info.version }))
autoUpdater.on('update-not-available', () => send({ state: 'not-available' }))
autoUpdater.on('download-progress', (p) =>
  send({ state: 'downloading', percent: Math.round(p.percent) })
)
autoUpdater.on('update-downloaded', (info) => send({ state: 'downloaded', version: info.version }))
autoUpdater.on('error', (err) => send({ state: 'error', message: err.message }))

// In dev (unpackaged) there's no app-update.yml, so checkForUpdates() would
// just throw — checks are a no-op outside a real install.
function checkForUpdates(): void {
  if (!app.isPackaged) return
  void autoUpdater.checkForUpdates()
}

export function downloadUpdate(): void {
  if (!app.isPackaged) return
  void autoUpdater.downloadUpdate()
}

export function quitAndInstall(): void {
  autoUpdater.quitAndInstall()
}

// Called once on startup, after a delay — a silent background check (no
// dialogs), same as the manual "Check for updates" button in Settings would
// trigger. The renderer picks up the result via the 'updater:status' event
// whenever it's mounted, whether or not anyone is looking at Settings.
export function scheduleStartupCheck(): void {
  setTimeout(checkForUpdates, 10_000)
}

export { checkForUpdates }

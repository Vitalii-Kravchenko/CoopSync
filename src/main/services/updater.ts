import { app, BrowserWindow } from 'electron'
import { autoUpdater } from 'electron-updater'
import { readSettings } from './settingsStore'
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

// Watchdog for a stuck check: if the underlying HTTP request to GitHub never
// settles (seen in the wild with Windows' "automatically detect proxy
// settings"), electron-updater emits nothing at all and the Settings screen
// is left showing "Checking for updates..." forever. Force an error after a
// grace period so the button always recovers.
let checkTimeout: ReturnType<typeof setTimeout> | null = null

function clearCheckTimeout(): void {
  if (checkTimeout) {
    clearTimeout(checkTimeout)
    checkTimeout = null
  }
}

autoUpdater.on('checking-for-update', () => send({ state: 'checking' }))
autoUpdater.on('update-available', (info) => {
  clearCheckTimeout()
  send({ state: 'available', version: info.version })
})
autoUpdater.on('update-not-available', () => {
  clearCheckTimeout()
  send({ state: 'not-available' })
})
autoUpdater.on('download-progress', (p) =>
  send({ state: 'downloading', percent: Math.round(p.percent) })
)
autoUpdater.on('update-downloaded', (info) => send({ state: 'downloaded', version: info.version }))
autoUpdater.on('error', (err) => {
  clearCheckTimeout()
  send({ state: 'error', message: err.message })
})

// In dev (unpackaged) there's no app-update.yml, so checkForUpdates() would
// just throw — checks are a no-op outside a real install, but still report
// back so the UI doesn't sit on "Checking..." forever if triggered by hand.
function checkForUpdates(): void {
  if (!app.isPackaged) {
    send({ state: 'error', message: 'not available in a dev build' })
    return
  }
  clearCheckTimeout()
  checkTimeout = setTimeout(() => {
    checkTimeout = null
    send({ state: 'error', message: 'timed out' })
  }, 20_000)
  void autoUpdater.checkForUpdates()
}

export function downloadUpdate(): void {
  if (!app.isPackaged) return
  void autoUpdater.downloadUpdate()
}

export function quitAndInstall(): void {
  autoUpdater.quitAndInstall()
}

// A silent background check (no dialogs), same as the manual "Check for
// updates" button in Settings would trigger. The renderer picks up the
// result via the 'updater:status' event whenever it's mounted, whether or
// not anyone is looking at Settings. Reads the setting at fire time (not at
// schedule time) so flipping the toggle during the delay window still takes
// effect. The manual "Check for updates" button always works regardless of
// this setting.
export function scheduleStartupCheck(): void {
  setTimeout(() => {
    if (readSettings().autoCheckUpdates) checkForUpdates()
  }, 2_000)

  // CoopSync minimizes to the tray instead of quitting (see index.ts), so
  // the app process can easily stay alive for days without a fresh launch —
  // a check that only ever fires once at startup could miss a release
  // entirely for that whole stretch. Re-check periodically on top of the
  // startup check so a long-lived tray session still notices new releases.
  setInterval(
    () => {
      if (readSettings().autoCheckUpdates) checkForUpdates()
    },
    6 * 60 * 60 * 1000
  )
}

export { checkForUpdates }

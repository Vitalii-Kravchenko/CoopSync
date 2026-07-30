import { app, BrowserWindow } from 'electron'
import { autoUpdater } from 'electron-updater'
import { readSettings } from './settingsStore'
import { addNotification } from './notificationStore'
import { showToast, dismissToastsOfKind } from './toastWindow'
import { getLastNotifiedUpdateVersion, setLastNotifiedUpdateVersion } from './backgroundState'
import { isScreenVisible } from './windowState'
import type { UpdateStatus } from '../../shared/types'

function showUpdateToast(version: string): void {
  // The Games tab (screen 'main') already shows this exact info via its own
  // banner (UpdateAvailableBanner), and Settings shows it via the About
  // card's own "Download update" row (including right after a manual
  // "Check for updates" click there) — popping the bottom-center toast too
  // would just be the same message twice at once while either is the one
  // actually on screen (Vitalii's call, 2026-07-30, extended 2026-07-30
  // after he hit this from Settings specifically). Anywhere else (another
  // tab, minimized, tray) the toast is the only thing that reaches the
  // user, so it still fires as usual.
  if (isScreenVisible('main') || isScreenVisible('settings')) return
  showToast('update-available', { version })
}

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

// The bell entry should appear once per version, not on every 6h re-check
// while the same release is still latest (autoDownload is off, so a user who
// hasn't downloaded yet would otherwise get spammed every cycle) — and not
// once per process either: this is persisted (not just an in-memory var) so
// quitting via the tray and relaunching while the same version is still
// available doesn't add a duplicate bell entry each time.
//
// The OS toast is deliberately NOT deduped the same way — it re-fires on
// every check (startup, the 6h periodic recheck, and manual "Check for
// updates" clicks) for as long as the update is still there. The bell is a
// permanent record you can always go back and read, so once is enough; the
// toast is the only thing that reaches you if CoopSync is sitting quietly in
// the tray, so if you missed it (or dismissed it, or cleared the whole
// Action Center) it should simply show up again next time, not go silent
// for good.
// Guards downloadUpdate() below against firing autoUpdater.downloadUpdate()
// more than once for the same available version — three independent UI
// surfaces (Settings, the MainScreen banner, the update toast) can each
// send a click before the FIRST 'download-progress' event round-trips back
// and flips their button away from "available", so without this a fast
// double-click (or clicking two of the three surfaces in that same window)
// used to kick off two overlapping downloads. Two real electron-updater
// downloads racing each other is exactly what made the percent shown in the
// UI jump around non-monotonically (20% / 40% / 80% / back to 0%) instead
// of climbing — each stream reports its own progress against the same
// 'download-progress' listener above.
let downloadInFlight = false

// Same reasoning as checkTimeout above, one step later: electron-updater can
// go silent mid-download too (not just during the initial check), and with
// downloadInFlight now the ONLY thing standing between a stuck download and
// an unusable "Download" button, a silent hang would previously have been
// masked by a double-click accidentally starting a second, working attempt.
// Rearmed on every real 'download-progress' tick, so a big file on a slow
// connection is never mistaken for stalled as long as it keeps moving at
// all — only genuine silence for this long forces a recoverable error state.
const DOWNLOAD_STALL_MS = 60_000
let downloadStallTimer: ReturnType<typeof setTimeout> | null = null

function clearDownloadStallTimer(): void {
  if (downloadStallTimer) {
    clearTimeout(downloadStallTimer)
    downloadStallTimer = null
  }
}

function armDownloadStallTimer(): void {
  clearDownloadStallTimer()
  downloadStallTimer = setTimeout(() => {
    downloadStallTimer = null
    downloadInFlight = false
    send({ state: 'error', message: 'download stalled' })
  }, DOWNLOAD_STALL_MS)
}

autoUpdater.on('checking-for-update', () => send({ state: 'checking' }))
autoUpdater.on('update-available', (info) => {
  clearCheckTimeout()
  clearDownloadStallTimer()
  downloadInFlight = false
  send({ state: 'available', version: info.version })
  if (getLastNotifiedUpdateVersion() !== info.version) {
    setLastNotifiedUpdateVersion(info.version)
    addNotification('update-available', { version: info.version })
  }
  showUpdateToast(info.version)
})
autoUpdater.on('update-not-available', () => {
  clearCheckTimeout()
  send({ state: 'not-available' })
})
autoUpdater.on('download-progress', (p) => {
  armDownloadStallTimer()
  send({ state: 'downloading', percent: Math.round(p.percent) })
})
autoUpdater.on('update-downloaded', (info) => {
  clearDownloadStallTimer()
  downloadInFlight = false
  send({ state: 'downloaded', version: info.version })
})
autoUpdater.on('error', (err) => {
  clearCheckTimeout()
  clearDownloadStallTimer()
  downloadInFlight = false
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

// origin distinguishes "started from the toast's own button" from "started
// from Settings or the Games-tab banner" (ipc.ts's setActionHandler passes
// 'toast', the 'updater:download' IPC handler below defaults to 'ui').
// Only the 'ui' case dismisses the update-available toast — if it was the
// toast's OWN button that was clicked, it stays open and tracks the download
// live instead (see ToastCard's update-available special-case), since it's
// the only surface visible right then.
export function downloadUpdate(origin: 'ui' | 'toast' = 'ui'): void {
  if (!app.isPackaged) return
  if (downloadInFlight) return
  downloadInFlight = true
  if (origin === 'ui') dismissToastsOfKind('update-available')
  // Armed here too, not just on the first 'download-progress' tick — covers
  // a hang so complete that not even one progress event ever arrives.
  armDownloadStallTimer()
  void autoUpdater.downloadUpdate()
}

// Same reasoning as downloadInFlight above, one step later: "Restart to
// install" also exists on all 3 surfaces (Settings, the MainScreen banner,
// the update toast), and quitAndInstall() takes a moment to actually tear
// the app down — long enough for a fast double-click (or clicking two
// surfaces) to fire it twice before the first call's quit takes effect.
let installTriggered = false

export function quitAndInstall(): void {
  if (installTriggered) return
  installTriggered = true
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

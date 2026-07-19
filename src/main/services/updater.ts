import { app, BrowserWindow, Notification } from 'electron'
import { autoUpdater } from 'electron-updater'
import { readSettings } from './settingsStore'
import { addNotification } from './notificationStore'
import { getLastNotifiedUpdateVersion, setLastNotifiedUpdateVersion } from './backgroundState'
import type { UpdateStatus } from '../../shared/types'

// Minimal separate i18n for the native OS toast — mirrors trayIcon.ts's
// approach (doesn't pull in the renderer's full i18n bundle for two strings).
type ToastLang = 'en' | 'uk' | 'de' | 'fr' | 'pl' | 'ru' | 'es' | 'pt-BR' | 'tr' | 'zh-CN'
const UPDATE_TOAST: Record<ToastLang, { title: string; message: (v: string) => string }> = {
  en: { title: 'Update available', message: (v) => `CoopSync v${v} is ready to download.` },
  uk: { title: 'Доступне оновлення', message: (v) => `CoopSync v${v} готовий до завантаження.` },
  de: { title: 'Update verfügbar', message: (v) => `CoopSync v${v} ist bereit zum Herunterladen.` },
  fr: { title: 'Mise à jour disponible', message: (v) => `CoopSync v${v} est prêt à être téléchargé.` },
  pl: { title: 'Dostępna aktualizacja', message: (v) => `CoopSync v${v} jest gotowy do pobrania.` },
  ru: { title: 'Доступно обновление', message: (v) => `CoopSync v${v} готов к загрузке.` },
  es: { title: 'Actualización disponible', message: (v) => `CoopSync v${v} está listo para descargar.` },
  'pt-BR': { title: 'Atualização disponível', message: (v) => `O CoopSync v${v} está pronto para baixar.` },
  tr: { title: 'Güncelleme mevcut', message: (v) => `CoopSync v${v} indirilmeye hazır.` },
  'zh-CN': { title: '有可用更新', message: (v) => `CoopSync v${v} 已准备好下载。` }
}

// Set once from index.ts (same pattern as trayIcon.ts's onOpen callback) —
// lets the toast's click bring the window up without going through a
// renderer IPC round-trip, which depends on that renderer's page still being
// alive/unfrozen. The window can be hidden for a long stretch (tray) before
// the first update check ever fires, and a backgrounded renderer that never
// got shown is exactly the case where relying on its JS to run is fragile.
let onShowWindow: (() => void) | null = null

export function setShowWindowCallback(fn: () => void): void {
  onShowWindow = fn
}

// Kept at module scope (not just a local in showUpdateToast) so it can't be
// garbage-collected while the toast is still sitting in the Windows Action
// Center waiting to be clicked.
let currentToast: Notification | null = null

function showUpdateToast(version: string): void {
  if (!Notification.isSupported()) return
  const lang = (readSettings().language as ToastLang) ?? 'en'
  const strings = UPDATE_TOAST[lang] ?? UPDATE_TOAST.en
  currentToast = new Notification({ title: strings.title, body: strings.message(version) })
  currentToast.on('click', () => onShowWindow?.())
  currentToast.show()
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
autoUpdater.on('checking-for-update', () => send({ state: 'checking' }))
autoUpdater.on('update-available', (info) => {
  clearCheckTimeout()
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

import { app, BrowserWindow, shell, nativeTheme } from 'electron'
import { join } from 'path'
import { registerIpcHandlers } from './ipc'
import { createTray } from './trayIcon'
import { consumeInstallerLanguage, readSettings, writeSettings } from './services/settingsStore'
import { scheduleStartupCheck } from './services/updater'

// On some older GPUs (especially AMD) the Electron/Chromium GPU process
// crashes on startup and the app doesn't open at all. The UI is simple
// (cards, light animations), so we disable hardware acceleration
// unconditionally for everyone — the loss of smoothness from software
// rendering is unnoticeable.
app.disableHardwareAcceleration()

// On some AMD cards (e.g. RX 6600) even disableHardwareAcceleration()
// doesn't help: Chromium still spins up a separate GPU process (for
// software rendering too), it crashes several times in a row, and once
// retries are exhausted the app terminates fatally ("GPU process isn't
// usable. Goodbye."). in-process-gpu removes that separate process
// entirely — the GPU service runs in the main process, so there's nothing
// left to crash.
app.commandLine.appendSwitch('in-process-gpu')

// Single app instance: without this, manually launching the .exe a second
// time (or launching it by hand while autostart already brought the app up
// in the tray) would open a SECOND separate process — two watchers pulling
// on the same git clone in userData at once, which can break sync with a
// race condition. requestSingleInstanceLock() returns false in the second
// process — it exits immediately, and the first process (via
// 'second-instance') brings its window up.
const gotSingleInstanceLock = app.requestSingleInstanceLock()

if (!gotSingleInstanceLock) {
  app.quit()
} else {
  let mainWindow: BrowserWindow | null = null
  let isQuitting = false // true only when the user actually quits (via tray)

  function createWindow(): void {
    mainWindow = new BrowserWindow({
      width: 960,
      height: 840,
      minWidth: 880,
      minHeight: 700,
      show: false,
      // 'hidden' (not frame:false): hides the native titlebar but keeps
      // the system window border — otherwise on Windows 11, light stripes
      // appear along the edges in windowed mode.
      titleBarStyle: 'hidden',
      backgroundColor: '#1e1e2e',
      title: 'CoopSync',
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        sandbox: false
      }
    })

    // If launched from autostart minimized (--hidden) — don't show the
    // window, leave the app in the tray.
    const startHidden = process.argv.includes('--hidden')
    mainWindow.on('ready-to-show', () => {
      if (!startHidden) mainWindow?.show()
    })

    // Notify the renderer about maximize state changes (for the window button icon).
    mainWindow.on('maximize', () => mainWindow?.webContents.send('window:maximized-change', true))
    mainWindow.on('unmaximize', () => mainWindow?.webContents.send('window:maximized-change', false))

    // Closing the window doesn't quit the app — hide it in the tray (keeps running in the background).
    mainWindow.on('close', (event) => {
      if (!isQuitting) {
        event.preventDefault()
        mainWindow?.hide()
      }
    })

    // Open external links in the system browser, not inside the app window
    mainWindow.webContents.setWindowOpenHandler((details) => {
      shell.openExternal(details.url)
      return { action: 'deny' }
    })

    // In dev mode electron-vite serves a URL with hot-reload, in production — the built file
    if (process.env['ELECTRON_RENDERER_URL']) {
      mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
    } else {
      mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
    }
  }

  function showWindow(): void {
    if (!mainWindow) {
      createWindow()
      return
    }
    // maximize() both shows the window and maximizes it — exactly what's
    // needed after a hidden autostart (where we deliberately didn't call
    // maximize() earlier) and after a second .exe launch while the first
    // instance was sitting in the tray.
    mainWindow.maximize()
    mainWindow.focus()
  }

  // Someone launched the .exe a second time (manually, or autostart +
  // manual click on the shortcut) — instead of a second process, just bring
  // up the existing window.
  app.on('second-instance', () => {
    showWindow()
  })

  app.whenReady().then(() => {
    // Render the window in dark mode — otherwise on Windows light theme the
    // system window border is light (white stripes along the edges).
    nativeTheme.themeSource = 'dark'

    // The marker from the NSIS installer (build/installer.nsh) appears every
    // time the installer just ran — both on first install and on reinstall
    // over existing settings (without uninstalling). Previously
    // autostart+tray were only enabled based on isFirstRun() (absence of
    // app-settings.json), so they'd get reset on reinstalls — now it's tied
    // to the same marker as the language, so both are always enabled
    // consistently right after the installer runs.
    const installerLanguage = consumeInstallerLanguage()
    const justInstalled = installerLanguage !== null
    if (installerLanguage) {
      writeSettings({ language: installerLanguage })
    }
    if (justInstalled) {
      writeSettings({ startMinimized: true })
      app.setLoginItemSettings({ openAtLogin: true, args: ['--hidden'] })
    }

    registerIpcHandlers()
    createWindow()
    createTray(readSettings().language, showWindow, () => {
      isQuitting = true
      app.quit()
    })
    scheduleStartupCheck()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow()
      }
    })
  })

  // The window is hidden in the tray — do NOT quit when all windows are closed.
  // Actual quitting only happens via the tray's "Quit" item.
  app.on('window-all-closed', () => {
    // Do nothing: the app keeps running in the background with the tray icon.
  })
}

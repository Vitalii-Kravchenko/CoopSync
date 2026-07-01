import { app, BrowserWindow, shell, nativeTheme } from 'electron'
import { join } from 'path'
import { registerIpcHandlers } from './ipc'
import { createTray } from './trayIcon'
import { consumeInstallerLanguage, readSettings, writeSettings } from './services/settingsStore'

let mainWindow: BrowserWindow | null = null
let isQuitting = false // true лише коли користувач справді виходить (через трей)

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 960,
    height: 840,
    minWidth: 880,
    minHeight: 700,
    show: false,
    // 'hidden' (а не frame:false): ховаємо рідний titlebar, але лишаємо
    // системну рамку вікна — інакше на Windows 11 з'являються світлі смуги
    // по краях у віконному режимі.
    titleBarStyle: 'hidden',
    backgroundColor: '#1e1e2e',
    title: 'CoopSync',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  // Якщо запущено з автозапуску згорнутим (--hidden) — не показуємо вікно,
  // лишаємо програму в треї.
  const startHidden = process.argv.includes('--hidden')
  mainWindow.on('ready-to-show', () => {
    if (!startHidden) mainWindow?.show()
  })

  // Повідомляємо renderer про зміну стану розгортання (для іконки кнопки вікна).
  mainWindow.on('maximize', () => mainWindow?.webContents.send('window:maximized-change', true))
  mainWindow.on('unmaximize', () => mainWindow?.webContents.send('window:maximized-change', false))

  // Закриття вікна не вимикає програму — ховаємо її в трей (працює у фоні).
  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault()
      mainWindow?.hide()
    }
  })

  // Зовнішні посилання відкриваємо в системному браузері, а не у вікні застосунку
  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // У dev-режимі electron-vite дає URL з hot-reload, у продакшені — зібраний файл
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
  // maximize() і показує вікно, і розгортає його — саме те, що треба після
  // прихованого автозапуску (де ми свідомо не викликали maximize() раніше).
  mainWindow.maximize()
  mainWindow.focus()
}

app.whenReady().then(() => {
  // Малюємо вікно в темному режимі — інакше на світлій темі Windows
  // системна рамка вікна світла (білі смуги по краях).
  nativeTheme.themeSource = 'dark'

  // Маркер від NSIS-інсталятора (build/installer.nsh) з'являється щоразу, коли
  // інсталятор щойно відпрацював — і при першому встановленні, і при
  // перевстановленні поверх наявних налаштувань (без деінсталяції). Раніше
  // автозапуск+трей вмикались лише за isFirstRun() (відсутність app-settings.json),
  // тому збивались при повторних встановленнях — тепер прив'язано до того ж
  // маркера, що й мова, щоб обидва завжди узгоджено вмикались одразу після
  // роботи інсталятора.
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

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

// Вікно сховане в трей — НЕ виходимо, коли всі вікна закриті.
// Реальний вихід — лише через пункт трею "Вийти".
app.on('window-all-closed', () => {
  // Нічого не робимо: програма живе у фоні з треєм.
})

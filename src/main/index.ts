import { app, BrowserWindow, Tray, Menu, nativeImage, shell, nativeTheme } from 'electron'
import { join } from 'path'
import { registerIpcHandlers } from './ipc'
import { TRAY_ICON_BASE64 } from './trayIcon'

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let isQuitting = false // true лише коли користувач справді виходить (через трей)

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 960,
    height: 680,
    minWidth: 880,
    minHeight: 600,
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
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
}

function createTray(): void {
  const icon = nativeImage.createFromDataURL(`data:image/png;base64,${TRAY_ICON_BASE64}`)
  tray = new Tray(icon)
  tray.setToolTip('CoopSync — синхронізація кооп-сейвів')

  const menu = Menu.buildFromTemplate([
    { label: 'Відкрити CoopSync', click: showWindow },
    { type: 'separator' },
    {
      label: 'Вийти',
      click: () => {
        isQuitting = true
        app.quit()
      }
    }
  ])
  tray.setContextMenu(menu)

  // Клік по іконці трею — показати вікно.
  tray.on('click', showWindow)
}

app.whenReady().then(() => {
  // Малюємо вікно в темному режимі — інакше на світлій темі Windows
  // системна рамка вікна світла (білі смуги по краях).
  nativeTheme.themeSource = 'dark'

  registerIpcHandlers()
  createWindow()
  createTray()

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

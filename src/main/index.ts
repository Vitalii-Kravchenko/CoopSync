import { app, BrowserWindow, shell, nativeTheme } from 'electron'
import { join } from 'path'
import { registerIpcHandlers } from './ipc'

function createWindow(): void {
  const mainWindow = new BrowserWindow({
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

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  // Повідомляємо renderer про зміну стану розгортання (для іконки кнопки вікна).
  mainWindow.on('maximize', () => mainWindow.webContents.send('window:maximized-change', true))
  mainWindow.on('unmaximize', () => mainWindow.webContents.send('window:maximized-change', false))

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

app.whenReady().then(() => {
  // Малюємо вікно в темному режимі — інакше на світлій темі Windows
  // системна рамка вікна світла (білі смуги по краях).
  nativeTheme.themeSource = 'dark'

  registerIpcHandlers()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

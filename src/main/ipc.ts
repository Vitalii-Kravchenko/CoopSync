import { ipcMain, shell, clipboard } from 'electron'
import { requestDeviceCode, pollForToken, fetchUser } from './services/github'
import { saveToken, loadToken, clearToken } from './services/tokenStore'
import type { AuthStatus } from '../shared/types'

// Реєструє всі IPC-канали (виклики з renderer у main).
export function registerIpcHandlers(): void {
  // Перевірити поточний стан: чи є збережений токен і чи він робочий.
  ipcMain.handle('auth:get-status', async (): Promise<AuthStatus> => {
    const token = loadToken()
    if (!token) return { state: 'logged-out' }
    try {
      const user = await fetchUser(token)
      return { state: 'logged-in', user }
    } catch {
      // Токен протух або відкликаний — вважаємо, що не залогінені.
      return { state: 'logged-out' }
    }
  })

  // Запустити логін через device flow.
  ipcMain.handle('auth:login', async (event): Promise<AuthStatus> => {
    const { deviceCode, info } = await requestDeviceCode()

    // Віддаємо renderer код, щоб показати його користувачу.
    // Браузер НЕ відкриваємо автоматично — це робить користувач кнопкою,
    // щоб встигнути скопіювати код.
    event.sender.send('auth:device-code', info)

    // Чекаємо, поки користувач підтвердить (це може зайняти час).
    const token = await pollForToken(deviceCode, info.interval)
    saveToken(token)

    const user = await fetchUser(token)
    return { state: 'logged-in', user }
  })

  // Вийти: стерти збережений токен.
  ipcMain.handle('auth:logout', async (): Promise<AuthStatus> => {
    clearToken()
    return { state: 'logged-out' }
  })

  // Відкрити URL у системному браузері (за кнопкою користувача).
  ipcMain.handle('shell:open-external', async (_event, url: string): Promise<void> => {
    await shell.openExternal(url)
  })

  // Скопіювати текст у буфер обміну.
  ipcMain.handle('clipboard:write', (_event, text: string): void => {
    clipboard.writeText(text)
  })
}

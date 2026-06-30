import { ipcMain, shell, clipboard, BrowserWindow } from 'electron'
import {
  requestDeviceCode,
  pollForToken,
  fetchUser,
  getSavesRepo,
  createSavesRepo,
  inviteCollaborator,
  listInvitations,
  listCollaborators
} from './services/github'
import { detectGames } from './services/steam'
import { uploadGame, downloadGame, getSyncStatuses } from './services/sync'
import { SUPPORTED_GAMES } from './games/catalog'
import { saveToken, loadToken, clearToken } from './services/tokenStore'
import type {
  AuthStatus,
  SavesRepoStatus,
  PendingInvite,
  Collaborator,
  DetectedGame,
  CatalogGame,
  GameSyncStatus
} from '../shared/types'

// Кеш ніку користувача, щоб не питати GitHub при кожному запиті (важливо для поллінгу).
let cachedOwner: string | null = null

// Перевіряє, що користувач залогінений, і повертає токен + його нік (owner).
async function requireAuth(): Promise<{ token: string; owner: string }> {
  const token = loadToken()
  if (!token) throw new Error('Спершу залогінься в GitHub')
  if (!cachedOwner) {
    const user = await fetchUser(token)
    cachedOwner = user.login
  }
  return { token, owner: cachedOwner }
}

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
    cachedOwner = null
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

  // --- Спільне сховище сейвів ---

  // Поточний стан сховища: створене чи ні.
  ipcMain.handle('repo:get-status', async (): Promise<SavesRepoStatus> => {
    const { token, owner } = await requireAuth()
    const repo = await getSavesRepo(token, owner)
    return repo ? { state: 'ready', repo } : { state: 'none' }
  })

  // Створити (або підключити наявне) сховище.
  ipcMain.handle('repo:create', async (): Promise<SavesRepoStatus> => {
    const { token, owner } = await requireAuth()
    const repo = await createSavesRepo(token, owner)
    return { state: 'ready', repo }
  })

  // Запросити друга у співавтори.
  ipcMain.handle('repo:invite', async (_event, username: string): Promise<void> => {
    const { token, owner } = await requireAuth()
    await inviteCollaborator(token, owner, username.trim())
  })

  // Список ще не прийнятих запрошень.
  ipcMain.handle('repo:invitations', async (): Promise<PendingInvite[]> => {
    const { token, owner } = await requireAuth()
    return listInvitations(token, owner)
  })

  // Список співавторів, які вже прийняли запрошення.
  ipcMain.handle('repo:collaborators', async (): Promise<Collaborator[]> => {
    const { token, owner } = await requireAuth()
    return listCollaborators(token, owner)
  })

  // --- Ігри ---

  // Які підтримувані ігри встановлені та чи знайдено їхні сейви.
  ipcMain.handle('games:list', async (): Promise<DetectedGame[]> => detectGames())

  // Повний каталог підтримуваних ігор (для розділу "Усі ігри" та пошуку).
  ipcMain.handle('games:catalog', (): CatalogGame[] =>
    SUPPORTED_GAMES.map((g) => ({ appId: g.appId, name: g.name }))
  )

  // --- Синхронізація сейвів ---

  // Вивантажити сейви гри на GitHub.
  ipcMain.handle('sync:upload', async (_event, appId: string): Promise<string> => {
    const { token, owner } = await requireAuth()
    return uploadGame(token, owner, appId)
  })

  // Завантажити сейви гри з GitHub.
  ipcMain.handle('sync:download', async (_event, appId: string): Promise<string> => {
    const { token, owner } = await requireAuth()
    return downloadGame(token, owner, appId)
  })

  // Статус синку для всіх ігор (порівняння локального з GitHub).
  ipcMain.handle('sync:statuses', async (): Promise<GameSyncStatus[]> => {
    const { token, owner } = await requireAuth()
    return getSyncStatuses(token, owner)
  })

  // --- Керування вікном (для власного titlebar) ---

  ipcMain.handle('window:minimize', (event): void => {
    BrowserWindow.fromWebContents(event.sender)?.minimize()
  })

  ipcMain.handle('window:toggle-maximize', (event): void => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return
    if (win.isMaximized()) win.unmaximize()
    else win.maximize()
  })

  // Розгорнути на весь екран (викликаємо після onboarding).
  ipcMain.handle('window:maximize', (event): void => {
    BrowserWindow.fromWebContents(event.sender)?.maximize()
  })

  ipcMain.handle('window:close', (event): void => {
    BrowserWindow.fromWebContents(event.sender)?.close()
  })

  ipcMain.handle('window:is-maximized', (event): boolean => {
    return BrowserWindow.fromWebContents(event.sender)?.isMaximized() ?? false
  })
}

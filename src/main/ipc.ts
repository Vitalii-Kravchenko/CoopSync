import { app, ipcMain, shell, clipboard, BrowserWindow } from 'electron'
import { readSettings, writeSettings } from './services/settingsStore'
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
import { startWatcher, stopWatcher } from './services/watcher'
import { SUPPORTED_GAMES } from './games/catalog'
import { saveToken, loadToken, clearToken } from './services/tokenStore'
import type {
  AuthStatus,
  SavesRepoStatus,
  PendingInvite,
  Collaborator,
  DetectedGame,
  CatalogGame,
  GameSyncStatus,
  StartupSettings,
  RoleConfig
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

// Ціль синхронізації: токен + власник сховища, з яким працюємо.
// Для ролі host це я сам; для join — друг-хост. Якщо роль ще не вибрана —
// дефолтимось на свій логін.
async function syncTarget(): Promise<{ token: string; owner: string }> {
  const settings = readSettings()
  if (settings.hostOwner) {
    const token = loadToken()
    if (!token) throw new Error('Спершу залогінься в GitHub')
    return { token, owner: settings.hostOwner }
  }
  return requireAuth()
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

  // Вийти: стерти збережений токен і скинути роль (онбординг почнеться знову).
  ipcMain.handle('auth:logout', async (): Promise<AuthStatus> => {
    clearToken()
    cachedOwner = null
    writeSettings({ role: undefined, hostOwner: undefined })
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

  // Поточний стан сховища: створене чи ні (host — своє, join — друга).
  ipcMain.handle('repo:get-status', async (): Promise<SavesRepoStatus> => {
    const { token, owner } = await syncTarget()
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

  // Список ще не прийнятих запрошень (сховища host'а).
  ipcMain.handle('repo:invitations', async (): Promise<PendingInvite[]> => {
    const { token, owner } = await syncTarget()
    return listInvitations(token, owner)
  })

  // Список співавторів, які вже прийняли запрошення.
  ipcMain.handle('repo:collaborators', async (): Promise<Collaborator[]> => {
    const { token, owner } = await syncTarget()
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

  // Вивантажити сейви гри на GitHub (у сховище host'а).
  ipcMain.handle('sync:upload', async (_event, appId: string): Promise<string> => {
    const { token, owner } = await syncTarget()
    return uploadGame(token, owner, appId)
  })

  // Завантажити сейви гри з GitHub (зі сховища host'а).
  ipcMain.handle('sync:download', async (_event, appId: string): Promise<string> => {
    const { token, owner } = await syncTarget()
    return downloadGame(token, owner, appId)
  })

  // Статус синку для всіх ігор (порівняння локального зі сховищем host'а).
  ipcMain.handle('sync:statuses', async (): Promise<GameSyncStatus[]> => {
    const { token, owner } = await syncTarget()
    return getSyncStatuses(token, owner)
  })

  // --- Автосинхронізація (спостерігач процесів) ---

  // Запустити: стежимо за іграми, шлемо renderer події 'sync:auto'.
  ipcMain.handle('watcher:start', async (event): Promise<void> => {
    const { token, owner } = await syncTarget()
    startWatcher(token, owner, (e) => event.sender.send('sync:auto', e))
  })

  ipcMain.handle('watcher:stop', (): void => {
    stopWatcher()
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

  // --- Налаштування запуску ---

  ipcMain.handle('settings:get-startup', (): StartupSettings => {
    return {
      openAtLogin: app.getLoginItemSettings().openAtLogin,
      startMinimized: readSettings().startMinimized
    }
  })

  ipcMain.handle(
    'settings:set-startup',
    (_event, patch: Partial<StartupSettings>): StartupSettings => {
      const current: StartupSettings = {
        openAtLogin: app.getLoginItemSettings().openAtLogin,
        startMinimized: readSettings().startMinimized
      }
      const next: StartupSettings = { ...current, ...patch }

      writeSettings({ startMinimized: next.startMinimized })
      app.setLoginItemSettings({
        openAtLogin: next.openAtLogin,
        // На Windows запуск згорнутим робимо через аргумент.
        args: next.startMinimized ? ['--hidden'] : []
      })
      return next
    }
  )

  // --- Роль (host / join) ---

  // Поточна роль або null, якщо ще не вибрано.
  ipcMain.handle('role:get', (): RoleConfig | null => {
    const s = readSettings()
    if (!s.role || !s.hostOwner) return null
    return { role: s.role, hostOwner: s.hostOwner }
  })

  // Стати хостом: синхронізуємо власне сховище.
  ipcMain.handle('role:set-host', async (): Promise<RoleConfig> => {
    const { owner } = await requireAuth()
    writeSettings({ role: 'host', hostOwner: owner })
    return { role: 'host', hostOwner: owner }
  })

  // Підключитися до друга-хоста: перевіряємо доступ до його сховища.
  ipcMain.handle('role:join', async (_event, hostLogin: string): Promise<RoleConfig> => {
    const token = loadToken()
    if (!token) throw new Error('Спершу залогінься в GitHub')
    const host = hostLogin.trim()
    if (!host) throw new Error('Вкажи нік друга')

    const repo = await getSavesRepo(token, host)
    if (!repo) {
      throw new Error(
        `Немає доступу до сховища "${host}". Друг має створити сховище і запросити тебе у співавтори.`
      )
    }
    writeSettings({ role: 'join', hostOwner: host })
    return { role: 'join', hostOwner: host }
  })
}

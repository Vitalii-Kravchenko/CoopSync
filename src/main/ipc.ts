import { app, ipcMain, shell, clipboard, BrowserWindow, dialog } from 'electron'
import { readFileSync, statSync } from 'fs'
import { extname } from 'path'
import { makeAppError, parseAppError } from '../shared/errors'
import { readSettings, writeSettings } from './services/settingsStore'
import { updateTrayLanguage } from './trayIcon'
import {
  requestDeviceCode,
  pollForToken,
  fetchUser,
  getSavesRepo,
  createSavesRepo,
  deleteSavesRepo,
  inviteCollaborator,
  listInvitations,
  listCollaborators
} from './services/github'
import { detectGames, detectAllInstalled } from './services/steam'
import { searchSteamStore } from './services/steamSearch'
import {
  uploadGame,
  downloadGame,
  getSyncStatuses,
  getSyncHistory,
  resetLocalSaveState,
  uploadAvatar,
  getAvatars
} from './services/sync'
import { startWatcher, stopWatcher } from './services/watcher'
import { READY_GAMES } from './games/catalog'
import { saveToken, loadToken, clearToken } from './services/tokenStore'
import { sendSupportMessage } from './services/support'
import type {
  AuthStatus,
  SavesRepoStatus,
  PendingInvite,
  Collaborator,
  DetectedGame,
  CatalogGame,
  GameSyncStatus,
  SyncHistoryEntry,
  SyncResult,
  StartupSettings,
  RoleConfig,
  InstalledGame,
  GeneralSettings,
  SupportRequest,
  SteamSearchResult
} from '../shared/types'

// Максимальний розмір файлу аватара — щоб не роздувати settings.json.
const MAX_AVATAR_BYTES = 2 * 1024 * 1024
const AVATAR_MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp'
}

// Кеш ніку користувача, щоб не питати GitHub при кожному запиті (важливо для поллінгу).
let cachedOwner: string | null = null

// Перевіряє, що користувач залогінений, і повертає токен + його нік (owner).
async function requireAuth(): Promise<{ token: string; owner: string }> {
  const token = loadToken()
  if (!token) throw makeAppError('NOT_LOGGED_IN')
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
    if (!token) throw makeAppError('NOT_LOGGED_IN')
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
    } catch (e) {
      const parsed = parseAppError(e instanceof Error ? e.message : String(e))
      // GIT_AUTH_FAILED (401 — токен справді протух/відкликаний) — це і є
      // "не залогінені". Будь-що інше (нема інтернету, вичерпано ліміт
      // GitHub API) — тимчасовий збій перевірки, не привід тихо викидати
      // вже залогіненого користувача назад в онбординг.
      if (parsed && parsed.code !== 'GIT_AUTH_FAILED') {
        return { state: 'error', code: parsed.code, params: parsed.params }
      }
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

  // Версія застосунку (з package.json) — щоб не хардкодити рядок в UI і не
  // розходитись з реальною версією при кожному релізі.
  ipcMain.handle('app:get-version', (): string => app.getVersion())

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

  // Видалити репозиторій сейвів насовсім (незворотно — підтвердження вже пройшло в UI).
  ipcMain.handle('repo:delete', async (): Promise<void> => {
    const { token, owner } = await requireAuth()
    await deleteSavesRepo(token, owner)
    stopWatcher()
    await resetLocalSaveState()
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

  // Аватарки учасників зі спільного сховища (owner + collaborators), ключ — нік.
  ipcMain.handle(
    'repo:avatars',
    async (_event, logins: string[]): Promise<Record<string, string>> => {
      const { token, owner } = await syncTarget()
      return getAvatars(token, owner, logins)
    }
  )

  // --- Ігри ---

  // Які підтримувані ігри встановлені та чи знайдено їхні сейви.
  ipcMain.handle('games:list', async (): Promise<DetectedGame[]> => detectGames())

  // Усі встановлені Steam-ігри (з позначкою, чи підтримуються).
  ipcMain.handle('games:all-installed', async (): Promise<InstalledGame[]> => detectAllInstalled())

  // Каталог ГОТОВИХ до синку ігор (для розділу "Усі підтримувані" та пошуку).
  ipcMain.handle('games:catalog', (): CatalogGame[] =>
    READY_GAMES.map((g) => ({ appId: g.appId, name: g.name }))
  )

  // Пошук по всьому Steam-магазину (для "Підтримка" → "Хочу, щоб додали гру").
  ipcMain.handle(
    'games:search-store',
    async (_event, term: string): Promise<SteamSearchResult[]> => searchSteamStore(term)
  )

  // --- Синхронізація сейвів ---

  // Вивантажити сейви гри на GitHub (у сховище host'а). owner — чиє сховище
  // (для join це друг-хост), actorLogin — хто реально зараз пушить (я сам) —
  // саме він, а не owner, має піти в історію синку й автора коміту.
  ipcMain.handle('sync:upload', async (_event, appId: string): Promise<SyncResult> => {
    const { token, owner } = await syncTarget()
    const { owner: actorLogin } = await requireAuth()
    return uploadGame(token, owner, appId, actorLogin)
  })

  // Завантажити сейви гри з GitHub (зі сховища host'а).
  ipcMain.handle('sync:download', async (_event, appId: string): Promise<SyncResult> => {
    const { token, owner } = await syncTarget()
    return downloadGame(token, owner, appId)
  })

  // Статус синку для всіх ігор (порівняння локального зі сховищем host'а).
  ipcMain.handle('sync:statuses', async (): Promise<GameSyncStatus[]> => {
    const { token, owner } = await syncTarget()
    return getSyncStatuses(token, owner)
  })

  // Історія push-подій (найновіші перші).
  ipcMain.handle('sync:history', async (): Promise<SyncHistoryEntry[]> => {
    const { token, owner } = await syncTarget()
    return getSyncHistory(token, owner)
  })

  // --- Автосинхронізація (спостерігач процесів) ---

  // Запустити: стежимо за іграми, шлемо renderer події 'sync:auto'.
  ipcMain.handle('watcher:start', async (event): Promise<void> => {
    const { token, owner } = await syncTarget()
    const { owner: actorLogin } = await requireAuth()
    startWatcher(token, owner, actorLogin, (e) => event.sender.send('sync:auto', e))
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

  // Чи запущено з автозапуску Windows приховано (--hidden). Якщо так, renderer
  // не повинен викликати maximize() — це примусово показує вікно (документована
  // поведінка Electron), що ламає "стартувати згорнутим у трей".
  ipcMain.handle('window:was-started-hidden', (): boolean => process.argv.includes('--hidden'))

  // --- Налаштування запуску ---

  // На Windows getLoginItemSettings() звіряє ТОЧНИЙ збіг шляху+аргументів —
  // тож перевіряти треба з тими самими args, з якими реєстрували автозапуск
  // (--hidden, якщо увімкнено "стартувати в трей"), інакше openAtLogin хибно
  // повертає false, навіть коли запис у реєстрі насправді є.
  function loginItemArgs(startMinimized: boolean): string[] {
    return startMinimized ? ['--hidden'] : []
  }

  ipcMain.handle('settings:get-startup', (): StartupSettings => {
    const saved = readSettings()
    return {
      openAtLogin: app.getLoginItemSettings({ args: loginItemArgs(saved.startMinimized) }).openAtLogin,
      startMinimized: saved.startMinimized
    }
  })

  ipcMain.handle(
    'settings:set-startup',
    (_event, patch: Partial<StartupSettings>): StartupSettings => {
      const saved = readSettings()
      const current: StartupSettings = {
        openAtLogin: app.getLoginItemSettings({ args: loginItemArgs(saved.startMinimized) }).openAtLogin,
        startMinimized: saved.startMinimized
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

  // --- Загальні налаштування (мова, аватар) ---

  ipcMain.handle('settings:get-general', (): GeneralSettings => {
    const s = readSettings()
    return {
      language: s.language,
      avatarDataUrl: s.avatarDataUrl ?? null,
      showCloudWarning: s.showCloudWarning
    }
  })

  ipcMain.handle('settings:set-language', (_event, language: string): void => {
    writeSettings({ language })
    updateTrayLanguage(language)
  })

  ipcMain.handle('settings:set-cloud-warning', (_event, showCloudWarning: boolean): void => {
    writeSettings({ showCloudWarning })
  })

  // Відкрити діалог вибору файлу, зчитати картинку і зберегти як data URL.
  // Повертає null, якщо користувач скасував вибір.
  ipcMain.handle('settings:pick-avatar', async (event): Promise<string | null> => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const options: Electron.OpenDialogOptions = {
      title: 'Обери зображення профілю',
      filters: [{ name: 'Зображення', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp'] }],
      properties: ['openFile']
    }
    const result = await (win ? dialog.showOpenDialog(win, options) : dialog.showOpenDialog(options))
    if (result.canceled || result.filePaths.length === 0) return null

    const filePath = result.filePaths[0]
    const mime = AVATAR_MIME[extname(filePath).toLowerCase()]
    if (!mime) throw makeAppError('IMAGE_FORMAT_UNSUPPORTED')
    if (statSync(filePath).size > MAX_AVATAR_BYTES) {
      throw makeAppError('IMAGE_TOO_LARGE')
    }

    const dataUrl = `data:${mime};base64,${readFileSync(filePath).toString('base64')}`
    writeSettings({ avatarDataUrl: dataUrl })
    // Best-effort: одразу пушимо в спільне сховище, щоб друг побачив нову
    // аватарку. Якщо ще нема логіну/сховища/інтернету — не критично, просто
    // пропускаємо: локальна аватарка все одно збережена вище.
    try {
      const { token, owner } = await syncTarget()
      const { owner: actor } = await requireAuth()
      await uploadAvatar(token, owner, actor, dataUrl)
    } catch {
      // тихо ігноруємо — див. коментар вище
    }
    return dataUrl
  })

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
    if (!token) throw makeAppError('NOT_LOGGED_IN')
    const host = hostLogin.trim()
    if (!host) throw makeAppError('HOST_LOGIN_REQUIRED')

    const repo = await getSavesRepo(token, host)
    if (!repo) {
      throw makeAppError('NO_ACCESS_TO_HOST_REPO', { host })
    }
    writeSettings({ role: 'join', hostOwner: host })
    return { role: 'join', hostOwner: host }
  })

  // --- Підтримка ---

  // Надіслати звернення (баг / хочу гру / інше) на пошту Віталія через Worker-проксі.
  ipcMain.handle('support:send', async (_event, request: SupportRequest): Promise<void> => {
    await sendSupportMessage(request)
  })
}

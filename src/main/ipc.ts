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
  cancelInvitation,
  listInvitations,
  listCollaborators,
  removeCollaborator,
  leaveSharedRepo
} from './services/github'
import { detectGames, detectAllInstalled } from './services/steam'
import { searchSteamStore } from './services/steamSearch'
import {
  uploadGame,
  downloadGame,
  getSyncStatuses,
  getSyncHistory,
  revertToVersion,
  resetLocalSaveState,
  uploadAvatar,
  getAvatars
} from './services/sync'
import { startWatcher, stopWatcher } from './services/watcher'
import { markSeen } from './services/notifyState'
import { forgetPending } from './services/backgroundState'
import { getNotifications, markRead, markAllRead, clearAll } from './services/notificationStore'
import { READY_GAMES } from './games/catalog'
import { saveToken, loadToken, clearToken } from './services/tokenStore'
import { sendSupportMessage } from './services/support'
import { checkForUpdates, downloadUpdate, quitAndInstall } from './services/updater'
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
  SteamSearchResult,
  FriendSaveUpdate,
  AppNotification
} from '../shared/types'

// Max avatar file size — to keep settings.json from bloating.
const MAX_AVATAR_BYTES = 2 * 1024 * 1024
const AVATAR_MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp'
}

// Cache the user's login so we don't ask GitHub on every request (important for polling).
let cachedOwner: string | null = null

// Verifies the user is logged in and returns the token + their login (owner).
async function requireAuth(): Promise<{ token: string; owner: string }> {
  const token = loadToken()
  if (!token) throw makeAppError('NOT_LOGGED_IN')
  if (!cachedOwner) {
    const user = await fetchUser(token)
    cachedOwner = user.login
  }
  return { token, owner: cachedOwner }
}

// Sync target: token + the repo owner we're working with.
// For the host role this is myself; for join — the friend hosting. If a
// role hasn't been chosen yet, we default to our own login.
async function syncTarget(): Promise<{ token: string; owner: string }> {
  const settings = readSettings()
  if (settings.hostOwner) {
    const token = loadToken()
    if (!token) throw makeAppError('NOT_LOGGED_IN')
    return { token, owner: settings.hostOwner }
  }
  return requireAuth()
}

// Only the actual owner (host role — or no role chosen yet, which defaults
// to your own account) may manage the shared repo. A 'join' member has push
// access on GitHub but must never be able to delete the repo, invite
// someone else, or kick a collaborator — those stay host-only.
async function requireOwner(): Promise<{ token: string; owner: string }> {
  const settings = readSettings()
  if (settings.role === 'join') throw makeAppError('NOT_REPO_OWNER')
  return requireAuth()
}

// Registers all IPC channels (calls from renderer into main).
export function registerIpcHandlers(): void {
  // Check the current state: whether there's a stored token and whether it works.
  ipcMain.handle('auth:get-status', async (): Promise<AuthStatus> => {
    const token = loadToken()
    if (!token) return { state: 'logged-out' }
    try {
      const user = await fetchUser(token)
      return { state: 'logged-in', user }
    } catch (e) {
      const parsed = parseAppError(e instanceof Error ? e.message : String(e))
      // GIT_AUTH_FAILED (401 — the token is genuinely expired/revoked) is what
      // "logged out" actually means. Anything else (no internet, GitHub API
      // rate limit hit) is a temporary check failure, not a reason to
      // silently kick an already-logged-in user back into onboarding.
      if (parsed && parsed.code !== 'GIT_AUTH_FAILED') {
        return { state: 'error', code: parsed.code, params: parsed.params }
      }
      return { state: 'logged-out' }
    }
  })

  // Start login via device flow.
  ipcMain.handle('auth:login', async (event): Promise<AuthStatus> => {
    const { deviceCode, info } = await requestDeviceCode()

    // Send the code to the renderer to show the user.
    // We do NOT open the browser automatically — the user does that via a
    // button, so they have time to copy the code first.
    event.sender.send('auth:device-code', info)

    // Wait for the user to confirm (this can take a while).
    const token = await pollForToken(deviceCode, info.interval)
    saveToken(token)

    const user = await fetchUser(token)
    return { state: 'logged-in', user }
  })

  // Log out: erase the stored token and reset the role (onboarding starts over).
  ipcMain.handle('auth:logout', async (): Promise<AuthStatus> => {
    clearToken()
    cachedOwner = null
    writeSettings({ role: undefined, hostOwner: undefined })
    return { state: 'logged-out' }
  })

  // Open a URL in the system browser (triggered by the user via a button).
  ipcMain.handle('shell:open-external', async (_event, url: string): Promise<void> => {
    await shell.openExternal(url)
  })

  // App version (from package.json) — so we don't hardcode a string in the
  // UI and don't drift from the real version on every release.
  ipcMain.handle('app:get-version', (): string => app.getVersion())

  // Copy text to the clipboard.
  ipcMain.handle('clipboard:write', (_event, text: string): void => {
    clipboard.writeText(text)
  })

  // --- Shared saves repo ---

  // Current repo state: created or not (host — their own, join — the friend's).
  ipcMain.handle('repo:get-status', async (): Promise<SavesRepoStatus> => {
    const { token, owner } = await syncTarget()
    const repo = await getSavesRepo(token, owner)
    return repo ? { state: 'ready', repo } : { state: 'none' }
  })

  // Create (or connect to the existing) repo.
  ipcMain.handle('repo:create', async (): Promise<SavesRepoStatus> => {
    const { token, owner } = await requireAuth()
    const repo = await createSavesRepo(token, owner)
    return { state: 'ready', repo }
  })

  // Delete the saves repo for good (irreversible — confirmation already happened in the UI).
  // Owner-only: a 'join' member must use repo:leave instead.
  ipcMain.handle('repo:delete', async (): Promise<void> => {
    const { token, owner } = await requireOwner()
    await deleteSavesRepo(token, owner)
    stopWatcher()
    await resetLocalSaveState()
  })

  // Invite a friend as a collaborator. Owner-only.
  ipcMain.handle('repo:invite', async (_event, username: string): Promise<void> => {
    const { token, owner } = await requireOwner()
    await inviteCollaborator(token, owner, username.trim())
  })

  // Owner cancels a not-yet-accepted invitation.
  ipcMain.handle(
    'repo:cancel-invitation',
    async (_event, invitationId: number, login: string): Promise<void> => {
      const { token, owner } = await requireOwner()
      await cancelInvitation(token, owner, invitationId)
      // Tell the background "did a friend decline?" check about our own
      // cancel right away — otherwise the next cycle would see this login
      // vanish from pending and wrongly report it as them declining.
      forgetPending(login)
    }
  )

  // Owner kicks a collaborator off the shared repo.
  ipcMain.handle('repo:remove-collaborator', async (_event, username: string): Promise<void> => {
    const { token, owner } = await requireOwner()
    await removeCollaborator(token, owner, username.trim())
  })

  // A 'join' member leaves the host's shared repo — resets our role so the
  // app drops back into onboarding's "choose a role" step (still logged in).
  ipcMain.handle('repo:leave', async (): Promise<void> => {
    const settings = readSettings()
    if (settings.role !== 'join' || !settings.hostOwner) throw makeAppError('REPO_NOT_FOUND')
    const { token, owner: selfLogin } = await requireAuth()
    await leaveSharedRepo(token, settings.hostOwner, selfLogin)
    writeSettings({ role: undefined, hostOwner: undefined })
    stopWatcher()
    await resetLocalSaveState()
  })

  // List invitations that haven't been accepted yet (host's repo).
  ipcMain.handle('repo:invitations', async (): Promise<PendingInvite[]> => {
    const { token, owner } = await syncTarget()
    return listInvitations(token, owner)
  })

  // List collaborators who have already accepted their invitation.
  ipcMain.handle('repo:collaborators', async (): Promise<Collaborator[]> => {
    const { token, owner } = await syncTarget()
    return listCollaborators(token, owner)
  })

  // Avatars of members from the shared repo (owner + collaborators), keyed by login.
  ipcMain.handle(
    'repo:avatars',
    async (_event, logins: string[]): Promise<Record<string, string>> => {
      const { token, owner } = await syncTarget()
      return getAvatars(token, owner, logins)
    }
  )

  // --- Games ---

  // Which supported games are installed and whether their saves were found.
  ipcMain.handle('games:list', async (): Promise<DetectedGame[]> => detectGames())

  // All installed Steam games (flagged with whether they're supported).
  ipcMain.handle('games:all-installed', async (): Promise<InstalledGame[]> => detectAllInstalled())

  // Catalog of games READY for sync (for the "All supported" section and search).
  ipcMain.handle('games:catalog', (): CatalogGame[] =>
    READY_GAMES.map((g) => ({ appId: g.appId, name: g.name }))
  )

  // Search across the whole Steam store (for "Support" → "I want a game added").
  ipcMain.handle(
    'games:search-store',
    async (_event, term: string): Promise<SteamSearchResult[]> => searchSteamStore(term)
  )

  // --- Save sync ---

  // Upload the game's saves to GitHub (into the host's repo). owner — whose
  // repo (for join it's the host friend), actorLogin — who's actually
  // pushing right now (myself) — it's them, not owner, that should end up
  // in the sync history and as the commit author.
  ipcMain.handle('sync:upload', async (_event, appId: string): Promise<SyncResult> => {
    const { token, owner } = await syncTarget()
    const { owner: actorLogin } = await requireAuth()
    return uploadGame(token, owner, appId, actorLogin)
  })

  // Download the game's saves from GitHub (from the host's repo).
  ipcMain.handle('sync:download', async (_event, appId: string): Promise<SyncResult> => {
    const { token, owner } = await syncTarget()
    return downloadGame(token, owner, appId)
  })

  // Sync status for all games (comparing local against the host's repo).
  ipcMain.handle('sync:statuses', async (): Promise<GameSyncStatus[]> => {
    const { token, owner } = await syncTarget()
    return getSyncStatuses(token, owner)
  })

  // Push event history (newest first).
  ipcMain.handle('sync:history', async (): Promise<SyncHistoryEntry[]> => {
    const { token, owner } = await syncTarget()
    return getSyncHistory(token, owner)
  })

  // Revert a game's saves to an older version — pushed back as a new version,
  // not a branch (see revertToVersion).
  ipcMain.handle(
    'sync:revert',
    async (_event, appId: string, version: number): Promise<SyncResult> => {
      const { token, owner } = await syncTarget()
      const { owner: actorLogin } = await requireAuth()
      return revertToVersion(token, owner, appId, actorLogin, version)
    }
  )

  // The renderer just displayed these game/version pairs (Games tab opened
  // or refreshed) — clears the "unseen" nav badge for them and stops any
  // pending toast about a version the user already looked at.
  ipcMain.handle(
    'sync:mark-seen',
    (_event, entries: Array<{ appId: string; version: number }>): void => {
      for (const e of entries) markSeen(e.appId, e.version)
    }
  )

  // --- Auto-sync (process watcher) ---

  // Start it: watch games, send renderer 'sync:auto' events + 'sync:friend-update'
  // (a friend's save pushed while this device wasn't looking).
  ipcMain.handle('watcher:start', async (event): Promise<void> => {
    const { token, owner } = await syncTarget()
    const { owner: actorLogin } = await requireAuth()
    startWatcher(
      token,
      owner,
      actorLogin,
      (e) => event.sender.send('sync:auto', e),
      (updates: FriendSaveUpdate[]) => event.sender.send('sync:friend-update', updates)
    )
  })

  ipcMain.handle('watcher:stop', (): void => {
    stopWatcher()
  })

  // --- Window controls (for the custom titlebar) ---

  ipcMain.handle('window:minimize', (event): void => {
    BrowserWindow.fromWebContents(event.sender)?.minimize()
  })

  ipcMain.handle('window:toggle-maximize', (event): void => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return
    if (win.isMaximized()) win.unmaximize()
    else win.maximize()
  })

  // Maximize the window (called after onboarding).
  ipcMain.handle('window:maximize', (event): void => {
    BrowserWindow.fromWebContents(event.sender)?.maximize()
  })

  ipcMain.handle('window:close', (event): void => {
    BrowserWindow.fromWebContents(event.sender)?.close()
  })

  ipcMain.handle('window:is-maximized', (event): boolean => {
    return BrowserWindow.fromWebContents(event.sender)?.isMaximized() ?? false
  })

  // Whether launched from Windows autostart hidden (--hidden). If so, the
  // renderer must not call maximize() — that forcibly shows the window
  // (documented Electron behavior), which breaks "start minimized to tray".
  ipcMain.handle('window:was-started-hidden', (): boolean => process.argv.includes('--hidden'))

  // --- Startup settings ---

  // On Windows, getLoginItemSettings() checks for an EXACT match of
  // path+args — so it must be checked with the same args that autostart was
  // registered with (--hidden, if "start minimized to tray" is enabled),
  // otherwise openAtLogin incorrectly returns false even when the registry
  // entry actually exists.
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
        // On Windows we handle starting minimized via an argument.
        args: next.startMinimized ? ['--hidden'] : []
      })
      return next
    }
  )

  // --- General settings (language, avatar) ---

  ipcMain.handle('settings:get-general', (): GeneralSettings => {
    const s = readSettings()
    return {
      language: s.language,
      avatarDataUrl: s.avatarDataUrl ?? null,
      showCloudWarning: s.showCloudWarning,
      autoCheckUpdates: s.autoCheckUpdates
    }
  })

  ipcMain.handle('settings:set-language', (_event, language: string): void => {
    writeSettings({ language })
    updateTrayLanguage(language)
  })

  ipcMain.handle('settings:set-cloud-warning', (_event, showCloudWarning: boolean): void => {
    writeSettings({ showCloudWarning })
  })

  ipcMain.handle('settings:set-auto-check-updates', (_event, autoCheckUpdates: boolean): void => {
    writeSettings({ autoCheckUpdates })
  })

  // Open a file picker dialog, read the image, and save it as a data URL.
  // Returns null if the user cancelled the selection.
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
    // Best-effort: push to the shared repo right away so the friend sees the
    // new avatar. If there's no login/repo/internet yet — not critical, just
    // skip it: the local avatar is already saved above regardless.
    try {
      const { token, owner } = await syncTarget()
      const { owner: actor } = await requireAuth()
      await uploadAvatar(token, owner, actor, dataUrl)
    } catch {
      // silently ignore — see comment above
    }
    return dataUrl
  })

  // --- Role (host / join) ---

  // Current role, or null if not chosen yet.
  ipcMain.handle('role:get', (): RoleConfig | null => {
    const s = readSettings()
    if (!s.role || !s.hostOwner) return null
    return { role: s.role, hostOwner: s.hostOwner }
  })

  // Become host: sync our own repo.
  ipcMain.handle('role:set-host', async (): Promise<RoleConfig> => {
    const { owner } = await requireAuth()
    writeSettings({ role: 'host', hostOwner: owner })
    return { role: 'host', hostOwner: owner }
  })

  // Connect to a host friend: verify access to their repo.
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

  // --- Support ---

  // Send a message (bug / game request / other) to my email via the Worker proxy.
  ipcMain.handle('support:send', async (_event, request: SupportRequest): Promise<void> => {
    await sendSupportMessage(request)
  })

  // --- Auto-update ---

  ipcMain.handle('updater:check', (): void => checkForUpdates())
  ipcMain.handle('updater:download', (): void => downloadUpdate())
  ipcMain.handle('updater:install', (): void => quitAndInstall())

  // --- Notification bell ---

  ipcMain.handle('notifications:list', (): AppNotification[] => getNotifications())
  ipcMain.handle('notifications:mark-read', (_event, ids: string[]): void => markRead(ids))
  ipcMain.handle('notifications:mark-all-read', (): void => markAllRead())
  ipcMain.handle('notifications:clear-all', (): void => clearAll())
}

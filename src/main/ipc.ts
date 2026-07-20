import { app, ipcMain, shell, clipboard, BrowserWindow, dialog } from 'electron'
import { existsSync, readdirSync, readFileSync, statSync } from 'fs'
import { basename, extname } from 'path'
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
  leaveSharedRepo,
  acceptPendingInvite,
  listMyPendingInvites
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
  adoptLocalHistoryAsOwnRepo,
  uploadAvatar,
  getAvatars,
  pushCustomGameToRegistry,
  removeCustomGameFromRegistry,
  pushCustomGameCover
} from './services/sync'
import { startWatcher, stopWatcher } from './services/watcher'
import { markSeen } from './services/notifyState'
import { forgetPending } from './services/backgroundState'
import { getNotifications, markRead, markAllRead, clearAll } from './services/notificationStore'
import { READY_GAMES } from './games/catalog'
import { resolveSavePath, isCustomSavePath, setSavePathOverride } from './games/savePath'
import {
  getSyncableGames,
  listCustomGames,
  addCustomGame,
  removeCustomGame,
  setCustomGameCover,
  setCustomGameCoverSyncFailed,
  getCustomGameProcessNames,
  setCustomGameProcessNames,
  getCustomGameExcludedFiles,
  setCustomGameExcludedFiles,
  addPendingCustomGameRemoval
} from './games/customGames'
import { scanForExecutables } from './games/exeScan'
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
  AppNotification,
  GameSavePathInfo
} from '../shared/types'

// Max picked image file size (avatar or game cover) — to keep settings.json
// from bloating (the crop modal downsizes it further before it's ever saved).
const MAX_IMAGE_BYTES = 2 * 1024 * 1024
const IMAGE_MIME: Record<string, string> = {
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

// Minimal separate i18n for this native OS dialog — same reasoning as
// trayIcon.ts/updater.ts's own small dicts (doesn't pull in the renderer's
// full i18n bundle for two strings' worth of main-process UI).
type PickerLang = 'en' | 'uk' | 'de' | 'fr' | 'pl' | 'ru' | 'es' | 'pt-BR' | 'tr' | 'zh-CN'
const IMAGE_PICKER: Record<PickerLang, { cover: string; avatar: string; filter: string }> = {
  en: { cover: 'Choose a game cover', avatar: 'Choose a profile picture', filter: 'Images' },
  uk: { cover: 'Обери обкладинку гри', avatar: 'Обери зображення профілю', filter: 'Зображення' },
  de: { cover: 'Spielcover auswählen', avatar: 'Profilbild auswählen', filter: 'Bilder' },
  fr: { cover: 'Choisir une jaquette de jeu', avatar: 'Choisir une photo de profil', filter: 'Images' },
  pl: { cover: 'Wybierz okładkę gry', avatar: 'Wybierz zdjęcie profilowe', filter: 'Obrazy' },
  ru: { cover: 'Выбери обложку игры', avatar: 'Выбери изображение профиля', filter: 'Изображения' },
  es: { cover: 'Elige una carátula del juego', avatar: 'Elige una foto de perfil', filter: 'Imágenes' },
  'pt-BR': { cover: 'Escolha uma capa do jogo', avatar: 'Escolha uma foto de perfil', filter: 'Imagens' },
  tr: { cover: 'Bir oyun kapağı seç', avatar: 'Bir profil resmi seç', filter: 'Görseller' },
  'zh-CN': { cover: '选择游戏封面', avatar: '选择头像', filter: '图片' }
}

// Shared by settings:pick-avatar-file and games:pick-cover-file — opens an
// image file picker and returns the raw file as a data URL. No crop yet;
// the renderer's crop modal (square for avatars, 2:3 for game covers)
// handles that right after, using this as its source image.
async function pickImageFile(
  event: Electron.IpcMainInvokeEvent,
  kind: 'cover' | 'avatar'
): Promise<string | null> {
  const language = readSettings().language as PickerLang
  const strings = IMAGE_PICKER[language] ?? IMAGE_PICKER.en
  const win = BrowserWindow.fromWebContents(event.sender)
  const options: Electron.OpenDialogOptions = {
    title: strings[kind],
    filters: [{ name: strings.filter, extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp'] }],
    properties: ['openFile']
  }
  const result = await (win ? dialog.showOpenDialog(win, options) : dialog.showOpenDialog(options))
  if (result.canceled || result.filePaths.length === 0) return null

  const filePath = result.filePaths[0]
  const mime = IMAGE_MIME[extname(filePath).toLowerCase()]
  if (!mime) throw makeAppError('IMAGE_FORMAT_UNSUPPORTED')
  if (statSync(filePath).size > MAX_IMAGE_BYTES) {
    throw makeAppError('IMAGE_TOO_LARGE')
  }

  return `data:${mime};base64,${readFileSync(filePath).toString('base64')}`
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

  // Create (or connect to the existing) repo. Always ends with us owning
  // our own storage, so role/hostOwner must say so too — onboarding's host
  // path already sets this via role:set-host before ever calling here, so
  // it's a harmless no-op there, but Settings' "Create storage" (offered
  // whenever there's no working repo, e.g. after being removed as a
  // collaborator) calls this directly with no separate role step. Without
  // this, that path left role/hostOwner stuck on the old, now-inaccessible
  // host — the new repo existed on GitHub, but the app kept trying to
  // manage the OLD one (requireOwner() still saw role:'join' and rejected
  // inviting anyone to it).
  ipcMain.handle('repo:create', async (): Promise<SavesRepoStatus> => {
    const { token, owner } = await requireAuth()
    const repo = await createSavesRepo(token, owner)
    writeSettings({ role: 'host', hostOwner: owner })
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

  // Alternative to a plain repo:leave — turns the local clone (already a
  // full mirror of the host's shared history) into a brand-new repo owned
  // by us, instead of discarding it. Same end state as choosing "host" in
  // onboarding (role/hostOwner-wise), just seeded with existing history
  // rather than starting empty.
  ipcMain.handle('repo:adopt-as-own', async (): Promise<RoleConfig> => {
    const settings = readSettings()
    if (settings.role !== 'join' || !settings.hostOwner) throw makeAppError('REPO_NOT_FOUND')
    const { token, owner: selfLogin } = await requireAuth()
    stopWatcher()
    await adoptLocalHistoryAsOwnRepo(token, selfLogin, settings.hostOwner, selfLogin)
    writeSettings({ role: 'host', hostOwner: selfLogin })
    return { role: 'host', hostOwner: selfLogin }
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

  // Current save-folder location (a user override, or the catalog/custom
  // default), shown on the game's detail screen.
  ipcMain.handle('games:get-save-path', (_event, appId: string): GameSavePathInfo => {
    const g = getSyncableGames().find((x) => x.appId === appId)
    if (!g) throw makeAppError('GAME_NOT_SUPPORTED')
    const path = resolveSavePath(g)
    return { path, isCustom: isCustomSavePath(appId), exists: existsSync(path) }
  })

  // Native folder picker for manually correcting a game's save location.
  ipcMain.handle('games:pick-save-folder', async (event): Promise<string | null> => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const options: Electron.OpenDialogOptions = { properties: ['openDirectory'] }
    const result = await (win ? dialog.showOpenDialog(win, options) : dialog.showOpenDialog(options))
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })

  // Set (or clear, with path=null) a manual save-folder override for a game.
  ipcMain.handle(
    'games:set-save-path',
    (_event, appId: string, path: string | null): GameSavePathInfo => {
      const g = getSyncableGames().find((x) => x.appId === appId)
      if (!g) throw makeAppError('GAME_NOT_SUPPORTED')
      setSavePathOverride(appId, path)
      const resolved = resolveSavePath(g)
      return { path: resolved, isCustom: isCustomSavePath(appId), exists: existsSync(resolved) }
    }
  )

  // Add a game that isn't in CoopSync's built-in catalog — whole save folder
  // copied as-is (see AddGame's disclaimer in the renderer, and
  // customGames.ts's asSupportedGame). processNames (from games:scan-exes,
  // possibly empty) drives the same launch/exit auto-sync watcher as a
  // catalog game — empty means manual upload/download only.
  ipcMain.handle(
    'games:add-custom',
    async (
      _event,
      name: string,
      savePath: string,
      processNames: string[],
      coverDataUrl: string | null
    ): Promise<InstalledGame> => {
      const trimmedName = name.trim()
      if (!trimmedName || !savePath.trim()) throw makeAppError('CUSTOM_GAME_INVALID')
      const game = addCustomGame(trimmedName, savePath.trim(), processNames, coverDataUrl ?? undefined)
      // Best-effort: let a co-op partner's app see this game exists too (see
      // pushCustomGameToRegistry). The local add above already succeeded —
      // no login/repo/internet yet shouldn't block using the game on THIS
      // PC, so we don't surface a failure here (same reasoning as the
      // avatar upload right below).
      try {
        const { token, owner } = await syncTarget()
        const { owner: actor } = await requireAuth()
        await pushCustomGameToRegistry(token, owner, actor, game.appId, game.name)
      } catch {
        // silently ignore — see comment above
      }
      // The cover is tracked separately: unlike the registry entry above, a
      // failure here means a co-op partner silently never sees the cover at
      // all, with nothing on this PC hinting it didn't make it — so it's
      // persisted (setCustomGameCoverSyncFailed) and surfaced to the
      // renderer instead of swallowed, letting the user retry.
      let coverSyncFailed = false
      if (game.coverDataUrl) {
        try {
          const { token, owner } = await syncTarget()
          const { owner: actor } = await requireAuth()
          await pushCustomGameCover(token, owner, actor, game.appId, game.coverDataUrl)
        } catch {
          coverSyncFailed = true
          setCustomGameCoverSyncFailed(game.appId, true)
        }
      }
      return {
        appId: game.appId,
        name: game.name,
        supported: true,
        isCustom: true,
        coverDataUrl: game.coverDataUrl,
        coverSyncFailed
      }
    }
  )

  // Scan an install folder the user points at for candidate .exe files
  // (AddCustomGameModal) — so they don't have to know/type the exe name
  // themselves. Filters out installers/redistributables/crash reporters.
  ipcMain.handle('games:scan-exes', (_event, folderPath: string): string[] => {
    if (!folderPath || !existsSync(folderPath)) return []
    return scanForExecutables(folderPath)
  })

  // Manual fallback for when the scan above misses the real exe (filtered
  // out, nested somewhere unusual, or the user skipped picking an install
  // folder entirely) — a plain file picker, we only need the basename since
  // process matching (processCheck.ts) is by image name, not full path.
  ipcMain.handle('games:pick-exe-file', async (event): Promise<string | null> => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const options: Electron.OpenDialogOptions = {
      filters: [{ name: 'Executable', extensions: ['exe'] }],
      properties: ['openFile']
    }
    const result = await (win ? dialog.showOpenDialog(win, options) : dialog.showOpenDialog(options))
    if (result.canceled || result.filePaths.length === 0) return null
    return basename(result.filePaths[0])
  })

  // Remove a manually-added game (stops syncing it — doesn't touch its
  // local save files or anything already pushed to the shared repo).
  ipcMain.handle('games:remove-custom', async (_event, appId: string): Promise<void> => {
    removeCustomGame(appId)
    // Best-effort — no login/repo/internet yet shouldn't block removing a
    // game locally. But a partner who already materialized this game only
    // ever stops seeing it once the registry entry is actually gone (see
    // sync.ts's getSyncStatuses), so a failed push here can't just be
    // swallowed like games:add-custom's — nothing local still references
    // this appId to retry from once removeCustomGame above has already run.
    // Remembered separately instead, and retried on every check until it
    // succeeds.
    try {
      const { token, owner } = await syncTarget()
      const { owner: actor } = await requireAuth()
      await removeCustomGameFromRegistry(token, owner, actor, appId)
    } catch {
      addPendingCustomGameRemoval(appId)
    }
  })

  // Open a file picker for a custom game's cover art (2:3 poster — no Steam
  // artwork exists for it). The renderer crops it before saving.
  ipcMain.handle('games:pick-cover-file', async (event): Promise<string | null> =>
    pickImageFile(event, 'cover')
  )

  // Save (dataUrl) or clear (null) a custom game's already-cropped cover,
  // then push it to the shared repo so a co-op partner sees the same cover
  // too. Unlike games:add-custom's registry entry, a failed push here is
  // reported back (and persisted via setCustomGameCoverSyncFailed) instead
  // of swallowed — the cover would otherwise silently never reach a friend.
  ipcMain.handle(
    'games:save-cover',
    async (_event, appId: string, dataUrl: string | null): Promise<{ coverSyncFailed: boolean }> => {
      setCustomGameCover(appId, dataUrl)
      try {
        const { token, owner } = await syncTarget()
        const { owner: actor } = await requireAuth()
        await pushCustomGameCover(token, owner, actor, appId, dataUrl)
        setCustomGameCoverSyncFailed(appId, false)
        return { coverSyncFailed: false }
      } catch {
        setCustomGameCoverSyncFailed(appId, true)
        return { coverSyncFailed: true }
      }
    }
  )

  // Re-attempt pushing a custom game's cover after a previous failed push
  // (games:add-custom / games:save-cover) — reads the cover already stored
  // locally instead of requiring the renderer to resend it.
  ipcMain.handle(
    'games:retry-cover-push',
    async (_event, appId: string): Promise<{ coverSyncFailed: boolean }> => {
      const game = listCustomGames().find((g) => g.appId === appId)
      if (!game) return { coverSyncFailed: false }
      try {
        const { token, owner } = await syncTarget()
        const { owner: actor } = await requireAuth()
        await pushCustomGameCover(token, owner, actor, appId, game.coverDataUrl ?? null)
        setCustomGameCoverSyncFailed(appId, false)
        return { coverSyncFailed: false }
      } catch {
        setCustomGameCoverSyncFailed(appId, true)
        return { coverSyncFailed: true }
      }
    }
  )

  // Current .exe name(s) driving a custom game's launch/exit auto-sync —
  // read when opening its detail screen's install-folder section (a co-op
  // partner setting up their own copy of a game they didn't add themselves
  // has no other way to see/set this, unlike the save path).
  ipcMain.handle('games:get-process-names', (_event, appId: string): string[] =>
    getCustomGameProcessNames(appId)
  )

  ipcMain.handle('games:set-process-names', (_event, appId: string, names: string[]): void => {
    setCustomGameProcessNames(appId, names)
  })

  // Top-level file names (not subfolders — matches copyFiltered/
  // clearFiltered's own basename-only matching) actually sitting in a custom
  // game's resolved save folder, for the "exclude from sync" picker on its
  // detail screen. Empty if the folder doesn't exist yet or isn't set.
  ipcMain.handle('games:list-save-files', (_event, appId: string): string[] => {
    const g = getSyncableGames().find((x) => x.appId === appId)
    if (!g) return []
    const savePath = resolveSavePath(g)
    if (!savePath || !existsSync(savePath)) return []
    try {
      return readdirSync(savePath, { withFileTypes: true })
        .filter((e) => e.isFile())
        .map((e) => e.name)
    } catch {
      return []
    }
  })

  ipcMain.handle('games:get-excluded-files', (_event, appId: string): string[] =>
    getCustomGameExcludedFiles(appId)
  )

  ipcMain.handle('games:set-excluded-files', (_event, appId: string, files: string[]): void => {
    setCustomGameExcludedFiles(appId, files)
  })

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
    const { owner: actor } = await requireAuth()
    return getSyncStatuses(token, owner, actor)
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
  // (a friend's save pushed while this device wasn't looking) + a plain
  // 'sync:background-check' ping after every ~2min background status check,
  // whether or not it found a friend save update — that same check is also
  // what silently materializes a partner's new custom game or adopts their
  // cover locally (see sync.ts's getSyncStatuses), and the renderer has no
  // other way to find out either happened without this.
  ipcMain.handle('watcher:start', async (event): Promise<void> => {
    const { token, owner } = await syncTarget()
    const { owner: actorLogin } = await requireAuth()
    startWatcher(
      token,
      owner,
      actorLogin,
      (e) => event.sender.send('sync:auto', e),
      (updates: FriendSaveUpdate[]) => event.sender.send('sync:friend-update', updates),
      () => event.sender.send('sync:background-check')
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

  // Open a file picker dialog and read the raw image as a data URL — no save
  // yet, the renderer runs it through the crop modal first. Returns null if
  // the user cancelled the selection.
  ipcMain.handle('settings:pick-avatar-file', async (event): Promise<string | null> =>
    pickImageFile(event, 'avatar')
  )

  // Save the already-cropped (square, small) avatar the renderer produced
  // via <canvas> in the crop modal.
  ipcMain.handle('settings:save-avatar', async (_event, dataUrl: string): Promise<void> => {
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

    let repo = await getSavesRepo(token, host)
    if (!repo) {
      // No access yet doesn't necessarily mean "not invited" — a GitHub
      // collaborator invite has to be explicitly accepted before access
      // actually kicks in, and there's no reason to make the user go do
      // that by hand when we can just accept it for them right here.
      const accepted = await acceptPendingInvite(token, host)
      if (accepted) repo = await getSavesRepo(token, host)
    }
    if (!repo) {
      throw makeAppError('NO_ACCESS_TO_HOST_REPO', { host })
    }
    writeSettings({ role: 'join', hostOwner: host })
    return { role: 'join', hostOwner: host }
  })

  // Every saves-repo invite waiting on this account, regardless of host —
  // lets onboarding proactively say "X invited you" instead of leaving the
  // invitee with no way to find out short of already knowing to type that
  // exact username into "connect to a friend" (e.g. after leaving/being
  // removed, they have no reason to guess who might be re-inviting them).
  ipcMain.handle('role:pending-invites', async (): Promise<string[]> => {
    const token = loadToken()
    if (!token) return []
    return listMyPendingInvites(token)
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

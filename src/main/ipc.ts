import { app, ipcMain, shell, clipboard, BrowserWindow, dialog } from 'electron'
import { existsSync, readdirSync, readFileSync, rmSync, statSync } from 'fs'
import { basename, extname, join } from 'path'
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
  deleteCustomGameContent,
  renameCustomGameInRegistry,
  pushCustomGameCover,
  uploadExtraFolder,
  downloadExtraFolder,
  pushFolderToRegistry,
  removeFolderFromRegistry,
  deleteExtraFolderContent,
  getRegisteredFolderLabels
} from './services/sync'
import { startWatcher, stopWatcher, triggerFriendCheck, isCurrentlyPlaying } from './services/watcher'
import { markSeen } from './services/notifyState'
import { forgetPending } from './services/backgroundState'
import { getNotifications, markRead, markAllRead, clearAll, addNotification } from './services/notificationStore'
import { READY_GAMES } from './games/catalog'
import { resolveSavePath, isCustomSavePath, setSavePathOverride } from './games/savePath'
import {
  getSyncableGames,
  isCustomGameId,
  listCustomGames,
  addCustomGame,
  removeCustomGame,
  setCustomGameCover,
  setCustomGameCoverSyncFailed,
  setCustomGameName,
  hasInvalidGameNameChars,
  isGameNameTaken,
  getCustomGameProcessNames,
  setCustomGameProcessNames,
  getCustomGameExcludedFiles,
  setCustomGameExcludedFiles,
  addPendingCustomGameRemoval,
  getExtraFolders,
  addExtraFolder,
  removeExtraFolder,
  setExtraFolderLabel,
  setExtraFolderSavePath,
  setExtraFolderExcludedFiles,
  setExtraFolderShared,
  addPendingFolderRemoval,
  hasExtraFolderLabel,
  extraFolderPathConflict,
  restoreOrphanedCustomGame,
  restoreOrphanedFolder
} from './games/customGames'
import { isGamePersonal, setGamePersonal } from './games/syncScope'
import { scanForExecutables } from './games/exeScan'
import { saveToken, loadToken, clearToken } from './services/tokenStore'
import {
  startPresence,
  stopPresence,
  notifySavePushed,
  getPresenceSnapshot,
  getPlayingSnapshot
} from './services/presenceService'
import { mintPresenceToken } from './services/presenceJwt'
import { sendSupportMessage } from './services/support'
import { checkForUpdates, downloadUpdate, quitAndInstall } from './services/updater'
import { showToast, setActionHandler } from './services/toastWindow'
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
  GameSavePathInfo,
  CustomExtraFolder,
  PresenceConnectionState
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

// --- Presence (see presenceService.ts / ROADMAP.md §1) ---

let presenceWindow: BrowserWindow | null = null
let presenceStarted = false
// Last known state — so a screen that mounts (or remounts, e.g. tab
// revisit) after presence already connected can ask instead of waiting for
// the next onConnectionChange event (see presence:get-connection-state).
let presenceState: PresenceConnectionState = 'off'

function sendPresenceState(state: PresenceConnectionState): void {
  presenceState = state
  presenceWindow?.webContents.send('presence:connection', state)
}

// Everyone sharing our repo (owner + collaborators), by numeric GitHub id,
// excluding ourselves — the "mutual friends" list the presence server needs
// (see coopsync-server's hub.ts). Same regardless of role: for 'join' this
// naturally includes the host (repo.ownerId) plus anyone else who joined the
// same repo; for 'host' it's just our own collaborators. Swallows errors
// (no login/repo/internet yet) — presenceService retries on its own timer.
async function computeFriendIds(): Promise<number[]> {
  try {
    const { token, owner } = await syncTarget()
    const repo = await getSavesRepo(token, owner)
    if (!repo) return []
    const { owner: selfLogin } = await requireAuth()
    const ids: number[] = []
    if (owner !== selfLogin) ids.push(repo.ownerId)
    const collabs = await listCollaborators(token, owner)
    for (const c of collabs) {
      if (c.login !== selfLogin) ids.push(c.id)
    }
    return ids
  } catch {
    return []
  }
}

// Starts the presence connection if the user is logged in and it isn't
// already running. Presence has no user-facing toggle and no separate
// credential (Vitalii's call, 2026-07-28): it's always on with the main
// login, auth'd via a short-lived JWT minted from the main token right
// before every connect (see presenceJwt.ts). Called from auth:login (fresh
// onboarding) and every watcher:start (app restart into an already-logged-in
// session — main/index.ts's startup runs before any of that is known, so it
// can't bootstrap this itself).
function startPresenceIfConfigured(win: BrowserWindow): void {
  if (presenceStarted) return
  if (!loadToken()) return
  presenceStarted = true
  presenceWindow = win
  startPresence({
    onConnectionChange: sendPresenceState,
    onPresence: (id, online) => win.webContents.send('presence:changed', id, online),
    onSavePushed: (fromId, fromLogin, gameId) => {
      // Reuses the exact same check/toast the ~2min background poll would
      // eventually run on its own — just triggered right now instead of waited for.
      triggerFriendCheck()
      win.webContents.send('presence:friend-pushed', { fromId, fromLogin, gameId })
    },
    onPlaying: (id, login, gameId) => {
      const gameName = gameId ? (getSyncableGames().find((g) => g.appId === gameId)?.name ?? gameId) : null
      // Always forwarded to the renderer — the GameCard badge and the
      // Friends tab's "currently playing" line both want this regardless of
      // whether it's toast/bell-worthy (gameId null clears both just as much
      // as a real id sets them).
      win.webContents.send('presence:playing', { id, login, gameId, gameName })
      // The toast/bell notification is gated much tighter (Vitalii's call,
      // 2026-07-30): only when it's about a game *I* am also playing right
      // now — otherwise every game a friend happens to touch would interrupt
      // me regardless of relevance. Going back to null is just the badge
      // turning off, never notification-worthy either way. The OTHER half of
      // "friend was already there when I joined" lives in watcher.ts's
      // launch branch — no fresh event arrives here for that case.
      if (gameId === null || gameName === null) return
      if (!isCurrentlyPlaying(gameId)) return
      addNotification('friend-playing', { login, game: gameName })
    },
    getFriendIds: computeFriendIds,
    getAuthToken: () => {
      const token = loadToken()
      if (!token) throw new Error('not logged in')
      return mintPresenceToken(token)
    }
  })
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
  // Toast action buttons (see toastWindow.ts) — the two kinds that carry one
  // ("Update now" / "Restore just for me") both already have their real
  // handlers in scope here (imported above), same as NotificationBell's own
  // restore button and the Settings "About" card's update button.
  setActionHandler((kind, params) => {
    if (kind === 'update-available') {
      downloadUpdate()
    } else if (kind === 'game-removed') {
      restoreOrphanedCustomGame(params.appId)
    } else if (kind === 'folder-removed') {
      restoreOrphanedFolder(params.appId, params.folderId)
    }
  })

  // One-time cleanup: pre-0.9.41 versions kept a separate zero-scope
  // presence token (presence-auth.bin, its own device flow) — obsolete now
  // that presence reuses the main login via a Worker-minted JWT (see
  // presenceJwt.ts). Harmless no-op once the file is gone.
  try {
    rmSync(join(app.getPath('userData'), 'presence-auth.bin'), { force: true })
  } catch {
    // Locked/unreadable — a stray encrypted blob nothing reads anymore.
  }
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
    // Presence is always-on with the main login (see
    // startPresenceIfConfigured's doc comment) — connect right away.
    const win = BrowserWindow.fromWebContents(event.sender)
    if (win) startPresenceIfConfigured(win)
    return { state: 'logged-in', user }
  })

  // Log out: erase the stored token and reset the role (onboarding starts over).
  ipcMain.handle('auth:logout', async (): Promise<AuthStatus> => {
    clearToken()
    cachedOwner = null
    writeSettings({ role: undefined, hostOwner: undefined })
    // Presence auths via the main token (presenceJwt.ts) — with it gone
    // there's nothing to connect with anyway. Logging back in reconnects
    // automatically via auth:login/watcher:start.
    presenceStarted = false
    stopPresence()
    sendPresenceState('off')
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
    // Best-effort: a brand-new repo (first one, or a recreated one after a
    // delete) has no .meta/avatars yet — if we already have a local avatar,
    // push it right away instead of leaving it stuck until the next manual
    // "change avatar", so a friend connecting to this storage sees it immediately.
    const avatarDataUrl = readSettings().avatarDataUrl
    if (avatarDataUrl) {
      try {
        await uploadAvatar(token, owner, owner, avatarDataUrl)
      } catch {
        // Not critical — the repo itself is already created either way.
      }
    }
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
      if (hasInvalidGameNameChars(trimmedName)) throw makeAppError('GAME_NAME_INVALID_CHARS')
      // A game's name is a literal shared-repo path segment — two games
      // (custom or built-in) with the same name would overwrite each
      // other's saves. Reject the collision instead of letting it happen.
      if (isGameNameTaken(trimmedName)) throw makeAppError('GAME_NAME_TAKEN')
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

  // Remove a manually-added game — for good: deletes its save content,
  // version meta, cover, and history from the shared repo too, not just the
  // local reference (used to leave the real files behind forever, silently
  // eating GitHub storage with no way to reclaim it — Vitalii's call,
  // 2026-07-28). Never touches this game's own local save files.
  ipcMain.handle('games:remove-custom', async (_event, appId: string): Promise<void> => {
    const gameName = listCustomGames().find((g) => g.appId === appId)?.name
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
      await deleteCustomGameContent(token, owner, actor, appId, gameName)
    } catch {
      addPendingCustomGameRemoval(appId)
    }
  })

  // "Restore just for myself" from the game-removed notification (Vitalii's
  // call, 2026-07-28) — a co-op partner removed this game from the shared
  // group; the local copy was kept (never deleted, see CustomGame.orphaned),
  // this just flips it personal and re-syncs it right away so the status
  // pill doesn't sit on "orphaned" until the next launch/exit. The push is
  // best-effort — a failure here (offline, save folder briefly missing) just
  // means the game stays personal but not yet synced, exactly like any other
  // regular upload failure; the next auto-sync or manual Upload click retries it.
  ipcMain.handle('games:restore-orphaned-game', async (_event, appId: string): Promise<void> => {
    restoreOrphanedCustomGame(appId)
    setGamePersonal(appId, true)
    try {
      const { token, owner } = await syncTarget()
      const { owner: actor } = await requireAuth()
      await uploadGame(token, owner, appId, actor)
    } catch {
      // Best-effort — see doc comment above.
    }
  })

  // Current "only for me / for me and friends" setting — ANY game, catalog
  // or custom (Vitalii's call, 2026-07-28). See settingsStore.ts's
  // personalGameIds doc comment.
  ipcMain.handle('games:is-personal', (_event, appId: string): boolean => isGamePersonal(appId))

  // Flip it. A catalog game is never registry-tracked, so going personal or
  // back to shared is purely local for it — just the flag + a right-away
  // re-sync so the status pill doesn't sit stale until the next launch/exit.
  // A custom game's registry entry is deliberately left ALONE by this
  // handler either way — unlike an extra folder (each one belongs to a
  // single owner, see games:set-extra-folder-shared's NOT_FOLDER_OWNER
  // check), a shared custom game's appId can be the SAME one on more than
  // one person's machine (a co-op partner materializes it verbatim — see
  // materializeRemoteCustomGame). This handler used to call
  // unshareCustomGameFromRegistry when going personal, which removed the
  // registry entry outright — fine for the one flipping the toggle, but it
  // also unshared the game out from under anyone else who still had it
  // shared: their next getSyncStatuses self-heal would see the appId gone
  // from the registry and mark their own, still-wanted copy as
  // orphaned/removed. "Only for me" must only change where THIS user's own
  // saves sync to (main-personal/<login>, see sync.ts's mainContentDir) —
  // whether the game exists in the shared space at all is a separate
  // question, only "Remove game" (games:remove-custom) answers.
  ipcMain.handle(
    'games:set-personal',
    async (_event, appId: string, personal: boolean): Promise<void> => {
      if (personal === isGamePersonal(appId)) return
      const isCustom = isCustomGameId(appId)
      const customGame = isCustom ? listCustomGames().find((g) => g.appId === appId) : undefined

      setGamePersonal(appId, personal)
      if (isCustom && customGame) {
        if (personal) {
          // Same local-state normalization the orphan-restore path uses
          // (clears orphaned + registryConfirmed) — a deliberate personal
          // switch is never itself an "orphaned" state, and either way this
          // game must stop looking like "registered, needs a push". Purely
          // local — see doc comment above for why the registry itself isn't
          // touched here.
          restoreOrphanedCustomGame(appId)
        } else {
          try {
            const { token, owner } = await syncTarget()
            const { owner: actor } = await requireAuth()
            await pushCustomGameToRegistry(token, owner, actor, appId, customGame.name)
          } catch {
            // Best-effort — the existing self-heal in getSyncStatuses
            // already retries any custom game that isn't registryConfirmed yet.
          }
        }
      }

      try {
        const { token, owner } = await syncTarget()
        const { owner: actor } = await requireAuth()
        await uploadGame(token, owner, appId, actor)
      } catch {
        // Best-effort — a failure here just means the toggle took effect
        // locally but hasn't synced yet, same as any other upload failure.
      }
    }
  )

  // Rename a manually-added game. Unlike the cover (adopted best-effort in
  // the background), a rename touches the shared repo's folder layout — see
  // renameCustomGameInRegistry — so a failed push is surfaced to the
  // renderer instead of swallowed, and the local name only changes once the
  // remote side actually landed (avoids the registry-sync pass in
  // getSyncStatuses reverting a rename that never made it to GitHub).
  ipcMain.handle('games:rename-custom', async (_event, appId: string, name: string): Promise<void> => {
    const trimmed = name.trim()
    if (!trimmed) throw makeAppError('CUSTOM_GAME_INVALID')
    if (hasInvalidGameNameChars(trimmed)) throw makeAppError('GAME_NAME_INVALID_CHARS')
    const game = listCustomGames().find((g) => g.appId === appId)
    if (!game || game.name === trimmed) return
    if (isGameNameTaken(trimmed, appId)) throw makeAppError('GAME_NAME_TAKEN')
    if (!game.registryConfirmed) {
      // Never actually seen registered yet (initial add push still pending
      // or failed) — nothing shared to rename remotely. The existing
      // self-heal retry in getSyncStatuses will push it under this new name
      // once it lands.
      setCustomGameName(appId, trimmed)
      return
    }
    const { token, owner } = await syncTarget()
    const { owner: actor } = await requireAuth()
    await renameCustomGameInRegistry(token, owner, actor, appId, trimmed)
    setCustomGameName(appId, trimmed)
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

  // --- Extra save folders (custom games only, see CustomGame.extraFolders) ---

  ipcMain.handle('games:list-extra-folders', (_event, appId: string): CustomExtraFolder[] =>
    getExtraFolders(appId)
  )

  // Add a folder — shared:true best-effort registers it right away (same
  // reasoning as games:add-custom's registry push: a failed push here
  // doesn't block using it on this PC, self-heal in getSyncStatuses retries
  // it). shared:false is never registered at all — see CustomExtraFolder's
  // doc comment, nobody else's client ever needs to know it exists.
  ipcMain.handle(
    'games:add-extra-folder',
    async (_event, appId: string, label: string, savePath: string, shared: boolean): Promise<CustomExtraFolder> => {
      const trimmed = label.trim()
      if (!trimmed || !savePath.trim()) throw makeAppError('CUSTOM_GAME_INVALID')
      // Two folders with the same label on the same game is confusing (which
      // is which?) even though it's technically harmless (folder identity is
      // the id, not the label — see CustomExtraFolder). Reject up front
      // rather than let it happen silently. Checked locally first (cheap,
      // always available); the registry check below is best-effort on top —
      // it catches "my co-op partner already used this name", but only if
      // we can actually reach GitHub right now.
      if (hasExtraFolderLabel(appId, trimmed)) throw makeAppError('FOLDER_NAME_TAKEN')
      // A folder is synced as a whole-folder copy — if its path is the same
      // as, inside, or a parent of the main save path or another extra
      // folder, syncing one folder physically writes into the other's own
      // path, which then looks like "new content" to THAT folder too. A
      // real bug found 2026-07-26 this exact way (an extra folder pointed at
      // a subfolder of the main save path) caused a runaway feedback loop of
      // duplicate pushes — reject the setup outright instead.
      const conflict = extraFolderPathConflict(appId, savePath.trim())
      if (conflict) throw makeAppError('FOLDER_PATH_OVERLAPS', { with: conflict })
      const { owner: actor } = await requireAuth()
      try {
        const { token, owner } = await syncTarget()
        const registered = await getRegisteredFolderLabels(token, owner, appId)
        if (registered.some((l) => l.trim().toLowerCase() === trimmed.toLowerCase())) {
          throw makeAppError('FOLDER_NAME_TAKEN')
        }
      } catch (e) {
        if (parseAppError(e instanceof Error ? e.message : String(e))?.code === 'FOLDER_NAME_TAKEN') throw e
        // Couldn't reach the registry (offline, no repo yet) — not a reason
        // to block adding the folder locally, same reasoning as the
        // best-effort registry push right below.
      }
      const folder = addExtraFolder(appId, trimmed, savePath.trim(), shared, actor)
      if (shared) {
        try {
          const { token, owner } = await syncTarget()
          await pushFolderToRegistry(token, owner, actor, appId, folder.id, folder.label, actor)
        } catch {
          // silently ignore — see games:add-custom's identical reasoning
        }
      }
      return folder
    }
  )

  // Remove a folder — for good: deletes its actual synced content (and
  // registry entry, if it was shared) from the repo too, not just the local
  // reference (used to leave the real files behind forever, silently eating
  // GitHub storage with no way to reclaim it — Vitalii's call, 2026-07-28).
  // The git-side deletion is retried until it lands (games:remove-custom's
  // exact reasoning, one level down) since nothing local still references
  // this folder to retry from once removeExtraFolder below has already run.
  ipcMain.handle('games:remove-extra-folder', async (_event, appId: string, folderId: string): Promise<void> => {
    removeExtraFolder(appId, folderId)
    try {
      const { token, owner } = await syncTarget()
      const { owner: actor } = await requireAuth()
      await deleteExtraFolderContent(token, owner, actor, appId, folderId)
    } catch {
      addPendingFolderRemoval(appId, folderId)
    }
  })

  // "Restore just for myself" from the folder-removed notification — same
  // idea as games:restore-orphaned-game, one level down: flips the folder
  // personal (setExtraFolderShared's own shared:false path) and re-syncs it
  // right away, best-effort.
  ipcMain.handle(
    'games:restore-orphaned-folder',
    async (_event, appId: string, folderId: string): Promise<void> => {
      restoreOrphanedFolder(appId, folderId)
      try {
        const { token, owner } = await syncTarget()
        const { owner: actor } = await requireAuth()
        await uploadExtraFolder(token, owner, appId, folderId, actor)
      } catch {
        // Best-effort — see games:restore-orphaned-game's doc comment.
      }
    }
  )

  // A folder's label is never a repo path segment (folder.id — a uuid — is),
  // so unlike a game rename this never touches the shared repo's file
  // layout — just the registry entry, if it's shared.
  ipcMain.handle(
    'games:rename-extra-folder',
    async (_event, appId: string, folderId: string, label: string): Promise<void> => {
      const trimmed = label.trim()
      if (!trimmed) throw makeAppError('CUSTOM_GAME_INVALID')
      const folder = getExtraFolders(appId).find((f) => f.id === folderId)
      if (!folder || folder.label === trimmed) return
      setExtraFolderLabel(appId, folderId, trimmed)
      if (folder.shared && folder.registryConfirmed) {
        try {
          const { token, owner } = await syncTarget()
          const { owner: actor } = await requireAuth()
          await pushFolderToRegistry(token, owner, actor, appId, folderId, trimmed, folder.addedBy ?? actor)
        } catch {
          // Best-effort — the registry self-heal in getSyncStatuses will
          // pick up the mismatch and push the new label again next check.
        }
      }
    }
  )

  ipcMain.handle('games:pick-extra-folder-save-folder', async (event): Promise<string | null> => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const options: Electron.OpenDialogOptions = { properties: ['openDirectory'] }
    const result = await (win ? dialog.showOpenDialog(win, options) : dialog.showOpenDialog(options))
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })

  ipcMain.handle(
    'games:set-extra-folder-save-path',
    (_event, appId: string, folderId: string, path: string): void => {
      // Same overlap guard as games:add-extra-folder — excludes this
      // folder's OWN previous path from the comparison (editing it back to
      // where it already is isn't a conflict with itself).
      const conflict = extraFolderPathConflict(appId, path, folderId)
      if (conflict) throw makeAppError('FOLDER_PATH_OVERLAPS', { with: conflict })
      setExtraFolderSavePath(appId, folderId, path)
    }
  )

  // Switching shared<->personal — see CustomExtraFolder's doc comment. Going
  // personal→shared registers it (same best-effort reasoning as adding one);
  // shared→personal unregisters it, so a partner who already saw it drops it
  // too (same as removing it, without touching the local folder or its
  // already-pushed shared-bucket history).
  // Only whoever added the folder may flip this — otherwise the co-op
  // partner it was materialized for (who has zero stake in the decision,
  // they don't even control where its content ends up) could silently
  // change how the actual owner's data is being backed up. A folder from
  // before addedBy existed has no recorded owner — permissive by default,
  // see the field's own doc comment.
  ipcMain.handle(
    'games:set-extra-folder-shared',
    async (_event, appId: string, folderId: string, shared: boolean): Promise<void> => {
      const folder = getExtraFolders(appId).find((f) => f.id === folderId)
      if (!folder || folder.shared === shared) return
      const { owner: actor } = await requireAuth()
      if (folder.addedBy && folder.addedBy !== actor) throw makeAppError('NOT_FOLDER_OWNER')
      setExtraFolderShared(appId, folderId, shared)
      try {
        const { token, owner } = await syncTarget()
        if (shared) {
          await pushFolderToRegistry(token, owner, actor, appId, folderId, folder.label, actor)
        } else if (folder.registryConfirmed) {
          await removeFolderFromRegistry(token, owner, actor, appId, folderId)
        }
      } catch {
        if (shared) {
          // Self-heal in getSyncStatuses retries the registry push once the
          // folder's own registryConfirmed flag reflects it's not there yet.
        } else {
          addPendingFolderRemoval(appId, folderId)
        }
      }
    }
  )

  ipcMain.handle('games:list-extra-folder-save-files', (_event, appId: string, folderId: string): string[] => {
    const savePath = getExtraFolders(appId).find((f) => f.id === folderId)?.savePath
    if (!savePath || !existsSync(savePath)) return []
    try {
      return readdirSync(savePath, { withFileTypes: true })
        .filter((e) => e.isFile())
        .map((e) => e.name)
    } catch {
      return []
    }
  })

  ipcMain.handle('games:get-extra-folder-excluded-files', (_event, appId: string, folderId: string): string[] =>
    getExtraFolders(appId).find((f) => f.id === folderId)?.excludedFiles ?? []
  )

  ipcMain.handle(
    'games:set-extra-folder-excluded-files',
    (_event, appId: string, folderId: string, files: string[]): void => {
      setExtraFolderExcludedFiles(appId, folderId, files)
    }
  )

  // --- Save sync ---

  // Upload the game's saves to GitHub (into the host's repo). owner — whose
  // repo (for join it's the host friend), actorLogin — who's actually
  // pushing right now (myself) — it's them, not owner, that should end up
  // in the sync history and as the commit author.
  ipcMain.handle('sync:upload', async (_event, appId: string): Promise<SyncResult> => {
    const { token, owner } = await syncTarget()
    const { owner: actorLogin } = await requireAuth()
    const result = await uploadGame(token, owner, appId, actorLogin)
    if (result.pushed) notifySavePushed(appId)
    return result
  })

  // Download the game's saves from GitHub (from the host's repo).
  ipcMain.handle('sync:download', async (_event, appId: string): Promise<SyncResult> => {
    const { token, owner } = await syncTarget()
    const { owner: actor } = await requireAuth()
    return downloadGame(token, owner, appId, actor)
  })

  // Upload/download an extra folder's saves — same as sync:upload/download,
  // one level down (see games:list-extra-folders).
  ipcMain.handle(
    'sync:upload-extra-folder',
    async (_event, appId: string, folderId: string): Promise<SyncResult> => {
      const { token, owner } = await syncTarget()
      const { owner: actorLogin } = await requireAuth()
      const result = await uploadExtraFolder(token, owner, appId, folderId, actorLogin)
      if (result.pushed) notifySavePushed(appId)
      return result
    }
  )

  ipcMain.handle(
    'sync:download-extra-folder',
    async (_event, appId: string, folderId: string): Promise<SyncResult> => {
      const { token, owner } = await syncTarget()
      const { owner: actorLogin } = await requireAuth()
      return downloadExtraFolder(token, owner, appId, folderId, actorLogin)
    }
  )

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
      const result = await revertToVersion(token, owner, appId, actorLogin, version)
      notifySavePushed(appId)
      return result
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
      (updates: FriendSaveUpdate[]) => {
        event.sender.send('sync:friend-update', updates)
        for (const u of updates) {
          showToast('save-uploaded', { login: u.updatedBy, game: u.name, version: String(u.version) })
        }
      },
      () => event.sender.send('sync:background-check')
    )
    // Presence: connect if not already running (app restart while already
    // logged in — auth:login's own trigger only fires during fresh onboarding).
    const win = BrowserWindow.fromWebContents(event.sender)
    if (win) startPresenceIfConfigured(win)
  })

  ipcMain.handle('watcher:stop', (): void => {
    stopWatcher()
  })

  // --- Presence (online status + instant "friend pushed" notice) ---
  // No user-facing enable/disable — see autoEnablePresenceIfNeeded's doc comment.

  // Snapshot of currently-known friend online/offline state — for a screen
  // (Friends tab) that mounts after presence already connected and already
  // got its one-time push from the server (see presenceService.ts's
  // getPresenceSnapshot doc comment).
  ipcMain.handle('presence:get-snapshot', (): Record<number, boolean> => getPresenceSnapshot())

  // Same idea, one level down — currently-known "who's playing what" (see
  // presenceService.ts's getPlayingSnapshot doc comment). Resolves gameName
  // here too (same lookup as onPlaying above) so a screen mounting fresh
  // (e.g. opening the Friends tab) doesn't need its own catalog lookup.
  ipcMain.handle(
    'presence:get-playing-snapshot',
    (): Record<number, { login: string; gameId: string; gameName: string }> => {
      const snapshot = getPlayingSnapshot()
      const resolved: Record<number, { login: string; gameId: string; gameName: string }> = {}
      for (const [id, info] of Object.entries(snapshot)) {
        const gameName = getSyncableGames().find((g) => g.appId === info.gameId)?.name ?? info.gameId
        resolved[Number(id)] = { ...info, gameName }
      }
      return resolved
    }
  )

  // Current connection state — see presenceState's doc comment above.
  ipcMain.handle('presence:get-connection-state', (): PresenceConnectionState => presenceState)

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
    // Best-effort: same reasoning as repo:create — if we already have a
    // local avatar (set before ever connecting, or left over from a
    // previous, now-gone storage), push it to the host's repo right away
    // so they see it without us having to re-save it from Settings.
    const avatarDataUrl = readSettings().avatarDataUrl
    if (avatarDataUrl) {
      const { owner: selfLogin } = await requireAuth()
      try {
        await uploadAvatar(token, host, selfLogin, avatarDataUrl)
      } catch {
        // Not critical — access to the repo is already confirmed either way.
      }
    }
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

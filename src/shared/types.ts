// Shared types between main, preload, and renderer.
import type { ErrorCode } from './errors'

/** Data GitHub returns for device flow — shown to the user. */
export interface DeviceCodeInfo {
  /** Code the user types in on github.com (e.g. "ABCD-1234"). */
  userCode: string
  /** Page to go to and enter the code (https://github.com/login/device). */
  verificationUri: string
  /** How many seconds the code is valid for. */
  expiresIn: number
  /** How often (sec) we're allowed to poll GitHub for the result. */
  interval: number
}

/** Info about the logged-in GitHub user. */
export interface AuthUser {
  login: string
  /** Public name from the GitHub profile, if the user set one. */
  name?: string
}

/** Current auth state. 'error' — a temporary check failure (no internet,
 * GitHub API rate limit), does NOT mean the token is actually invalid —
 * unlike 'logged-out', this state must not kick the user back into onboarding. */
export type AuthStatus =
  | { state: 'logged-out' }
  | { state: 'logged-in'; user: AuthUser }
  | { state: 'error'; code: ErrorCode; params?: Record<string, string> }

/** Shared saves repo (a dedicated private repository). */
export interface SavesRepo {
  /** owner/name, e.g. "Vitalii-Kravchenko/coopsync-saves". */
  fullName: string
  /** Link to the repo on github.com. */
  url: string
}

/** State of the shared repo. */
export type SavesRepoStatus =
  | { state: 'none' } // not created yet
  | { state: 'ready'; repo: SavesRepo }

/** An invited but not-yet-accepted collaborator. */
export interface PendingInvite {
  login: string
  /** GitHub invitation id — needed to cancel the invite. */
  id: number
  /** ISO timestamp of when the invite was sent. */
  createdAt: string
}

/** A collaborator who has already accepted the invitation and has access. */
export interface Collaborator {
  login: string
}

/** A detected installed game supported by CoopSync. */
export interface DetectedGame {
  appId: string
  name: string
  /** Absolute path to the saves folder. */
  savePath: string
  /** Whether the saves folder actually exists on disk. */
  saveFound: boolean
}

/** A game from the catalog of supported games (regardless of whether it's installed). */
export interface CatalogGame {
  appId: string
  name: string
}

/** Effective save-folder location for a game — a user override if set,
 *  otherwise the catalog default (see games/catalog.ts). */
export interface GameSavePathInfo {
  path: string
  /** True if `path` is a user override, not the catalog default. */
  isCustom: boolean
  /** Whether the folder actually exists on disk right now. */
  exists: boolean
}

/** Any installed Steam game + whether CoopSync supports it. */
export interface InstalledGame {
  appId: string
  name: string
  supported: boolean
  /** True for a game the user added manually (not in CoopSync's built-in
   *  catalog) — shown with a disclaimer since its save folder isn't
   *  filtered the way SupportedGame.saveFilePattern filters a catalog game. */
  isCustom?: boolean
}

/** A user-added game not in CoopSync's built-in catalog — appId is a
 *  synthetic id ("custom:<uuid>"), not a real Steam AppID. Sync works
 *  (manual upload/download only, no launch/exit auto-sync), but the whole
 *  save folder is copied as-is — we don't know its structure well enough to
 *  filter out unrelated local files the way the catalog does. */
export interface CustomGame {
  appId: string
  name: string
  savePath: string
  /** .exe name(s) detected in the install folder the user pointed at when
   *  adding the game — drives the same launch/exit auto-sync watcher as
   *  catalog games. Empty = manual Upload/Download only, no auto-sync. */
  processNames: string[]
}

/** Sync status of a game's saves (comparing local against GitHub). */
export type SyncStatus =
  | 'synced' // local = cloud
  | 'local-newer' // local is newer → upload
  | 'remote-newer' // cloud is newer → download
  | 'local-stale' // local differs, but hasn't changed since the last sync (e.g. an old backup) → download
  | 'not-uploaded' // local exists, cloud doesn't yet
  | 'cloud-only' // cloud exists, local doesn't
  | 'no-saves' // neither exists
  | 'no-repo' // repo deleted/not connected — nothing to compare cloud versions against
  | 'needs-setup' // a co-op partner added this custom game — this PC hasn't set its local save folder yet

export interface GameSyncStatus {
  appId: string
  status: SyncStatus
  /** Local saves version (0 = not synced yet). */
  localVersion: number
  /** Saves version on GitHub (0 = not uploaded yet). */
  remoteVersion: number
  /** ISO timestamp of the last push to the cloud (shared by both players), if ever synced. */
  lastSyncAt?: string
  /** Login of whoever pushed the current cloud version, if ever synced. */
  remoteUpdatedBy?: string
  /** Saves size in bytes — of the cloud copy if it exists, otherwise the local one. */
  sizeBytes?: number
}

/** A cloud save version the local user hasn't seen yet (someone else pushed
 * it while this device wasn't looking) — used both for the OS tray
 * notification and the "Games" nav badge. */
export interface FriendSaveUpdate {
  appId: string
  name: string
  version: number
  updatedBy: string
}

/** Kinds of events shown in the notification bell (persisted, unlike the
 * transient sync toast/banner) — each maps to a title+body template in i18n. */
export type AppNotificationKind =
  | 'update-available' // params: { version }
  | 'new-games' // params: { names } (comma-joined)
  | 'friend-accepted' // params: { login }
  | 'friend-declined' // params: { login }
  | 'sync-conflict-skipped' // params: { game }
  | 'access-revoked' // params: { host }

/** A single bell entry. main only knows kind+params (like AutoSyncEvent) —
 * the renderer localizes title/body from them. */
export interface AppNotification {
  id: string
  kind: AppNotificationKind
  createdAt: string
  read: boolean
  params: Record<string, string>
}

/** Upload/download result — a version rather than ready-made text, so the
 * renderer can assemble the localized message itself (the main process
 * doesn't know the language). */
export interface SyncResult {
  version: number
  /** Whether a push (upload) actually happened. false — content already
   *  matched the cloud, the version was just synced to the already-current
   *  one, nothing changed. */
  pushed?: boolean
}

/** Auto-sync result code — the same set as manual sync, shown via the same
 * describeSyncResult(). 'push-skipped' — the cloud already got ahead of our
 * known version.
 * 'push-skipped-stale' — local content is stale (hasn't changed since the
 * last sync), auto-push was skipped to avoid overwriting the cloud.
 * 'push-skipped-nochange' — we played, but the save content didn't change
 * (hash matched the cloud) — a push wouldn't have made sense, so we don't
 * show this as "uploaded".
 * 'restore-success' — files missing locally were downloaded (without a full pull).
 * 'revert-success' — an older save version was pushed back as a new version
 * (not to be confused with 'restore-success', a different feature). */
export type SyncResultCode =
  | 'upload-success'
  | 'download-success'
  | 'push-skipped'
  | 'push-skipped-stale'
  | 'push-skipped-nochange'
  | 'restore-success'
  | 'revert-success'

/** Auto-sync event (game launch → pull, exit → push).
 * 'watcher-error' — not tied to a specific game (e.g. failed to check the
 * list of running processes) — appId/name are empty.
 * 'push-start' — fired the instant an exit is detected, before the
 * pull/upload work even begins — purely a marker so the renderer can block
 * "Restore" for that game until the matching terminal event ('push' /
 * 'push-skipped') arrives; it carries no result of its own (ok is always true). */
export interface AutoSyncEvent {
  appId: string
  name: string
  action: 'pull' | 'push' | 'push-skipped' | 'push-start' | 'watcher-error'
  ok: boolean
  /** Success — a SyncResultCode (via describeSyncResult); failure — an
   * ErrorCode from shared/errors.ts, encoded the same way as app-error (via describeError). */
  code: string
  params?: Record<string, string>
}

/** Startup settings. */
export interface StartupSettings {
  /** Launch together with Windows. */
  openAtLogin: boolean
  /** Start minimized to the tray. */
  startMinimized: boolean
}

/** General settings (language, avatar). */
export interface GeneralSettings {
  language: string
  /** Custom avatar (data URL), or null if none uploaded. */
  avatarDataUrl: string | null
  /** Whether to show the Steam Cloud warning on every launch. */
  showCloudWarning: boolean
  /** Whether to silently check GitHub for a new release shortly after launch. */
  autoCheckUpdates: boolean
}

/** A single sync history entry — one push (upload) of some game. */
export interface SyncHistoryEntry {
  appId: string
  gameName: string
  /** The version that was pushed at that moment. */
  version: number
  /** Login of whoever uploaded it. */
  updatedBy: string
  /** ISO timestamp of the push moment. */
  updatedAt: string
  /** Set when this push was a revert — the version its content was restored
   *  from, not a branch, just a new version carrying old content forward. */
  restoredFrom?: number
}

/** User's role in the co-op. */
export type UserRole = 'host' | 'join'

/** Role config: who's the host and whose repo we're syncing. */
export interface RoleConfig {
  role: UserRole
  /** Login of the repo owner (the host). For role host = myself. */
  hostOwner: string
}

/** Type of message from the "Support" button. */
export type SupportCategory = 'bug' | 'game-request' | 'idea' | 'other'

/** A game found via Steam store search (not among installed games — across all of Steam). */
export interface SteamSearchResult {
  appId: string
  name: string
  /** Ready-made image link from Steam itself (search API) — newer games
   *  serve images from hash paths that can't be built manually from appId. */
  imageUrl?: string
}

/** Max games in a single "I want a game" request — so the pool of
 *  candidates for future voting doesn't get flooded at once (enforced both
 *  in the UI and on the Worker side). */
export const MAX_GAME_REQUESTS = 3

/** A user's message sent to my email via the Worker proxy. */
export interface SupportRequest {
  category: SupportCategory
  /** For 'bug'/'other' — the message text itself. For 'game-request' — an optional comment. */
  message: string
  /** Games chosen from Steam search — only for the 'game-request' category, up to MAX_GAME_REQUESTS. */
  games?: SteamSearchResult[]
}

/** Auto-update state, pushed from main (electron-updater) to the renderer. */
export type UpdateStatus =
  | { state: 'idle' }
  | { state: 'checking' }
  | { state: 'available'; version: string }
  | { state: 'not-available' }
  | { state: 'downloading'; percent: number }
  | { state: 'downloaded'; version: string }
  | { state: 'error'; message: string }

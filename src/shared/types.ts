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
  /** Numeric GitHub id — the stable identity used for presence/signaling
   *  (logins can be renamed and even re-registered by someone else, see
   *  ROADMAP.md §1.3). */
  id: number
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
  /** Numeric GitHub id of the repo owner — for a 'join' member this is the
   *  host's stable identity, used for presence/signaling (see AuthUser.id). */
  ownerId: number
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
  /** Numeric GitHub id — used for presence/signaling (see AuthUser.id). */
  id: number
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
  /** See InstalledGame.experimental / catalog.ts's SupportedGame.experimental. */
  experimental?: boolean
}

/** A cloud-sync client already syncing a save folder on its own — see
 *  games/cloudSyncPaths.ts. */
export type CloudSyncProvider = 'onedrive' | 'dropbox'

/** A game whose save folder sits inside a OneDrive/Dropbox-synced folder —
 *  double-syncing the same files can corrupt saves (see games/cloudSyncPaths.ts). */
export interface CloudSyncConflict {
  appId: string
  name: string
  provider: CloudSyncProvider
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
  /** Custom game's own cover art, if set — GameCard/GameDetailScreen use
   *  this instead of the Steam poster (there isn't one). */
  coverDataUrl?: string
  /** True if the last attempt to push coverDataUrl to the shared repo
   *  failed (no login/repo/internet at the time) — the cover still shows
   *  on this PC, but a co-op partner won't see it until a retry succeeds. */
  coverSyncFailed?: boolean
  /** True while this game's shared/personal file split is still unconfirmed
   *  by real co-op sessions — see catalog.ts's SupportedGame.experimental.
   *  Only meaningful when supported is true. */
  experimental?: boolean
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
  /** User-picked, cropped cover art (2:3, a JPEG data URL) — there's no
   *  Steam poster for a game outside the catalog. */
  coverDataUrl?: string
  /** True if the last attempt to push coverDataUrl to the shared repo
   *  failed — cleared the next time a push (initial or retry) succeeds. */
  coverSyncFailed?: boolean
  /** Exact file names (not paths — matched the same way saveFilePattern
   *  matches a catalog game, by basename only) to leave out of sync — local
   *  settings, account data, anything sitting in the save folder that isn't
   *  actually save data. Local to this machine, not pushed to a co-op
   *  partner (unlike the name/save-path registry entry). */
  excludedFiles?: string[]
  /** True once this appId has actually been observed present in the shared
   *  registry at least once (see sync.ts's getSyncStatuses). Whoever adds a
   *  game locally starts with this unset — the very first push to the
   *  registry might still be in flight or have failed, so a missing entry
   *  just means "keep retrying". Once it's true, though, a later
   *  disappearance means someone (owner or not — anyone can remove any
   *  custom game) removed it on purpose, and the right response is to drop
   *  the local copy, not fight the removal by pushing it straight back.
   *  Without this, whoever originally added a game would have their client
   *  silently "resurrect" it in the registry forever, since from their
   *  side a missing registry entry looked identical to their own initial
   *  push having failed. */
  registryConfirmed?: boolean
  /** Set by getSyncStatuses' self-heal the moment it notices someone else
   *  removed this game from the shared registry (see registryConfirmed
   *  above) — replaces the old behavior of silently deleting the local copy
   *  too. Local files/settings are left untouched; the game just stops
   *  syncing until the user picks a next step via the game-removed
   *  notification's Restore action, which sets it personal — see
   *  settingsStore.ts's personalGameIds (the "just for me / for me and
   *  friends" toggle applies to ANY game, catalog or custom, so it isn't a
   *  field here) — same idea one level down as CustomExtraFolder.orphaned. */
  orphaned?: boolean
  /** Additional save folders beyond the one above (e.g. a folder for
   *  character saves kept separate from world saves, Terraria-style) — each
   *  is independently synced. Optional/undefined = none added. */
  extraFolders?: CustomExtraFolder[]
}

/** An additional save folder attached to a CustomGame (see
 *  CustomGame.extraFolders). Unlike the game's main save folder, this is
 *  fully user-defined: label, location, exclusions, and whether it's shared
 *  with a co-op partner or private to whoever added it.
 *  `shared: true` — synced into the common bucket both players read/write,
 *  same as the game's main folder always has been (a co-op partner's client
 *  materializes it — see registryConfirmed below — and points it at their
 *  own local path).
 *  `shared: false` ("тільки для мене") — still backed up to the cloud (so it
 *  gets real version history, not just a local copy), but into a bucket
 *  namespaced by the pusher's own GitHub login — a co-op partner's client
 *  never even learns this folder exists (never registered, see sync.ts). */
export interface CustomExtraFolder {
  id: string
  label: string
  savePath: string
  excludedFiles?: string[]
  shared: boolean
  /** Only meaningful for shared=true — same self-heal reasoning as
   *  CustomGame.registryConfirmed, one level down (per folder instead of per
   *  game): true once this folder has actually been observed in the shared
   *  registry, so a later disappearance means someone removed it on purpose
   *  rather than "our own initial push is still in flight". */
  registryConfirmed?: boolean
  /** GitHub login of whoever added this folder — only they may change its
   *  shared/personal setting (ipc.ts's games:set-extra-folder-shared
   *  enforces this). Undefined for a folder added before this field existed
   *  — treated permissively (anyone may still change it) rather than
   *  locking out folders that predate the restriction. */
  addedBy?: string
  /** Same idea as CustomGame.orphaned, one level down — set when
   *  getSyncStatuses' self-heal notices this SHARED folder vanished from the
   *  registry (someone deleted it). Content/settings are left alone; syncing
   *  just stops until the user restores it "just for themself" via the
   *  folder-removed notification's Restore action, which simply flips
   *  `shared` to false (see its own doc comment) and clears this flag. */
  orphaned?: boolean
}

/** Sync status of one CustomGame.extraFolders entry — mirrors GameSyncStatus
 *  one level down. Personal (shared:false) folders always show their own
 *  pusher's version as both local and remote (nobody else's data is ever in
 *  the comparison). */
export interface FolderSyncStatus {
  folderId: string
  label: string
  shared: boolean
  status: SyncStatus
  localVersion: number
  remoteVersion: number
  lastSyncAt?: string
  remoteUpdatedBy?: string
  sizeBytes?: number
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
  | 'orphaned' // someone else removed this from the shared group — see CustomGame.orphaned/CustomExtraFolder.orphaned

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
  /** Status of each of this game's extra folders (see CustomGame.extraFolders) — empty/undefined for a catalog game or a custom game with none added. */
  extraFolders?: FolderSyncStatus[]
  /** Note attached to the CURRENT cloud version, if any (see
   *  sync.ts's setVersionNote) — mirrors the matching history entry's own
   *  note, kept in sync so it shows up here too, not just in History. */
  note?: string
  /** "Don't download this version" flag on the CURRENT cloud version. */
  broken?: boolean
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
  | 'sync-conflict-skipped' // params: { game, appId?, branch? } — appId+branch present when the local session was preserved to a conflict branch (see sync.ts's pushConflictSnapshot); "Save a copy" action pulls it out via sync:download-conflict-snapshot
  | 'access-revoked' // params: { host }
  | 'game-removed' // params: { game, appId } — game is now orphaned (see CustomGame.orphaned), Restore action re-syncs it personal-only
  | 'folder-removed' // params: { game, folder, appId, folderId } — an extra folder (CustomGame.extraFolders) went orphaned, same Restore idea one level down

/** Same events as the bell (AppNotificationKind) plus two that are toast-only —
 *  a friend's save arriving, or a friend's play session, are both transient,
 *  worth a popup but not a permanent bell entry the way "significant" events
 *  are: we only ever see either while actively looking at the game in
 *  question anyway, so a bell entry would just be a stale echo of something
 *  already gone by the time it's read (Vitalii's call, 2026-07-30). */
export type ToastKind =
  | AppNotificationKind
  | 'save-uploaded' // params: { login, game, version }
  | 'friend-playing' // params: { login, game, alreadyPlaying } — a mutual friend and I are playing the same game right now (see presenceService.ts's onPlaying). alreadyPlaying: 'true' when I'm the one joining and they were already there — the body reads "X is playing Y" instead of "X just started Y", since from my side nothing just "happened"
  | 'lock-warning' // params: { login, game, since } — repo lock-file fallback for the same warning (see sync.ts's checkAndClaimGameLock) that works even without the signaling server; since is carried for potential future use but not shown in the current copy
  | 'experimental-confirm' // params: { gameId, game } — a sync just finished for an experimental (catalog.ts's SupportedGame.experimental) game; asks "все працює?" — see experimentalConfirm.ts. Two equal-weight action buttons (yes/no), not the usual single action + dismiss ×

/** One popup shown in the OS-level toast window (see
 *  main/services/toastWindow.ts) — replaces the native Notification API
 *  everywhere in the app. language is captured at send time rather than
 *  read live by the toast window, so a language change mid-toast can't
 *  leave an already-showing toast out of sync with a fresh one appearing
 *  right after. */
export interface ToastShowPayload {
  id: string
  kind: ToastKind
  params: Record<string, string>
  createdAt: string
  language: string
}

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
 * 'push-skipped-nochange-exit' — same "nothing to upload" outcome as
 * 'push-skipped-nochange', but specifically the check that runs right when
 * the game closes — worded as its own confirmation ("checked on exit,
 * already synced") rather than the generic mid-session wording, since this
 * is the one moment the user is actually watching for confirmation that
 * everything made it up before walking away.
 * 'restore-success' — files missing locally were downloaded (without a full pull).
 * 'revert-success' — an older save version was pushed back as a new version
 * (not to be confused with 'restore-success', a different feature). */
export type SyncResultCode =
  | 'upload-success'
  | 'download-success'
  | 'push-skipped'
  | 'push-skipped-stale'
  | 'push-skipped-nochange'
  | 'push-skipped-nochange-exit'
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
  /** True for a "played, but nothing actually changed" result from an
   *  AUTOMATIC background check (mid-session, the world-save cascade, or the
   *  exit-time catch-all) — never from a manual Upload click. The app still
   *  needs to know this happened (clears the "Restore" pending-block same as
   *  any other terminal push event), but with several independent checks
   *  now able to land on the same "nothing new" answer for the same
   *  save within seconds of each other (e.g. a folder's own settle check
   *  right after the world-save cascade already covered it), showing a
   *  banner for every single one is just noise — the renderer skips
   *  queuing one when this is set. */
  silent?: boolean
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
  /** Whether to warn when a synced game's save folder is already inside a
   *  OneDrive/Dropbox-synced folder (see CloudSyncConflict). */
  showOneDriveWarning: boolean
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
  /** Free-text note attached to this specific version, after the fact (see
   *  sync.ts's setVersionNote) — e.g. "world got corrupted, don't pull this
   *  one". Never set at push time; only ever added/edited later via History. */
  note?: string
  /** "Don't download this version" flag — same idea as note, a boolean
   *  instead of free text. */
  broken?: boolean
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

/** Max screenshots attachable to a 'bug' report, and the max raw (pre-base64)
 *  size of each — enforced both in the UI and on the Worker side (a direct
 *  POST bypassing the app is always possible). Keeps the email a reasonable
 *  size regardless — Resend's own total-email-size ceiling is generous
 *  (~40MB), this is about not sending someone a needlessly huge inbox item. */
export const MAX_SCREENSHOTS = 3
export const MAX_SCREENSHOT_BYTES = 8 * 1024 * 1024

/** One screenshot attached to a 'bug' report — read client-side via
 *  FileReader, sent as base64 (content has no "data:...;base64," prefix —
 *  stripped before this is built) through main -> Worker -> Resend's
 *  `attachments` field. */
export interface SupportScreenshot {
  filename: string
  content: string
  mimeType: string
}

/** A user's message sent to my email via the Worker proxy. */
export interface SupportRequest {
  category: SupportCategory
  /** For 'bug'/'other' — the message text itself. For 'game-request' — an optional comment. */
  message: string
  /** Games chosen from Steam search — only for the 'game-request' category, up to MAX_GAME_REQUESTS. */
  games?: SteamSearchResult[]
  /** Screenshots attached to a 'bug' report, up to MAX_SCREENSHOTS. */
  screenshots?: SupportScreenshot[]
}

/** Presence server connection state (see ROADMAP.md §1 — a progressive
 *  enhancement over the polling-based friend/sync checks, the app works
 *  fully without it). 'off' — no presence token set up yet, or disabled by
 *  the user. 'connecting' covers both the initial handshake and any
 *  reconnect attempt after a drop. */
export type PresenceConnectionState = 'off' | 'connecting' | 'online' | 'error'

/** A friend's live online/offline status, keyed by their numeric GitHub id —
 *  only present for mutually-declared friends the signaling server actually
 *  reports on (see coopsync-server's hub.ts). */
export type PresenceMap = Record<number, boolean>

/** A friend just pushed a save while we're connected to the presence server
 *  — used to trigger an instant check/toast instead of waiting for the
 *  regular ~2min background poll (which stays as a fallback). */
export interface FriendPushedEvent {
  fromId: number
  fromLogin: string
  gameId: string
}

/** A mutual friend just started (or stopped) playing a game — used to drive
 *  the "friend is playing" badge on GameCard. gameId: null means they closed
 *  it (or went offline — see coopsync-server's hub.ts offline-clear). */
export interface FriendPlayingEvent {
  id: number
  login: string
  gameId: string | null
  /** Resolved display name, or null alongside gameId: null. Resolved once in
   *  main (see ipc.ts) so no renderer screen needs its own catalog lookup —
   *  falls back to the raw gameId there if the game isn't found locally. */
  gameName: string | null
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

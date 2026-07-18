import { contextBridge, ipcRenderer } from 'electron'
import type {
  AuthStatus,
  DeviceCodeInfo,
  SavesRepoStatus,
  PendingInvite,
  Collaborator,
  DetectedGame,
  CatalogGame,
  GameSyncStatus,
  SyncHistoryEntry,
  SyncResult,
  AutoSyncEvent,
  FriendSaveUpdate,
  StartupSettings,
  RoleConfig,
  InstalledGame,
  GeneralSettings,
  SupportRequest,
  SteamSearchResult,
  UpdateStatus,
  AppNotification
} from '../shared/types'

// API exposed to the renderer as window.api.
// This is the only "bridge" — the renderer has no direct access to the
// system, only to these clearly defined functions.
const api = {
  auth: {
    /** Check whether we're already logged in. */
    getStatus: (): Promise<AuthStatus> => ipcRenderer.invoke('auth:get-status'),
    /** Start login. Resolves with the final status once the user confirms. */
    login: (): Promise<AuthStatus> => ipcRenderer.invoke('auth:login'),
    /** Log out. */
    logout: (): Promise<AuthStatus> => ipcRenderer.invoke('auth:logout'),
    /** Subscribe to receive the device flow code. Returns an unsubscribe function. */
    onDeviceCode: (callback: (info: DeviceCodeInfo) => void): (() => void) => {
      const listener = (_event: unknown, info: DeviceCodeInfo): void => callback(info)
      ipcRenderer.on('auth:device-code', listener)
      return () => ipcRenderer.removeListener('auth:device-code', listener)
    }
  },
  repo: {
    /** Current state of the shared repo. */
    getStatus: (): Promise<SavesRepoStatus> => ipcRenderer.invoke('repo:get-status'),
    /** Create (or connect to the existing) repo. */
    create: (): Promise<SavesRepoStatus> => ipcRenderer.invoke('repo:create'),
    /** Delete the repo for good (irreversible). */
    delete: (): Promise<void> => ipcRenderer.invoke('repo:delete'),
    /** Invite a friend as a collaborator. */
    invite: (username: string): Promise<void> => ipcRenderer.invoke('repo:invite', username),
    /** List of invitations not yet accepted. */
    listInvitations: (): Promise<PendingInvite[]> => ipcRenderer.invoke('repo:invitations'),
    /** Owner cancels a not-yet-accepted invitation. */
    cancelInvitation: (invitationId: number, login: string): Promise<void> =>
      ipcRenderer.invoke('repo:cancel-invitation', invitationId, login),
    /** List of collaborators who have already accepted. */
    listCollaborators: (): Promise<Collaborator[]> => ipcRenderer.invoke('repo:collaborators'),
    /** Avatars of members from the shared repo (owner + collaborators), keyed by login. */
    getAvatars: (logins: string[]): Promise<Record<string, string>> =>
      ipcRenderer.invoke('repo:avatars', logins),
    /** Owner kicks a collaborator off the shared repo. */
    removeCollaborator: (username: string): Promise<void> =>
      ipcRenderer.invoke('repo:remove-collaborator', username),
    /** A 'join' member leaves the host's shared repo. */
    leave: (): Promise<void> => ipcRenderer.invoke('repo:leave')
  },
  games: {
    /** List of installed supported games. */
    list: (): Promise<DetectedGame[]> => ipcRenderer.invoke('games:list'),
    /** All installed Steam games (+ whether they're supported). */
    allInstalled: (): Promise<InstalledGame[]> => ipcRenderer.invoke('games:all-installed'),
    /** Full catalog of supported games. */
    catalog: (): Promise<CatalogGame[]> => ipcRenderer.invoke('games:catalog'),
    /** Search across the whole Steam store (not just installed games). */
    searchStore: (term: string): Promise<SteamSearchResult[]> =>
      ipcRenderer.invoke('games:search-store', term)
  },
  sync: {
    /** Upload the game's saves to GitHub. */
    upload: (appId: string): Promise<SyncResult> => ipcRenderer.invoke('sync:upload', appId),
    /** Download the game's saves from GitHub. */
    download: (appId: string): Promise<SyncResult> => ipcRenderer.invoke('sync:download', appId),
    /** Sync status for all games. */
    statuses: (): Promise<GameSyncStatus[]> => ipcRenderer.invoke('sync:statuses'),
    /** Push event history (newest first). */
    history: (): Promise<SyncHistoryEntry[]> => ipcRenderer.invoke('sync:history'),
    /** Mark game/version pairs as seen (clears the Games nav badge for them). */
    markSeen: (entries: Array<{ appId: string; version: number }>): Promise<void> =>
      ipcRenderer.invoke('sync:mark-seen', entries)
  },
  watcher: {
    /** Start auto-sync (watching game processes). */
    start: (): Promise<void> => ipcRenderer.invoke('watcher:start'),
    /** Stop auto-sync. */
    stop: (): Promise<void> => ipcRenderer.invoke('watcher:stop'),
    /** Subscribe to auto-sync events. Returns an unsubscribe function. */
    onAutoSync: (callback: (event: AutoSyncEvent) => void): (() => void) => {
      const listener = (_e: unknown, event: AutoSyncEvent): void => callback(event)
      ipcRenderer.on('sync:auto', listener)
      return () => ipcRenderer.removeListener('sync:auto', listener)
    },
    /** Subscribe to friend save updates (pushed while this device wasn't looking). */
    onFriendUpdate: (callback: (updates: FriendSaveUpdate[]) => void): (() => void) => {
      const listener = (_e: unknown, updates: FriendSaveUpdate[]): void => callback(updates)
      ipcRenderer.on('sync:friend-update', listener)
      return () => ipcRenderer.removeListener('sync:friend-update', listener)
    }
  },
  window: {
    /** Minimize the window. */
    minimize: (): Promise<void> => ipcRenderer.invoke('window:minimize'),
    /** Maximize/restore the window (▢ button). */
    toggleMaximize: (): Promise<void> => ipcRenderer.invoke('window:toggle-maximize'),
    /** Maximize the window (after onboarding). */
    maximize: (): Promise<void> => ipcRenderer.invoke('window:maximize'),
    /** Close the window. */
    close: (): Promise<void> => ipcRenderer.invoke('window:close'),
    /** Whether the window is currently maximized. */
    isMaximized: (): Promise<boolean> => ipcRenderer.invoke('window:is-maximized'),
    /** Whether launched from autostart hidden (--hidden) — then maximize() must not be called. */
    wasStartedHidden: (): Promise<boolean> => ipcRenderer.invoke('window:was-started-hidden'),
    /** Subscribe to maximize state changes. Returns an unsubscribe function. */
    onMaximizeChange: (callback: (maximized: boolean) => void): (() => void) => {
      const listener = (_event: unknown, maximized: boolean): void => callback(maximized)
      ipcRenderer.on('window:maximized-change', listener)
      return () => ipcRenderer.removeListener('window:maximized-change', listener)
    }
  },
  settings: {
    /** Current startup settings. */
    getStartup: (): Promise<StartupSettings> => ipcRenderer.invoke('settings:get-startup'),
    /** Change startup settings. */
    setStartup: (patch: Partial<StartupSettings>): Promise<StartupSettings> =>
      ipcRenderer.invoke('settings:set-startup', patch),
    /** Language and avatar. */
    getGeneral: (): Promise<GeneralSettings> => ipcRenderer.invoke('settings:get-general'),
    /** Change the UI language. */
    setLanguage: (language: string): Promise<void> =>
      ipcRenderer.invoke('settings:set-language', language),
    /** Open the avatar file picker dialog. null = cancelled. */
    pickAvatar: (): Promise<string | null> => ipcRenderer.invoke('settings:pick-avatar'),
    /** Enable/disable the Steam Cloud warning on launch. */
    setCloudWarning: (show: boolean): Promise<void> =>
      ipcRenderer.invoke('settings:set-cloud-warning', show),
    /** Enable/disable the silent update check shortly after launch. */
    setAutoCheckUpdates: (enabled: boolean): Promise<void> =>
      ipcRenderer.invoke('settings:set-auto-check-updates', enabled)
  },
  role: {
    /** Current role (or null, if not chosen yet). */
    get: (): Promise<RoleConfig | null> => ipcRenderer.invoke('role:get'),
    /** Become host (sync our own repo). */
    setHost: (): Promise<RoleConfig> => ipcRenderer.invoke('role:set-host'),
    /** Connect to a host friend's repo. */
    join: (hostLogin: string): Promise<RoleConfig> => ipcRenderer.invoke('role:join', hostLogin)
  },
  support: {
    /** Send a message (bug / game request / other) to my email. */
    send: (request: SupportRequest): Promise<void> => ipcRenderer.invoke('support:send', request)
  },
  updater: {
    /** Ask the main process to check GitHub for a newer release. */
    check: (): Promise<void> => ipcRenderer.invoke('updater:check'),
    /** Download the update found by the last check. */
    download: (): Promise<void> => ipcRenderer.invoke('updater:download'),
    /** Quit and install the downloaded update. */
    install: (): Promise<void> => ipcRenderer.invoke('updater:install'),
    /** Subscribe to update status changes. Returns an unsubscribe function. */
    onStatus: (callback: (status: UpdateStatus) => void): (() => void) => {
      const listener = (_event: unknown, status: UpdateStatus): void => callback(status)
      ipcRenderer.on('updater:status', listener)
      return () => ipcRenderer.removeListener('updater:status', listener)
    }
  },
  notifications: {
    /** Full persisted notification history (newest first). */
    list: (): Promise<AppNotification[]> => ipcRenderer.invoke('notifications:list'),
    /** Mark specific notifications as read. */
    markRead: (ids: string[]): Promise<void> => ipcRenderer.invoke('notifications:mark-read', ids),
    /** Mark everything as read (e.g. opening the bell panel). */
    markAllRead: (): Promise<void> => ipcRenderer.invoke('notifications:mark-all-read'),
    /** Clear the whole history. */
    clearAll: (): Promise<void> => ipcRenderer.invoke('notifications:clear-all'),
    /** Subscribe to the list changing (a new entry, or read/cleared elsewhere). */
    onChanged: (callback: (list: AppNotification[]) => void): (() => void) => {
      const listener = (_e: unknown, list: AppNotification[]): void => callback(list)
      ipcRenderer.on('notifications:changed', listener)
      return () => ipcRenderer.removeListener('notifications:changed', listener)
    }
  },
  /** Open a URL in the system browser. */
  openExternal: (url: string): Promise<void> => ipcRenderer.invoke('shell:open-external', url),
  /** App version (from package.json). */
  getAppVersion: (): Promise<string> => ipcRenderer.invoke('app:get-version'),
  /** Copy text to the clipboard. */
  copyToClipboard: (text: string): Promise<void> => ipcRenderer.invoke('clipboard:write', text)
}

contextBridge.exposeInMainWorld('api', api)

export type CoopSyncApi = typeof api

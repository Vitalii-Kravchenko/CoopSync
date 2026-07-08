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
  AutoSyncEvent,
  StartupSettings,
  RoleConfig,
  InstalledGame,
  GeneralSettings
} from '../shared/types'

// API, доступне в renderer як window.api.
// Це єдиний "місток" — renderer не має прямого доступу до системи,
// а лише до цих чітко визначених функцій.
const api = {
  auth: {
    /** Перевірити, чи вже залогінені. */
    getStatus: (): Promise<AuthStatus> => ipcRenderer.invoke('auth:get-status'),
    /** Запустити логін. Поверне фінальний статус, коли користувач підтвердить. */
    login: (): Promise<AuthStatus> => ipcRenderer.invoke('auth:login'),
    /** Вийти. */
    logout: (): Promise<AuthStatus> => ipcRenderer.invoke('auth:logout'),
    /** Підписатись на отримання коду device flow. Повертає функцію відписки. */
    onDeviceCode: (callback: (info: DeviceCodeInfo) => void): (() => void) => {
      const listener = (_event: unknown, info: DeviceCodeInfo): void => callback(info)
      ipcRenderer.on('auth:device-code', listener)
      return () => ipcRenderer.removeListener('auth:device-code', listener)
    }
  },
  repo: {
    /** Поточний стан спільного сховища. */
    getStatus: (): Promise<SavesRepoStatus> => ipcRenderer.invoke('repo:get-status'),
    /** Створити (або підключити наявне) сховище. */
    create: (): Promise<SavesRepoStatus> => ipcRenderer.invoke('repo:create'),
    /** Видалити сховище насовсім (незворотно). */
    delete: (): Promise<void> => ipcRenderer.invoke('repo:delete'),
    /** Запросити друга у співавтори. */
    invite: (username: string): Promise<void> => ipcRenderer.invoke('repo:invite', username),
    /** Список ще не прийнятих запрошень. */
    listInvitations: (): Promise<PendingInvite[]> => ipcRenderer.invoke('repo:invitations'),
    /** Список співавторів, які вже прийняли. */
    listCollaborators: (): Promise<Collaborator[]> => ipcRenderer.invoke('repo:collaborators')
  },
  games: {
    /** Список встановлених підтримуваних ігор. */
    list: (): Promise<DetectedGame[]> => ipcRenderer.invoke('games:list'),
    /** Усі встановлені Steam-ігри (+ чи підтримуються). */
    allInstalled: (): Promise<InstalledGame[]> => ipcRenderer.invoke('games:all-installed'),
    /** Повний каталог підтримуваних ігор. */
    catalog: (): Promise<CatalogGame[]> => ipcRenderer.invoke('games:catalog')
  },
  sync: {
    /** Вивантажити сейви гри на GitHub. */
    upload: (appId: string): Promise<string> => ipcRenderer.invoke('sync:upload', appId),
    /** Завантажити сейви гри з GitHub. */
    download: (appId: string): Promise<string> => ipcRenderer.invoke('sync:download', appId),
    /** Статус синку всіх ігор. */
    statuses: (): Promise<GameSyncStatus[]> => ipcRenderer.invoke('sync:statuses'),
    /** Історія push-подій (найновіші перші). */
    history: (): Promise<SyncHistoryEntry[]> => ipcRenderer.invoke('sync:history')
  },
  watcher: {
    /** Запустити автосинхронізацію (стеження за процесами ігор). */
    start: (): Promise<void> => ipcRenderer.invoke('watcher:start'),
    /** Зупинити автосинхронізацію. */
    stop: (): Promise<void> => ipcRenderer.invoke('watcher:stop'),
    /** Підписка на події авто-синку. Повертає функцію відписки. */
    onAutoSync: (callback: (event: AutoSyncEvent) => void): (() => void) => {
      const listener = (_e: unknown, event: AutoSyncEvent): void => callback(event)
      ipcRenderer.on('sync:auto', listener)
      return () => ipcRenderer.removeListener('sync:auto', listener)
    }
  },
  window: {
    /** Згорнути вікно. */
    minimize: (): Promise<void> => ipcRenderer.invoke('window:minimize'),
    /** Розгорнути/відновити вікно (кнопка ▢). */
    toggleMaximize: (): Promise<void> => ipcRenderer.invoke('window:toggle-maximize'),
    /** Розгорнути на весь екран (після onboarding). */
    maximize: (): Promise<void> => ipcRenderer.invoke('window:maximize'),
    /** Закрити вікно. */
    close: (): Promise<void> => ipcRenderer.invoke('window:close'),
    /** Чи вікно зараз розгорнуте. */
    isMaximized: (): Promise<boolean> => ipcRenderer.invoke('window:is-maximized'),
    /** Чи запущено з автозапуску приховано (--hidden) — тоді maximize() викликати не можна. */
    wasStartedHidden: (): Promise<boolean> => ipcRenderer.invoke('window:was-started-hidden'),
    /** Підписка на зміну стану розгортання. Повертає функцію відписки. */
    onMaximizeChange: (callback: (maximized: boolean) => void): (() => void) => {
      const listener = (_event: unknown, maximized: boolean): void => callback(maximized)
      ipcRenderer.on('window:maximized-change', listener)
      return () => ipcRenderer.removeListener('window:maximized-change', listener)
    }
  },
  settings: {
    /** Поточні налаштування запуску. */
    getStartup: (): Promise<StartupSettings> => ipcRenderer.invoke('settings:get-startup'),
    /** Змінити налаштування запуску. */
    setStartup: (patch: Partial<StartupSettings>): Promise<StartupSettings> =>
      ipcRenderer.invoke('settings:set-startup', patch),
    /** Мова та аватар. */
    getGeneral: (): Promise<GeneralSettings> => ipcRenderer.invoke('settings:get-general'),
    /** Змінити мову інтерфейсу. */
    setLanguage: (language: string): Promise<void> =>
      ipcRenderer.invoke('settings:set-language', language),
    /** Відкрити діалог вибору файлу аватара. null = скасовано. */
    pickAvatar: (): Promise<string | null> => ipcRenderer.invoke('settings:pick-avatar'),
    /** Увімкнути/вимкнути показ попередження про Steam Cloud при запуску. */
    setCloudWarning: (show: boolean): Promise<void> =>
      ipcRenderer.invoke('settings:set-cloud-warning', show)
  },
  role: {
    /** Поточна роль (або null, якщо ще не вибрано). */
    get: (): Promise<RoleConfig | null> => ipcRenderer.invoke('role:get'),
    /** Стати хостом (синхронізувати власне сховище). */
    setHost: (): Promise<RoleConfig> => ipcRenderer.invoke('role:set-host'),
    /** Підключитися до сховища друга-хоста. */
    join: (hostLogin: string): Promise<RoleConfig> => ipcRenderer.invoke('role:join', hostLogin)
  },
  /** Відкрити URL у системному браузері. */
  openExternal: (url: string): Promise<void> => ipcRenderer.invoke('shell:open-external', url),
  /** Версія застосунку (з package.json). */
  getAppVersion: (): Promise<string> => ipcRenderer.invoke('app:get-version'),
  /** Скопіювати текст у буфер обміну. */
  copyToClipboard: (text: string): Promise<void> => ipcRenderer.invoke('clipboard:write', text)
}

contextBridge.exposeInMainWorld('api', api)

export type CoopSyncApi = typeof api

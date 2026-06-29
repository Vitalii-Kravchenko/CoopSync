import { contextBridge, ipcRenderer } from 'electron'
import type {
  AuthStatus,
  DeviceCodeInfo,
  SavesRepoStatus,
  PendingInvite,
  Collaborator,
  DetectedGame
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
    /** Запросити друга у співавтори. */
    invite: (username: string): Promise<void> => ipcRenderer.invoke('repo:invite', username),
    /** Список ще не прийнятих запрошень. */
    listInvitations: (): Promise<PendingInvite[]> => ipcRenderer.invoke('repo:invitations'),
    /** Список співавторів, які вже прийняли. */
    listCollaborators: (): Promise<Collaborator[]> => ipcRenderer.invoke('repo:collaborators')
  },
  games: {
    /** Список встановлених підтримуваних ігор. */
    list: (): Promise<DetectedGame[]> => ipcRenderer.invoke('games:list')
  },
  /** Відкрити URL у системному браузері. */
  openExternal: (url: string): Promise<void> => ipcRenderer.invoke('shell:open-external', url),
  /** Скопіювати текст у буфер обміну. */
  copyToClipboard: (text: string): Promise<void> => ipcRenderer.invoke('clipboard:write', text)
}

contextBridge.exposeInMainWorld('api', api)

export type CoopSyncApi = typeof api

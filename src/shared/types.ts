// Спільні типи між main, preload і renderer.

/** Дані, які GitHub повертає для device flow — їх показуємо користувачу. */
export interface DeviceCodeInfo {
  /** Код, який користувач вводить на github.com (напр. "ABCD-1234"). */
  userCode: string
  /** Сторінка, куди йти вводити код (https://github.com/login/device). */
  verificationUri: string
  /** Скільки секунд код дійсний. */
  expiresIn: number
  /** Як часто (сек) можна опитувати GitHub про результат. */
  interval: number
}

/** Інформація про залогіненого користувача GitHub. */
export interface AuthUser {
  login: string
}

/** Поточний стан авторизації. */
export type AuthStatus =
  | { state: 'logged-out' }
  | { state: 'logged-in'; user: AuthUser }

/** Спільне сховище сейвів (окремий приватний репозиторій). */
export interface SavesRepo {
  /** owner/назва, напр. "Vitalii-Kravchenko/coopsync-saves". */
  fullName: string
  /** Посилання на репо на github.com. */
  url: string
}

/** Стан спільного сховища. */
export type SavesRepoStatus =
  | { state: 'none' } // ще не створене
  | { state: 'ready'; repo: SavesRepo }

/** Запрошений, але ще не підтверджений співавтор. */
export interface PendingInvite {
  login: string
}

/** Співавтор, який уже прийняв запрошення і має доступ. */
export interface Collaborator {
  login: string
}

/** Виявлена встановлена гра, яку підтримує CoopSync. */
export interface DetectedGame {
  appId: string
  name: string
  /** Абсолютний шлях до папки сейвів. */
  savePath: string
  /** Чи реально існує папка сейвів на диску. */
  saveFound: boolean
}

/** Гра з каталогу підтримуваних (незалежно від того, чи встановлена). */
export interface CatalogGame {
  appId: string
  name: string
}

/** Стан синхронізації сейвів гри (порівняння локального з GitHub). */
export type SyncStatus =
  | 'synced' // локальне = хмара
  | 'local-newer' // локальне новіше → вивантажити
  | 'remote-newer' // у хмарі новіше → завантажити
  | 'not-uploaded' // локальне є, у хмарі ще нема
  | 'cloud-only' // у хмарі є, локально нема
  | 'no-saves' // нема ні там, ні там

export interface GameSyncStatus {
  appId: string
  status: SyncStatus
  /** Версія локальних сейвів (0 = ще не синхронізовано). */
  localVersion: number
  /** Версія сейвів на GitHub (0 = ще не вивантажено). */
  remoteVersion: number
}

/** Подія автосинхронізації (запуск гри → pull, вихід → push). */
export interface AutoSyncEvent {
  appId: string
  name: string
  action: 'pull' | 'push'
  ok: boolean
  message: string
}

/** Налаштування запуску. */
export interface StartupSettings {
  /** Запускати разом із Windows. */
  openAtLogin: boolean
  /** Стартувати згорнутим у трей. */
  startMinimized: boolean
}

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

/** Будь-яка встановлена Steam-гра + чи підтримує її CoopSync. */
export interface InstalledGame {
  appId: string
  name: string
  supported: boolean
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
  /** ISO timestamp останнього push у хмару (спільний для обох гравців), якщо колись синкали. */
  lastSyncAt?: string
  /** Розмір сейвів у байтах — хмарної копії, якщо є, інакше локальної. */
  sizeBytes?: number
}

/** Результат вивантаження/завантаження — версія, а не готовий текст, щоб
 * renderer сам зібрав локалізоване повідомлення (main-процес мови не знає). */
export interface SyncResult {
  version: number
}

/** Код результату автосинку — те саме, що й ручний sync, показуємо тим самим
 * describeSyncResult(). 'push-skipped' — хмара вже випередила нашу відому версію. */
export type SyncResultCode = 'upload-success' | 'download-success' | 'push-skipped'

/** Подія автосинхронізації (запуск гри → pull, вихід → push). */
export interface AutoSyncEvent {
  appId: string
  name: string
  action: 'pull' | 'push' | 'push-skipped'
  ok: boolean
  /** Успіх — SyncResultCode (через describeSyncResult); невдача — ErrorCode
   * з shared/errors.ts, закодований так само, як app-error (через describeError). */
  code: string
  params?: Record<string, string>
}

/** Налаштування запуску. */
export interface StartupSettings {
  /** Запускати разом із Windows. */
  openAtLogin: boolean
  /** Стартувати згорнутим у трей. */
  startMinimized: boolean
}

/** Загальні налаштування (мова, аватар). */
export interface GeneralSettings {
  language: string
  /** Кастомний аватар (data URL) або null, якщо не завантажений. */
  avatarDataUrl: string | null
  /** Показувати попередження про Steam Cloud при кожному запуску. */
  showCloudWarning: boolean
}

/** Один запис в історії синхронізацій — один push (вивантаження) якоїсь гри. */
export interface SyncHistoryEntry {
  appId: string
  gameName: string
  /** Версія, яку саме тоді запушили. */
  version: number
  /** Логін того, хто вивантажив. */
  updatedBy: string
  /** ISO timestamp моменту push. */
  updatedAt: string
}

/** Роль користувача в коопі. */
export type UserRole = 'host' | 'join'

/** Конфіг ролі: хто головний і чиє сховище синхронізуємо. */
export interface RoleConfig {
  role: UserRole
  /** Логін власника сховища (host'а). Для ролі host = я сам. */
  hostOwner: string
}

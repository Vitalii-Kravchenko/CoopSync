// Спільні типи між main, preload і renderer.
import type { ErrorCode } from './errors'

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
  /** Публічне ім'я з GitHub-профілю, якщо користувач його вказав. */
  name?: string
}

/** Поточний стан авторизації. 'error' — тимчасовий збій перевірки (нема
 * інтернету, ліміт GitHub API), НЕ означає, що токен насправді невалідний —
 * на відміну від 'logged-out', цей стан не повинен викидати назад в онбординг. */
export type AuthStatus =
  | { state: 'logged-out' }
  | { state: 'logged-in'; user: AuthUser }
  | { state: 'error'; code: ErrorCode; params?: Record<string, string> }

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
  | 'local-stale' // локальне відрізняється, але не змінювалось після останнього синку (напр. старий бекап) → завантажити
  | 'not-uploaded' // локальне є, у хмарі ще нема
  | 'cloud-only' // у хмарі є, локально нема
  | 'no-saves' // нема ні там, ні там
  | 'no-repo' // сховище видалене/не підключене — версії з хмарою звіряти нема з чим

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
  /** Чи реально пішов push (upload). false — контент і так вже збігався з
   *  хмарою, версію просто підтягнули до вже актуальної, нічого не змінилось. */
  pushed?: boolean
}

/** Код результату автосинку — те саме, що й ручний sync, показуємо тим самим
 * describeSyncResult(). 'push-skipped' — хмара вже випередила нашу відому версію.
 * 'push-skipped-stale' — локальний вміст застарілий (не змінювався після
 * останнього синку), автопуш пропущено, щоб не затерти хмару.
 * 'push-skipped-nochange' — грали, але вміст сейву не змінився (хеш співпав
 * з хмарою) — push і не мав сенсу, не показуємо це як "вивантажено".
 * 'restore-success' — довантажено файли, яких бракувало локально (без повного pull). */
export type SyncResultCode =
  | 'upload-success'
  | 'download-success'
  | 'push-skipped'
  | 'push-skipped-stale'
  | 'push-skipped-nochange'
  | 'restore-success'

/** Подія автосинхронізації (запуск гри → pull, вихід → push).
 * 'watcher-error' — не пов'язана з конкретною грою (напр. не вдалось
 * перевірити список запущених процесів) — appId/name порожні. */
export interface AutoSyncEvent {
  appId: string
  name: string
  action: 'pull' | 'push' | 'push-skipped' | 'watcher-error'
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

/** Тип звернення в кнопці "Підтримка". */
export type SupportCategory = 'bug' | 'game-request' | 'idea' | 'other'

/** Гра, знайдена через пошук по Steam-магазину (не по встановлених — по всьому Steam). */
export interface SteamSearchResult {
  appId: string
  name: string
  /** Готове посилання на картинку від самого Steam (search API) — новіші ігри
   *  роздають картинки з хеш-шляхів, які не зібрати самому з appId. */
  imageUrl?: string
}

/** Максимум ігор в одному зверненні "Хочу гру" — щоб пул кандидатів на
 *  голосування не засипали за раз (обмеження і в UI, і на боці Worker'а). */
export const MAX_GAME_REQUESTS = 3

/** Звернення користувача, яке йде на пошту Віталія через Worker-проксі. */
export interface SupportRequest {
  category: SupportCategory
  /** Для 'bug'/'other' — сам текст звернення. Для 'game-request' — необов'язковий коментар. */
  message: string
  /** Обрані ігри зі Steam-пошуку — тільки для категорії 'game-request', до MAX_GAME_REQUESTS штук. */
  games?: SteamSearchResult[]
}

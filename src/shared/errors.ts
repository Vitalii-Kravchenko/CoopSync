// Локалізовані помилки з main-процесу. Electron IPC серіалізує кинуту помилку
// лише як рядок (message) — усі кастомні поля/класи губляться. Тому код+параметри
// кодуємо прямо в message з маркером, а renderer (де є Translation) розкодовує їх
// і показує локалізований текст через t.errors[code]. Нерозпізнані помилки (напр.
// ще не класифікований git-виняток) renderer показує як очищений сирий текст —
// див. describeError у renderer/src/errors.ts.

export type ErrorCode =
  | 'NOT_LOGGED_IN'
  | 'HOST_LOGIN_REQUIRED'
  | 'NO_ACCESS_TO_HOST_REPO'
  | 'IMAGE_FORMAT_UNSUPPORTED'
  | 'IMAGE_TOO_LARGE'
  | 'DEVICE_CODE_FAILED'
  | 'LOGIN_FAILED'
  | 'USER_FETCH_FAILED'
  | 'REPO_CHECK_FAILED'
  | 'REPO_CREATE_FAILED'
  | 'GITHUB_USER_NOT_FOUND'
  | 'REPO_NOT_FOUND'
  | 'INVITE_FAILED'
  | 'REPO_DELETE_NO_PERMISSION'
  | 'REPO_DELETE_FAILED'
  | 'ENCRYPTION_UNAVAILABLE'
  | 'GAME_NOT_SUPPORTED'
  | 'SAVE_FOLDER_NOT_FOUND'
  | 'NO_CLOUD_SAVES'
  | 'NO_INTERNET'
  | 'GIT_AUTH_FAILED'
  | 'GIT_GENERIC'
  | 'SUPPORT_SEND_FAILED'
  | 'SUPPORT_RATE_LIMITED'

const MARKER = 'app-error:'

/** Створити Error, з якого renderer зможе розкодувати код + параметри. */
export function makeAppError(code: ErrorCode, params?: Record<string, string>): Error {
  return new Error(MARKER + JSON.stringify({ code, params }))
}

/**
 * Розкодувати помилку. Приймає як сирий Error.message з main (без обгортки),
 * так і те, що прилетіло через ipcRenderer.invoke — Electron додає префікс
 * "Error invoking remote method 'x': Error: " перед нашим маркером, тому шукаємо
 * маркер через indexOf, а не якорим на початок рядка.
 */
export function parseAppError(message: string): { code: ErrorCode; params?: Record<string, string> } | null {
  const idx = message.indexOf(MARKER)
  if (idx === -1) return null
  try {
    const parsed = JSON.parse(message.slice(idx + MARKER.length)) as { code: ErrorCode; params?: Record<string, string> }
    return parsed
  } catch {
    return null
  }
}

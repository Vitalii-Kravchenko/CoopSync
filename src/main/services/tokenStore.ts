import { app, safeStorage } from 'electron'
import { join } from 'path'
import { writeFileSync, readFileSync, existsSync, rmSync } from 'fs'
import { makeAppError } from '../../shared/errors'

// Файл, де лежить зашифрований токен (у системній папці даних застосунку).
function tokenPath(): string {
  return join(app.getPath('userData'), 'auth.bin')
}

/** Зберегти токен у зашифрованому вигляді. */
export function saveToken(token: string): void {
  if (!safeStorage.isEncryptionAvailable()) {
    throw makeAppError('ENCRYPTION_UNAVAILABLE')
  }
  const encrypted = safeStorage.encryptString(token)
  writeFileSync(tokenPath(), encrypted)
}

/** Прочитати збережений токен, або null якщо його нема / не вдалось розшифрувати. */
export function loadToken(): string | null {
  const path = tokenPath()
  if (!existsSync(path)) return null
  try {
    const encrypted = readFileSync(path)
    return safeStorage.decryptString(encrypted)
  } catch {
    return null
  }
}

/** Видалити збережений токен (logout). */
export function clearToken(): void {
  const path = tokenPath()
  if (existsSync(path)) rmSync(path)
}

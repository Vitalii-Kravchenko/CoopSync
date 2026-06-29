import { app, safeStorage } from 'electron'
import { join } from 'path'
import { writeFileSync, readFileSync, existsSync, rmSync } from 'fs'

// Файл, де лежить зашифрований токен (у системній папці даних застосунку).
function tokenPath(): string {
  return join(app.getPath('userData'), 'auth.bin')
}

/** Зберегти токен у зашифрованому вигляді. */
export function saveToken(token: string): void {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('Шифрування недоступне в системі — не можу безпечно зберегти токен')
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

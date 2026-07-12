import { app, safeStorage } from 'electron'
import { join } from 'path'
import { writeFileSync, readFileSync, existsSync, rmSync } from 'fs'
import { makeAppError } from '../../shared/errors'

// File holding the encrypted token (in the app's system data folder).
function tokenPath(): string {
  return join(app.getPath('userData'), 'auth.bin')
}

/** Save the token in encrypted form. */
export function saveToken(token: string): void {
  if (!safeStorage.isEncryptionAvailable()) {
    throw makeAppError('ENCRYPTION_UNAVAILABLE')
  }
  const encrypted = safeStorage.encryptString(token)
  writeFileSync(tokenPath(), encrypted)
}

/** Read the saved token, or null if there isn't one / it couldn't be decrypted. */
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

/** Delete the saved token (logout). */
export function clearToken(): void {
  const path = tokenPath()
  if (existsSync(path)) rmSync(path)
}

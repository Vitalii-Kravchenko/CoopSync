import { app, safeStorage } from 'electron'
import { join } from 'path'
import { writeFileSync, readFileSync, existsSync, rmSync } from 'fs'
import { makeAppError } from '../../shared/errors'

// Separate from tokenStore.ts's main sync token ON PURPOSE — this one is a
// zero-scope token (see config.ts's PRESENCE_GITHUB_SCOPE) used only to
// authenticate with the presence/signaling server. Keeping it in its own
// file makes it structurally impossible to accidentally send the
// repo-scoped sync token there instead (see ROADMAP.md §1.3).
function presenceTokenPath(): string {
  return join(app.getPath('userData'), 'presence-auth.bin')
}

/** Save the presence token in encrypted form. */
export function savePresenceToken(token: string): void {
  if (!safeStorage.isEncryptionAvailable()) {
    throw makeAppError('ENCRYPTION_UNAVAILABLE')
  }
  const encrypted = safeStorage.encryptString(token)
  writeFileSync(presenceTokenPath(), encrypted)
}

/** Read the saved presence token, or null if there isn't one / it couldn't be decrypted. */
export function loadPresenceToken(): string | null {
  const path = presenceTokenPath()
  if (!existsSync(path)) return null
  try {
    const encrypted = readFileSync(path)
    return safeStorage.decryptString(encrypted)
  } catch {
    return null
  }
}

/** Delete the saved presence token (disable presence). */
export function clearPresenceToken(): void {
  const path = presenceTokenPath()
  if (existsSync(path)) rmSync(path)
}

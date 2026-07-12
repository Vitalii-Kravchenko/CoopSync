import { app } from 'electron'
import { dirname, join } from 'path'
import { readFileSync, unlinkSync, writeFileSync } from 'fs'

import type { UserRole } from '../../shared/types'

// Simple app settings (except autostart, which the OS stores).
interface AppSettings {
  startMinimized: boolean
  /** User role (host/join). undefined = not chosen yet (onboarding needed). */
  role?: UserRole
  /** Whose repo we're syncing (host's login). */
  hostOwner?: string
  /** UI language. */
  language: string
  /** Custom user avatar (data URL), if they uploaded one. */
  avatarDataUrl?: string
  /** Whether to show the Steam Cloud warning on every launch. */
  showCloudWarning: boolean
}

// English — universal fallback if the installer's language couldn't be determined.
const DEFAULTS: AppSettings = { startMinimized: false, language: 'en', showCloudWarning: true }

function settingsPath(): string {
  return join(app.getPath('userData'), 'app-settings.json')
}

export function readSettings(): AppSettings {
  try {
    const raw = readFileSync(settingsPath(), 'utf8').replace(/^﻿/, '')
    return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<AppSettings>) }
  } catch {
    return { ...DEFAULTS }
  }
}

export function writeSettings(patch: Partial<AppSettings>): void {
  const next = { ...readSettings(), ...patch }
  writeFileSync(settingsPath(), JSON.stringify(next, null, 2))
}

/**
 * Language the user picked in the NSIS installer's language selection dialog
 * (written to build/installer.nsh) into the install folder — NOT userData,
 * because with "install for all users" the installer's admin session and the
 * later app launch by a regular user can have different %APPDATA%, while
 * $INSTDIR (the folder next to the .exe) is always the same.
 * The file is one-time use — we read it and try to delete it (this can fail
 * if the app is installed in Program Files and launched without admin
 * rights — harmless, it just leaves an empty file behind).
 */
export function consumeInstallerLanguage(): string | null {
  const markerPath = join(dirname(app.getPath('exe')), 'installer-language.txt')
  try {
    const lang = readFileSync(markerPath, 'utf8').trim()
    try {
      unlinkSync(markerPath)
    } catch {
      // No permission to delete (Program Files, non-admin) — not critical.
    }
    return lang || null
  } catch {
    return null
  }
}

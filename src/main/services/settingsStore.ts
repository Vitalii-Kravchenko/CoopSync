import { app } from 'electron'
import { dirname, join } from 'path'
import { readFileSync, unlinkSync, writeFileSync } from 'fs'

import type { UserRole, CustomGame } from '../../shared/types'

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
  /** Whether to silently check GitHub for a new release shortly after launch. */
  autoCheckUpdates: boolean
  /** Manual save-folder overrides, keyed by appId — set via a game's detail
   *  screen when the catalog default path is wrong for this PC/install. */
  savePathOverrides?: Record<string, string>
  /** Games the user added manually (not in the built-in catalog). */
  customGames?: CustomGame[]
  /** appIds of a custom game removed locally (games:remove-custom) whose
   *  matching push to drop it from the shared registry failed — otherwise a
   *  partner who already knows about the game never finds out it was
   *  removed. Retried on every getSyncStatuses check until it succeeds. */
  pendingCustomGameRemovals?: string[]
}

// English — universal fallback if the installer's language couldn't be determined.
const DEFAULTS: AppSettings = {
  startMinimized: false,
  language: 'en',
  showCloudWarning: true,
  autoCheckUpdates: true
}

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
 * Whether the NSIS installer (build/installer.nsh) just ran — written to the
 * install folder, NOT userData, because with "install for all users" the
 * installer's admin session and the later app launch by a regular user can
 * have different %APPDATA%, while $INSTDIR (the folder next to the .exe) is
 * always the same.
 * The marker is one-time use — we read it and try to delete it (this can
 * fail if the app is installed in Program Files and launched without admin
 * rights — harmless, it just leaves an empty file behind).
 */
export function consumeJustInstalledMarker(): boolean {
  const markerPath = join(dirname(app.getPath('exe')), 'just-installed.txt')
  try {
    readFileSync(markerPath, 'utf8')
    try {
      unlinkSync(markerPath)
    } catch {
      // No permission to delete (Program Files, non-admin) — not critical.
    }
    return true
  } catch {
    return false
  }
}

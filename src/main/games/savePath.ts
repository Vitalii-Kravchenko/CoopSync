import { readSettings, writeSettings } from '../services/settingsStore'
import type { SupportedGame } from './catalog'

// Resolves the save-folder path CoopSync should actually use for a game —
// a user override (set from the game's detail screen) takes priority over
// the catalog default (SupportedGame.getSavePath). Every sync codepath must
// go through this instead of calling game.getSavePath() directly, so a
// manually-corrected path is actually respected.

export function resolveSavePath(game: SupportedGame): string {
  const override = readSettings().savePathOverrides?.[game.appId]
  return override || game.getSavePath()
}

export function isCustomSavePath(appId: string): boolean {
  return Boolean(readSettings().savePathOverrides?.[appId])
}

/** path === null resets to the catalog default. */
export function setSavePathOverride(appId: string, path: string | null): void {
  const overrides = { ...readSettings().savePathOverrides }
  if (path) overrides[appId] = path
  else delete overrides[appId]
  writeSettings({ savePathOverrides: overrides })
}

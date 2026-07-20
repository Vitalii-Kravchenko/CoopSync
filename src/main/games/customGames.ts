import { randomUUID } from 'crypto'
import { readSettings, writeSettings } from '../services/settingsStore'
import { setSavePathOverride } from './savePath'
import { READY_GAMES } from './catalog'
import type { SupportedGame } from './catalog'
import type { CustomGame } from '../../shared/types'

// User-added games (not in the built-in catalog). processNames comes from
// scanning an install folder the user points at (see exeScan.ts) — if empty,
// the watcher's isGameRunning() never matches, so that game just gets no
// launch/exit auto-sync, only manual upload/download. There's still no
// saveFilePattern (the whole folder is copied as-is, see AddGame's
// disclaimer in the renderer) — upload/download/status/the save-path editor
// reuse the exact same code as catalog games via asSupportedGame()/
// getSyncableGames() below, instead of a parallel codepath.

const CUSTOM_ID_PREFIX = 'custom:'

export function listCustomGames(): CustomGame[] {
  return readSettings().customGames ?? []
}

export function isCustomGameId(appId: string): boolean {
  return appId.startsWith(CUSTOM_ID_PREFIX)
}

export function addCustomGame(name: string, savePath: string, processNames: string[]): CustomGame {
  const game: CustomGame = {
    appId: `${CUSTOM_ID_PREFIX}${randomUUID()}`,
    name,
    savePath,
    processNames
  }
  writeSettings({ customGames: [...listCustomGames(), game] })
  return game
}

// A co-op partner added this game and pushed it to the shared repo's
// registry (see sync.ts's pushCustomGameToRegistry/readCustomGamesRegistry)
// — materialize it locally with an empty savePath so it shows up on the
// Games screen (as 'needs-setup') and can be configured through the exact
// same save-path editor a catalog game uses (GameDetailScreen), instead of
// a separate "accept this game" flow. Idempotent — a no-op once the appId
// is already known locally, whether still unconfigured or already set up.
export function materializeRemoteCustomGame(appId: string, name: string): void {
  if (listCustomGames().some((g) => g.appId === appId)) return
  const game: CustomGame = { appId, name, savePath: '', processNames: [] }
  writeSettings({ customGames: [...listCustomGames(), game] })
}

export function removeCustomGame(appId: string): void {
  writeSettings({ customGames: listCustomGames().filter((g) => g.appId !== appId) })
  // Drop any save-path override tied to this id too — otherwise it just sits
  // there orphaned in settings forever.
  setSavePathOverride(appId, null)
}

function asSupportedGame(g: CustomGame): SupportedGame {
  return {
    appId: g.appId,
    name: g.name,
    getSavePath: () => g.savePath,
    processNames: g.processNames,
    ready: true
  }
}

// Every game CoopSync can actually sync — the ready catalog entries plus
// whatever the user added manually. Every sync codepath (upload/download/
// status/save-path editing) should read from this instead of READY_GAMES
// directly, so a custom game gets the exact same treatment.
export function getSyncableGames(): SupportedGame[] {
  return [...READY_GAMES, ...listCustomGames().map(asSupportedGame)]
}

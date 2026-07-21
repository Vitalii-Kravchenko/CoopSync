import { randomUUID } from 'crypto'
import { readSettings, writeSettings } from '../services/settingsStore'
import { setSavePathOverride } from './savePath'
import { READY_GAMES } from './catalog'
import type { SupportedGame } from './catalog'
import type { CustomGame } from '../../shared/types'

// User-added games (not in the built-in catalog). processNames comes from
// scanning an install folder the user points at (see exeScan.ts) — if empty,
// the watcher's isGameRunning() never matches, so that game just gets no
// launch/exit auto-sync, only manual upload/download. Unlike a catalog game,
// there's no saveFilePattern known up front (see AddGame's disclaimer in the
// renderer) — excludedFiles (set later, from the game's detail screen) lets
// the user carve one out by hand once they notice unwanted files synced.
// Upload/download/status/the save-path editor all reuse the exact same code
// as catalog games via asSupportedGame()/getSyncableGames() below, instead
// of a parallel codepath.

const CUSTOM_ID_PREFIX = 'custom:'

// A custom game's NAME (not its appId) is used as a literal path segment
// throughout sync.ts — the repo's save folder, .meta/<name>.json — with no
// sanitization anywhere downstream. A colon is the dangerous one: NTFS
// silently treats "name:rest" as an Alternate Data Stream, so every fs call
// (existsSync/writeFile/readFile) reports success while git never sees the
// real content — this is the exact bug that made custom-game covers never
// reach a partner (see coverPath()'s appId.replace(/:/g, '_') in sync.ts;
// that appId always contains "custom:" so it hit this on every single custom
// game until fixed). Game names are free-text and easily collide with it too
// ("Mass Effect: Andromeda"). Rejecting up front beats silently sanitizing —
// with this class of bug, "no error anywhere" is exactly what made it invisible
// for so long, so the user should see immediately if a name can't be used.
const INVALID_GAME_NAME_CHARS = /[\\/:*?"<>|]/

export function hasInvalidGameNameChars(name: string): boolean {
  return INVALID_GAME_NAME_CHARS.test(name)
}

export function listCustomGames(): CustomGame[] {
  return readSettings().customGames ?? []
}

export function isCustomGameId(appId: string): boolean {
  return appId.startsWith(CUSTOM_ID_PREFIX)
}

export function addCustomGame(
  name: string,
  savePath: string,
  processNames: string[],
  coverDataUrl?: string
): CustomGame {
  const game: CustomGame = {
    appId: `${CUSTOM_ID_PREFIX}${randomUUID()}`,
    name,
    savePath,
    processNames,
    ...(coverDataUrl ? { coverDataUrl } : {})
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
  // Materializing it FROM the registry means it's registered by definition —
  // see registryConfirmed's own doc comment for why this matters once it's
  // later removed by whoever actually owns it.
  const game: CustomGame = { appId, name, savePath: '', processNames: [], registryConfirmed: true }
  writeSettings({ customGames: [...listCustomGames(), game] })
}

/** Marks that this appId has now actually been observed in the shared
 *  registry (see registryConfirmed's doc comment on CustomGame / sync.ts's
 *  getSyncStatuses). No-op if appId isn't a locally-known custom game, or
 *  already marked. */
export function markCustomGameRegistryConfirmed(appId: string): void {
  writeSettings({
    customGames: listCustomGames().map((g) =>
      g.appId === appId && !g.registryConfirmed ? { ...g, registryConfirmed: true } : g
    )
  })
}

/** Rename a locally-known custom game. No-op if appId isn't one, or the name
 *  is unchanged. The repo-side rename (folder + version meta + registry) is
 *  handled separately by sync.ts's renameCustomGameInRegistry — this only
 *  updates the local record. */
export function setCustomGameName(appId: string, name: string): void {
  writeSettings({
    customGames: listCustomGames().map((g) => (g.appId === appId && g.name !== name ? { ...g, name } : g))
  })
}

export function getCustomGameProcessNames(appId: string): string[] {
  return listCustomGames().find((g) => g.appId === appId)?.processNames ?? []
}

/** Set the .exe name(s) that drive launch/exit auto-sync for a custom game —
 *  the setup step a co-op partner does on their own machine for a game
 *  materialized from the shared registry (see materializeRemoteCustomGame),
 *  or a later correction for a game added on this PC. No-op if appId isn't
 *  a locally-known custom game. */
export function setCustomGameProcessNames(appId: string, processNames: string[]): void {
  writeSettings({
    customGames: listCustomGames().map((g) => (g.appId === appId ? { ...g, processNames } : g))
  })
}

/** Set (dataUrl) or clear (null) a custom game's cover art. No-op if appId
 *  isn't a locally-known custom game (the UI only offers this once it is). */
export function setCustomGameCover(appId: string, dataUrl: string | null): void {
  const list = listCustomGames()
  const next = list.map((g) => {
    if (g.appId !== appId) return g
    const { coverDataUrl: _drop, ...rest } = g
    return dataUrl ? { ...rest, coverDataUrl: dataUrl } : rest
  })
  writeSettings({ customGames: next })
}

/** Tracks whether the last attempt to push a custom game's cover to the
 *  shared repo failed — lets the renderer show a persistent retry affordance
 *  instead of the failure just vanishing (see ipc.ts's games:add-custom /
 *  games:save-cover / games:retry-cover-push). No-op if appId isn't a
 *  locally-known custom game. */
export function setCustomGameCoverSyncFailed(appId: string, failed: boolean): void {
  writeSettings({
    customGames: listCustomGames().map((g) => {
      if (g.appId !== appId) return g
      if (!failed) {
        const { coverSyncFailed: _drop, ...rest } = g
        return rest
      }
      return { ...g, coverSyncFailed: true }
    })
  })
}

export function getCustomGameExcludedFiles(appId: string): string[] {
  return listCustomGames().find((g) => g.appId === appId)?.excludedFiles ?? []
}

/** Set which file names (in the save folder's top level) to leave out of
 *  sync — e.g. local settings sitting next to actual save data, the same
 *  problem SupportedGame.saveFilePattern solves for a catalog game, just
 *  configured by hand here since we don't know a custom game's structure
 *  up front. No-op if appId isn't a locally-known custom game. */
export function setCustomGameExcludedFiles(appId: string, excludedFiles: string[]): void {
  writeSettings({
    customGames: listCustomGames().map((g) => (g.appId === appId ? { ...g, excludedFiles } : g))
  })
}

export function removeCustomGame(appId: string): void {
  writeSettings({ customGames: listCustomGames().filter((g) => g.appId !== appId) })
  // Drop any save-path override tied to this id too — otherwise it just sits
  // there orphaned in settings forever.
  setSavePathOverride(appId, null)
}

export function getPendingCustomGameRemovals(): string[] {
  return readSettings().pendingCustomGameRemovals ?? []
}

/** Remembers that this custom game's registry-removal push still needs to
 *  happen (see ipc.ts's games:remove-custom / sync.ts's getSyncStatuses
 *  retry). No-op if already pending. */
export function addPendingCustomGameRemoval(appId: string): void {
  const pending = getPendingCustomGameRemovals()
  if (pending.includes(appId)) return
  writeSettings({ pendingCustomGameRemovals: [...pending, appId] })
}

export function clearPendingCustomGameRemoval(appId: string): void {
  writeSettings({ pendingCustomGameRemovals: getPendingCustomGameRemovals().filter((id) => id !== appId) })
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// SupportedGame.saveFilePattern is an INCLUDE pattern (only a matching file
// name syncs) — excludedFiles is the opposite (everything syncs EXCEPT a
// listed name). A negative lookahead flips one into the other: matches any
// name that ISN'T exactly one of the excluded ones, so copyFiltered/
// clearFiltered (which already apply this exact field for catalog games)
// need no changes at all to also support exclusion for a custom game.
function buildExcludePattern(excludedFiles?: string[]): RegExp | undefined {
  if (!excludedFiles || excludedFiles.length === 0) return undefined
  const alternation = excludedFiles.map(escapeRegExp).join('|')
  return new RegExp(`^(?!(?:${alternation})$).*$`)
}

function asSupportedGame(g: CustomGame): SupportedGame {
  return {
    appId: g.appId,
    name: g.name,
    getSavePath: () => g.savePath,
    processNames: g.processNames,
    ready: true,
    saveFilePattern: buildExcludePattern(g.excludedFiles)
  }
}

// Every game CoopSync can actually sync — the ready catalog entries plus
// whatever the user added manually. Every sync codepath (upload/download/
// status/save-path editing) should read from this instead of READY_GAMES
// directly, so a custom game gets the exact same treatment.
export function getSyncableGames(): SupportedGame[] {
  return [...READY_GAMES, ...listCustomGames().map(asSupportedGame)]
}

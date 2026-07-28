import { randomUUID } from 'crypto'
import { resolve, sep } from 'path'
import { readSettings, writeSettings } from '../services/settingsStore'
import { setSavePathOverride } from './savePath'
import { READY_GAMES } from './catalog'
import type { SupportedGame } from './catalog'
import type { CustomGame, CustomExtraFolder } from '../../shared/types'

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

// A game's name is a literal repo path segment (see the comment above) —
// two DIFFERENT games (different appIds) sharing one name would collide in
// the shared repo, each one's push overwriting what the other just pushed.
// Checked against BOTH other custom games and the built-in catalog (a custom
// game named e.g. "Subnautica 2" would collide with that catalog entry's own
// folder). Case-insensitive, trimmed. `excludeAppId` — the game being
// renamed, so renaming it back to its own current name isn't a false conflict.
export function isGameNameTaken(name: string, excludeAppId?: string): boolean {
  const norm = name.trim().toLowerCase()
  const customTaken = listCustomGames().some(
    (g) => g.appId !== excludeAppId && g.name.trim().toLowerCase() === norm
  )
  if (customTaken) return true
  return READY_GAMES.some((g) => g.name.trim().toLowerCase() === norm)
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

/** Someone else removed this game from the shared registry — see
 *  CustomGame.orphaned's doc comment. No-op if appId isn't a locally-known
 *  custom game, or already orphaned. */
export function markCustomGameOrphaned(appId: string): void {
  writeSettings({
    customGames: listCustomGames().map((g) => (g.appId === appId && !g.orphaned ? { ...g, orphaned: true } : g))
  })
}

/** "Restore just for myself" (ipc.ts's games:restore-orphaned-game) — keeps
 *  the local game exactly as it was, clears the orphaned flag, and marks it
 *  personal via the generic per-game toggle (see settingsStore.ts's
 *  personalGameIds / syncScope.ts's setGamePersonal) — the caller is
 *  responsible for that call, this only clears the custom-game-specific
 *  flags. registryConfirmed is reset too — code that branches on it (e.g.
 *  ipc.ts's games:rename-custom) must treat a personal game as
 *  never-registered, not as "registered, needs a registry push" (it must
 *  never touch the shared registry again). No-op if appId isn't a
 *  locally-known custom game. */
export function restoreOrphanedCustomGame(appId: string): void {
  writeSettings({
    customGames: listCustomGames().map((g) =>
      g.appId === appId ? { ...g, orphaned: undefined, registryConfirmed: undefined } : g
    )
  })
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
export function buildExcludePattern(excludedFiles?: string[]): RegExp | undefined {
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

// --- Extra save folders (CustomGame.extraFolders) ---
// A second (or third...) independently-synced folder on top of a custom
// game's main one — e.g. character saves kept apart from world saves. See
// CustomExtraFolder's doc comment (shared/types.ts) for the shared/personal
// split; sync.ts is what actually acts on the `shared` flag when pushing/
// pulling (repo layout, registry) — everything here is just local bookkeeping.

function updateGame(appId: string, fn: (g: CustomGame) => CustomGame): void {
  writeSettings({ customGames: listCustomGames().map((g) => (g.appId === appId ? fn(g) : g)) })
}

function updateFolder(
  appId: string,
  folderId: string,
  fn: (f: CustomExtraFolder) => CustomExtraFolder
): void {
  updateGame(appId, (g) => ({
    ...g,
    extraFolders: (g.extraFolders ?? []).map((f) => (f.id === folderId ? fn(f) : f))
  }))
}

export function getExtraFolders(appId: string): CustomExtraFolder[] {
  return listCustomGames().find((g) => g.appId === appId)?.extraFolders ?? []
}

export function addExtraFolder(
  appId: string,
  label: string,
  savePath: string,
  shared: boolean,
  addedBy: string
): CustomExtraFolder {
  const folder: CustomExtraFolder = { id: randomUUID(), label, savePath, shared, addedBy }
  updateGame(appId, (g) => ({ ...g, extraFolders: [...(g.extraFolders ?? []), folder] }))
  return folder
}

// Case-insensitive, trimmed — matches how the UI shows labels, so "Персонажі"
// and "персонажі " are treated as the same name for collision purposes.
export function hasExtraFolderLabel(appId: string, label: string): boolean {
  const norm = label.trim().toLowerCase()
  return getExtraFolders(appId).some((f) => f.label.trim().toLowerCase() === norm)
}

// A real bug found 2026-07-26: an extra folder's save path was accidentally
// set to the SAME folder (or a subfolder) already used by the game's main
// save path or another extra folder. Since every folder is synced as a
// whole-folder copy, this creates a feedback loop — folder A's synced
// content physically sits inside folder B's own save path, so every push of
// A looks like new content to B and vice versa, forever. Reject this up
// front instead of letting it happen silently again.
function normalizePath(p: string): string {
  return resolve(p).toLowerCase().replace(/[\\/]+$/, '')
}

function pathsOverlap(a: string, b: string): boolean {
  if (!a || !b) return false
  const na = normalizePath(a)
  const nb = normalizePath(b)
  if (na === nb) return true
  return na.startsWith(nb + sep) || nb.startsWith(na + sep)
}

/** Checks `candidatePath` against the game's main save path and its other
 *  extra folders (skipping `excludeFolderId` — the folder being edited, if
 *  any). Returns a human-readable label for whatever it conflicts with, or
 *  null if there's no overlap. */
export function extraFolderPathConflict(
  appId: string,
  candidatePath: string,
  excludeFolderId?: string
): string | null {
  const game = listCustomGames().find((g) => g.appId === appId)
  if (!game) return null
  const mainPath = readSettings().savePathOverrides?.[appId] || game.savePath
  if (mainPath && pathsOverlap(candidatePath, mainPath)) return game.name
  for (const f of game.extraFolders ?? []) {
    if (f.id === excludeFolderId || !f.savePath) continue
    if (pathsOverlap(candidatePath, f.savePath)) return f.label
  }
  return null
}

export function removeExtraFolder(appId: string, folderId: string): void {
  updateGame(appId, (g) => ({
    ...g,
    extraFolders: (g.extraFolders ?? []).filter((f) => f.id !== folderId)
  }))
}

export function setExtraFolderLabel(appId: string, folderId: string, label: string): void {
  updateFolder(appId, folderId, (f) => ({ ...f, label }))
}

export function setExtraFolderSavePath(appId: string, folderId: string, savePath: string): void {
  updateFolder(appId, folderId, (f) => ({ ...f, savePath }))
}

export function setExtraFolderExcludedFiles(appId: string, folderId: string, excludedFiles: string[]): void {
  updateFolder(appId, folderId, (f) => ({ ...f, excludedFiles }))
}

// Switching shared<->personal doesn't move any already-pushed data (see
// sync.ts's folder path helpers — each state has its own repo location) —
// it only changes where FUTURE pushes/pulls for this folder go. The caller
// (ipc.ts) is responsible for registering/unregistering the folder in the
// shared repo to match.
export function setExtraFolderShared(appId: string, folderId: string, shared: boolean): void {
  updateFolder(appId, folderId, (f) => ({ ...f, shared, ...(shared ? {} : { registryConfirmed: undefined }) }))
}

export function markExtraFolderRegistryConfirmed(appId: string, folderId: string): void {
  updateFolder(appId, folderId, (f) => (f.registryConfirmed ? f : { ...f, registryConfirmed: true }))
}

/** Someone else removed this SHARED folder from the registry — see
 *  CustomExtraFolder.orphaned's doc comment. No-op if already orphaned. */
export function markExtraFolderOrphaned(appId: string, folderId: string): void {
  updateFolder(appId, folderId, (f) => (f.orphaned ? f : { ...f, orphaned: true }))
}

/** "Restore just for myself" (ipc.ts's games:restore-orphaned-folder) —
 *  flips the folder to personal (shared: false, same setting
 *  setExtraFolderShared's own toggle uses) and clears orphaned +
 *  registryConfirmed, so it's treated as never-registered everywhere else
 *  that checks those flags. From the next sync (auto or manual) its content
 *  lands under the personal path (extraFolderContentDir), invisible to
 *  anyone else. */
export function restoreOrphanedFolder(appId: string, folderId: string): void {
  updateFolder(appId, folderId, (f) => ({
    ...f,
    shared: false,
    orphaned: undefined,
    registryConfirmed: undefined
  }))
}

// A co-op partner added a SHARED extra folder and pushed it to the registry
// (sync.ts) — materialize it locally with an empty savePath (shows as
// 'needs-setup' until they point it at their own local folder), the same
// pattern materializeRemoteCustomGame uses for a whole game.
export function materializeRemoteExtraFolder(
  appId: string,
  folderId: string,
  label: string,
  addedBy?: string
): void {
  const existing = getExtraFolders(appId)
  if (existing.some((f) => f.id === folderId)) return
  const folder: CustomExtraFolder = {
    id: folderId,
    label,
    savePath: '',
    shared: true,
    registryConfirmed: true,
    ...(addedBy ? { addedBy } : {})
  }
  updateGame(appId, (g) => ({ ...g, extraFolders: [...(g.extraFolders ?? []), folder] }))
}

function folderKey(appId: string, folderId: string): string {
  return `${appId}:${folderId}`
}

export function getPendingFolderRemovals(): string[] {
  return readSettings().pendingFolderRemovals ?? []
}

export function addPendingFolderRemoval(appId: string, folderId: string): void {
  const key = folderKey(appId, folderId)
  const pending = getPendingFolderRemovals()
  if (pending.includes(key)) return
  writeSettings({ pendingFolderRemovals: [...pending, key] })
}

export function clearPendingFolderRemoval(appId: string, folderId: string): void {
  const key = folderKey(appId, folderId)
  writeSettings({ pendingFolderRemovals: getPendingFolderRemovals().filter((k) => k !== key) })
}

import { app } from 'electron'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { createHash } from 'crypto'
import { basename, join } from 'path'
import { existsSync, statSync } from 'fs'
import { cp, rm, mkdir, readdir, readFile, writeFile } from 'fs/promises'
import { resolveSavePath } from '../games/savePath'
import {
  getSyncableGames,
  isCustomGameId,
  materializeRemoteCustomGame,
  listCustomGames,
  setCustomGameCover,
  removeCustomGame,
  getPendingCustomGameRemovals,
  clearPendingCustomGameRemoval
} from '../games/customGames'
import { SAVES_REPO_NAME } from '../config'
import { isGameCurrentlyRunning } from './processCheck'
import { createSavesRepo, leaveSharedRepo } from './github'
import { makeAppError, parseAppError } from '../../shared/errors'
import { formatVersion } from '../../shared/format'
import type { SyncStatus, GameSyncStatus, SyncHistoryEntry, SyncResult } from '../../shared/types'

const exec = promisify(execFile)
const BIG_BUFFER = 64 * 1024 * 1024 // headroom for large saves

// Local folder we clone the shared repo into.
function repoDir(): string {
  return join(app.getPath('userData'), 'saves-repo')
}

// Repo URL with the token for private access (push/pull without a separate git login).
function remoteUrl(token: string, owner: string): string {
  return `https://x-access-token:${token}@github.com/${owner}/${SAVES_REPO_NAME}.git`
}

// Flags that disable the credential helper (gh/GCM) — otherwise a "choose
// GitHub account" window pops up during push/pull. We clear both the
// general and the github.com-specific helper (set by gh). This way git
// takes the token from the URL.
const NO_HELPER = [
  '-c',
  'credential.helper=',
  '-c',
  'credential.https://github.com.helper='
]

// Environment: disallow any interactive prompts (windows/prompts).
const GIT_ENV = {
  ...process.env,
  GIT_TERMINAL_PROMPT: '0',
  GCM_INTERACTIVE: 'never'
}

// Recognize a raw git exec() exception (technical stderr, "Command failed:
// git...") and turn it into a user-friendly error code. Unrecognized cases
// aren't fully swallowed — we keep the most meaningful stderr line
// (fatal:/error:) as a detail.
function wrapGitError(e: unknown): Error {
  const raw = e instanceof Error ? e.message : String(e)
  if (/could not resolve host|network is unreachable|connection timed out|failed to connect|recv failure|could not connect/i.test(raw)) {
    return makeAppError('NO_INTERNET')
  }
  // Separate from other auth errors: "repository not found" at the git level
  // means specifically "this repo doesn't exist anymore" (deleted on
  // GitHub) — the token has nothing to do with it, so we don't suggest
  // re-logging in, instead giving a code that we turn upstream into a clear
  // "repo not connected" instead of a bare git error.
  if (/repository not found/i.test(raw)) {
    return makeAppError('REPO_NOT_FOUND')
  }
  if (/authentication failed|could not read username|401 unauthorized|403 forbidden/i.test(raw)) {
    return makeAppError('GIT_AUTH_FAILED')
  }
  const lines = raw
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
  const detail = [...lines].reverse().find((l) => /^(fatal|error):/i.test(l)) ?? lines.at(-1) ?? raw
  return makeAppError('GIT_GENERIC', { detail })
}

// Explicit commit identity (-c user.name/user.email) — otherwise on a
// machine where global user.name/user.email was never configured in git
// (typical for someone who installed CoopSync and doesn't otherwise use
// git), commit fails with "unable to auto-detect email address". A noreply
// address from GitHub doesn't need verification, it's just valid for git.
function identityFlags(actor: string): string[] {
  return ['-c', `user.name=${actor}`, '-c', `user.email=${actor}@users.noreply.github.com`]
}

// Run git inside the already-cloned repo.
async function git(args: string[]): Promise<string> {
  try {
    const { stdout } = await exec('git', [...NO_HELPER, ...args], {
      cwd: repoDir(),
      maxBuffer: BIG_BUFFER,
      env: GIT_ENV
    })
    return stdout
  } catch (e) {
    throw wrapGitError(e)
  }
}

// Concurrent calls (e.g. MainScreen and HistoryScreen both trigger
// ensureRepo in parallel on startup) would otherwise race for the same
// clone and break each other (two "git clone" into the same folder).
// Serialize them through a shared promise.
let ensureRepoInFlight: Promise<void> | null = null

// Make sure the repo is cloned locally and up to date with GitHub.
async function ensureRepo(token: string, owner: string): Promise<void> {
  if (!ensureRepoInFlight) {
    ensureRepoInFlight = doEnsureRepo(token, owner).finally(() => {
      ensureRepoInFlight = null
    })
  }
  return ensureRepoInFlight
}

async function doEnsureRepo(token: string, owner: string, retried = false): Promise<void> {
  const dir = repoDir()
  const url = remoteUrl(token, owner)

  if (!existsSync(join(dir, '.git'))) {
    await mkdir(app.getPath('userData'), { recursive: true })
    try {
      await exec('git', [...NO_HELPER, 'clone', url, dir], { maxBuffer: BIG_BUFFER, env: GIT_ENV })
    } catch (e) {
      throw wrapGitError(e)
    }
  } else {
    // Refresh the token in the remote (it may have changed) and pull the latest.
    await git(['remote', 'set-url', 'origin', url])
    // Reset any uncommitted changes in this internal clone before pulling.
    // This is a technical working copy, not a source of truth (the real
    // saves are copied here fresh from the actual game folder on every
    // uploadGame) — if the app crashed/closed mid-copy (after copyFiltered,
    // before git commit), the clone stays "dirty" and pull permanently fails
    // with "local changes would be overwritten by merge", breaking all of
    // sync (history, upload, download) until manual intervention.
    try {
      await git(['reset', '--hard', 'HEAD'])
      await git(['clean', '-fd'])
    } catch {
      // If even reset/clean failed — don't block the pull attempt below,
      // let it fail with its own clearer error.
    }
    try {
      await exec('git', [...NO_HELPER, 'pull', '--no-rebase', 'origin', 'main'], {
        cwd: dir,
        maxBuffer: BIG_BUFFER,
        env: GIT_ENV
      })
    } catch (e) {
      const raw = e instanceof Error ? e.message : String(e)
      if (!retried && /refusing to merge unrelated histories/i.test(raw)) {
        // The local clone is stale relative to a recreated GitHub repo (e.g.
        // someone deleted and recreated the repo) — recreate the clone from
        // scratch ourselves instead of failing forever with a confusing git error.
        await rm(dir, { recursive: true, force: true })
        return doEnsureRepo(token, owner, true)
      }
      throw wrapGitError(e)
    }
  }
}

function findGame(appId: string): { name: string; savePath: string; saveFilePattern?: RegExp } {
  const g = getSyncableGames().find((x) => x.appId === appId)
  if (!g) throw makeAppError('GAME_NOT_SUPPORTED')
  const savePath = resolveSavePath(g)
  // A custom game a co-op partner added but this PC hasn't configured yet
  // (materializeRemoteCustomGame — empty savePath, no override set). The UI
  // never offers Upload/Download for 'needs-setup' games, but guard here too
  // rather than let mkdir/existsSync('') below fail with a raw fs exception.
  if (!savePath) throw makeAppError('SAVE_FOLDER_NOT_FOUND')
  return { name: g.name, savePath, saveFilePattern: g.saveFilePattern }
}

// Copies a folder, skipping files (not folders) that don't match the game's
// pattern — needed for games where the same saves folder also contains
// account-specific files that must not be moved to a different PC (see
// SupportedGame.saveFilePattern).
async function copyFiltered(src: string, dest: string, pattern?: RegExp): Promise<void> {
  await cp(src, dest, {
    recursive: true,
    filter: (source) => {
      if (!pattern) return true
      if (statSync(source).isDirectory()) return true
      return pattern.test(basename(source))
    }
  })
}

// Removes only files matching the game's pattern (folders are always
// recursed into, same as copyFiltered) — anything else in the folder (e.g.
// account/platform files, or engine settings that happen to live alongside
// the saves) is left untouched. Without a pattern, the whole folder is fair
// game (matches copyFiltered's "no pattern = sync everything" behavior).
async function clearFiltered(dir: string, pattern?: RegExp): Promise<void> {
  if (!existsSync(dir)) return
  if (!pattern) {
    await rm(dir, { recursive: true, force: true })
    return
  }
  const entries = await readdir(dir, { withFileTypes: true })
  for (const e of entries) {
    const full = join(dir, e.name)
    if (e.isDirectory()) await clearFiltered(full, pattern)
    else if (pattern.test(e.name)) await rm(full, { force: true })
  }
}

// --- Save versions ---
// The cloud version lives in the repo at .meta/<game>.json; the local one — in userData.

function remoteMetaPath(name: string): string {
  return join(repoDir(), '.meta', `${name}.json`)
}

interface RemoteMeta {
  version: number
  updatedAt: string
  updatedBy: string
}

async function readRemoteMeta(name: string): Promise<RemoteMeta | null> {
  const p = remoteMetaPath(name)
  if (!existsSync(p)) return null
  try {
    // Strip a possible leading BOM — otherwise JSON.parse fails.
    const raw = (await readFile(p, 'utf8')).replace(/^﻿/, '')
    return JSON.parse(raw) as RemoteMeta
  } catch {
    return null
  }
}

async function readRemoteVersion(name: string): Promise<number> {
  const meta = await readRemoteMeta(name)
  return meta?.version ?? 0
}

async function writeRemoteMeta(name: string, version: number, owner: string): Promise<void> {
  await mkdir(join(repoDir(), '.meta'), { recursive: true })
  const meta = { version, updatedAt: new Date().toISOString(), updatedBy: owner }
  await writeFile(remoteMetaPath(name), JSON.stringify(meta, null, 2))
}

// --- Sync history ---
// A log of push events shared between host and join (lives in the repo
// itself, so it syncs along with the saves). Push only — download is local
// and doesn't change anything in the cloud, so logging it in the shared
// history wouldn't make sense. Kept in full (no cap) — the History screen
// paginates over it instead of truncating the underlying log.

function historyPath(): string {
  return join(repoDir(), '.meta', 'history.json')
}

async function readHistory(): Promise<SyncHistoryEntry[]> {
  const p = historyPath()
  if (!existsSync(p)) return []
  try {
    const raw = (await readFile(p, 'utf8')).replace(/^﻿/, '')
    return JSON.parse(raw) as SyncHistoryEntry[]
  } catch {
    return []
  }
}

async function appendHistory(entry: SyncHistoryEntry): Promise<void> {
  const current = await readHistory()
  const next = [entry, ...current]
  await mkdir(join(repoDir(), '.meta'), { recursive: true })
  await writeFile(historyPath(), JSON.stringify(next, null, 2))
}

/** Push event history, newest first. */
export async function getSyncHistory(token: string, owner: string): Promise<SyncHistoryEntry[]> {
  try {
    await ensureRepo(token, owner)
  } catch (e) {
    // The live repo might be unreachable (access revoked, repo deleted,
    // offline) — if we already have local history sitting in the clone
    // from before, show that instead of erroring the whole screen. Restore
    // still needs to push, so it'll surface its own clear error if
    // actually attempted while access is gone.
    if (!existsSync(historyPath())) throw e
  }
  return readHistory()
}

function localVersionsPath(): string {
  return join(app.getPath('userData'), 'coopsync-versions.json')
}

async function readLocalVersions(): Promise<Record<string, number>> {
  const p = localVersionsPath()
  if (!existsSync(p)) return {}
  try {
    const raw = (await readFile(p, 'utf8')).replace(/^﻿/, '')
    return JSON.parse(raw) as Record<string, number>
  } catch {
    return {}
  }
}

async function setLocalVersion(appId: string, version: number): Promise<void> {
  const all = await readLocalVersions()
  all[appId] = version
  await writeFile(localVersionsPath(), JSON.stringify(all, null, 2))
}

/** Upload the game's saves to GitHub (push). Bumps the version.
 * `owner` — whose repo (the sync target, for join this is the host); `actor`
 * — who's actually pressing the button right now (for join this is NOT
 * owner) — it's actor that goes into the history/commit. `restoredFrom` —
 * set only by revertToVersion below, when this push's content came from an
 * older version rather than the live save folder. */
export async function uploadGame(
  token: string,
  owner: string,
  appId: string,
  actor: string,
  restoredFrom?: number
): Promise<SyncResult> {
  await ensureRepo(token, owner)
  const game = findGame(appId)
  if (!existsSync(game.savePath)) throw makeAppError('SAVE_FOLDER_NOT_FOUND')

  const dest = join(repoDir(), game.name)

  // If a cloud copy already exists and its content matches the local one
  // (no real changes — typical case: local version tracking got reset, but
  // the game hasn't been launched since) — don't bump the version or create
  // an empty commit, just sync local tracking to the already-current cloud version.
  if (existsSync(dest)) {
    const [localHash, remoteHash] = await Promise.all([
      folderHash(game.savePath, game.saveFilePattern),
      folderHash(dest, game.saveFilePattern)
    ])
    if (localHash === remoteHash) {
      const remoteVersion = await readRemoteVersion(game.name)
      await setLocalVersion(appId, remoteVersion)
      return { version: remoteVersion, pushed: false }
    }
  }

  // Replace the game folder's content in the repo with fresh local saves.
  await rm(dest, { recursive: true, force: true })
  await copyFiltered(game.savePath, dest, game.saveFilePattern)

  const newVersion = (await readRemoteVersion(game.name)) + 1
  await writeRemoteMeta(game.name, newVersion, actor)
  await appendHistory({
    appId,
    gameName: game.name,
    version: newVersion,
    updatedBy: actor,
    updatedAt: new Date().toISOString(),
    ...(restoredFrom !== undefined ? { restoredFrom } : {})
  })

  await git(['add', '-A'])
  const restoreNote = restoredFrom !== undefined ? ` [restored from ${formatVersion(restoredFrom)}]` : ''
  await git([
    ...identityFlags(actor),
    'commit',
    '-m',
    `sync: ${game.name} ${formatVersion(newVersion)} (${actor})${restoreNote}`
  ])
  await git(['push', 'origin', 'main'])
  await setLocalVersion(appId, newVersion)
  return { version: newVersion, pushed: true }
}

// Finds the commit that produced a given historical version of a game — by
// walking the commits that touched its meta file and reading the version
// recorded in each, rather than storing a commit sha up front (which would
// need its own separate commit, since the sha isn't known until after the
// very commit history.json is written into).
async function findCommitForVersion(gameName: string, targetVersion: number): Promise<string> {
  const log = await git(['log', '--format=%H', '--', `.meta/${gameName}.json`])
  const shas = log
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)
  for (const sha of shas) {
    try {
      const raw = await git(['show', `${sha}:.meta/${gameName}.json`])
      const meta = JSON.parse(raw.replace(/^﻿/, '')) as RemoteMeta
      if (meta.version === targetVersion) return sha
    } catch {
      // Meta file didn't exist yet at this commit, or isn't parseable — skip it.
    }
  }
  throw makeAppError('GIT_GENERIC', { detail: `No commit found for version ${targetVersion}` })
}

/** Revert a game's saves to an older version. Not a branch — the old
 *  snapshot is pushed back as a brand new version at the top of history, so
 *  the existing sync flow (auto-pull on a newer remote version) picks it up
 *  for anyone else with access exactly like any other push, no separate
 *  "switch branches" step needed on their end. */
export async function revertToVersion(
  token: string,
  owner: string,
  appId: string,
  actor: string,
  targetVersion: number
): Promise<SyncResult> {
  // Restoring overwrites the local save folder unconditionally (see below) —
  // if the game is still running (even just lingering on exit, saves already
  // made), this would clobber that session's real saves with the old
  // version, AND immediately push that old version over them, so the
  // exit-triggered autopush later finds local == cloud and skips, silently
  // discarding what was actually played. A live check, not watcher.ts's
  // polled state, which can be a few seconds stale.
  if (await isGameCurrentlyRunning(appId)) throw makeAppError('GAME_RUNNING')

  await ensureRepo(token, owner)
  const game = findGame(appId)
  const sha = await findCommitForVersion(game.name, targetVersion)

  // Pull that historical snapshot into the clone's working tree, copy it to
  // the local save folder (this is what actually "restores" the save — it
  // overwrites whatever's there now), then put the clone back to a clean
  // HEAD. The clone is a scratch working copy, not a source of truth (see
  // ensureRepo) — uploadGame below re-derives its content from the local
  // save folder fresh anyway.
  // clearFiltered, not a blind rm — the local save folder can hold files
  // that were never part of the sync in the first place (e.g. Subnautica
  // 2's account/platform cache sitting right next to the actual world
  // saves). A plain rm(savePath) wiped those too, forcing a full game
  // re-setup after every revert — clearFiltered only removes what
  // saveFilePattern actually syncs, same scope copyFiltered uses right after.
  await git(['checkout', sha, '--', game.name])
  await clearFiltered(game.savePath, game.saveFilePattern)
  await copyFiltered(join(repoDir(), game.name), game.savePath, game.saveFilePattern)
  await git(['checkout', 'HEAD', '--', game.name])

  return uploadGame(token, owner, appId, actor, targetVersion)
}

// --- Member avatars ---
// Stored directly in the shared repo (.meta/avatars/<login>.txt — a raw data
// URL, the same format as the local avatarDataUrl), so every member of the
// co-op group can see the other's picture. The avatar is local only until
// the first upload — after uploadAvatar it's available to everyone with access.

function avatarPath(login: string): string {
  return join(repoDir(), '.meta', 'avatars', `${login}.txt`)
}

/** Upload (or remove, if dataUrl === null) your own avatar to the shared repo. */
export async function uploadAvatar(
  token: string,
  owner: string,
  actor: string,
  dataUrl: string | null
): Promise<void> {
  await ensureRepo(token, owner)
  await mkdir(join(repoDir(), '.meta', 'avatars'), { recursive: true })
  const p = avatarPath(actor)
  if (dataUrl) {
    await writeFile(p, dataUrl)
  } else {
    if (!existsSync(p)) return
    await rm(p, { force: true })
  }

  await git(['add', '-A'])
  // If the file didn't change (the same picture was already pushed) — there's
  // nothing to commit, and a bare `git commit` with no changes fails with "nothing to commit".
  const status = await git(['status', '--porcelain'])
  if (!status.trim()) return
  await git([...identityFlags(actor), 'commit', '-m', `avatar: ${actor}`])
  await git(['push', 'origin', 'main'])
}

/** Member avatars (owner + collaborators) from the shared repo, keyed by login. */
export async function getAvatars(
  token: string,
  owner: string,
  logins: string[]
): Promise<Record<string, string>> {
  await ensureRepo(token, owner)
  const result: Record<string, string> = {}
  for (const login of logins) {
    const p = avatarPath(login)
    if (existsSync(p)) {
      try {
        result[login] = (await readFile(p, 'utf8')).replace(/^﻿/, '')
      } catch {
        // Corrupted file — just skip it, a placeholder will be shown instead.
      }
    }
  }
  return result
}

// --- Custom games registry ---
// A shared list of {appId, name} for games added manually (customGames.ts) —
// lives in the repo at .meta/custom-games.json, alongside avatars/history.
// Only appId+name are shared; savePath/processNames are per-machine and stay
// in local settings (a co-op partner's save folder is never the same path).
// A partner's app materializes an entry it doesn't know yet with an empty
// savePath (materializeRemoteCustomGame) — shown as 'needs-setup' below
// until they point it at their own save folder via the game's detail screen.

interface RemoteCustomGameEntry {
  appId: string
  name: string
}

function customGamesRegistryPath(): string {
  return join(repoDir(), '.meta', 'custom-games.json')
}

async function readCustomGamesRegistry(): Promise<RemoteCustomGameEntry[]> {
  const p = customGamesRegistryPath()
  if (!existsSync(p)) return []
  try {
    const raw = (await readFile(p, 'utf8')).replace(/^﻿/, '')
    return JSON.parse(raw) as RemoteCustomGameEntry[]
  } catch {
    return []
  }
}

/** Add a just-added custom game to the shared registry, so a co-op partner's
 *  app can see it exists (best-effort — called right after the local add
 *  succeeds, see ipc.ts's games:add-custom). */
export async function pushCustomGameToRegistry(
  token: string,
  owner: string,
  actor: string,
  appId: string,
  name: string
): Promise<void> {
  await ensureRepo(token, owner)
  const current = await readCustomGamesRegistry()
  if (current.some((e) => e.appId === appId)) return
  await mkdir(join(repoDir(), '.meta'), { recursive: true })
  await writeFile(customGamesRegistryPath(), JSON.stringify([...current, { appId, name }], null, 2))
  await git(['add', '-A'])
  await git([...identityFlags(actor), 'commit', '-m', `custom-game: add ${name}`])
  await git(['push', 'origin', 'main'])
}

/** Remove a custom game from the shared registry (best-effort — see ipc.ts's
 *  games:remove-custom). Never touches anyone's already-materialized local
 *  entry — a partner who already set up their save folder keeps working. */
export async function removeCustomGameFromRegistry(
  token: string,
  owner: string,
  actor: string,
  appId: string
): Promise<void> {
  await ensureRepo(token, owner)
  const current = await readCustomGamesRegistry()
  const next = current.filter((e) => e.appId !== appId)
  if (next.length === current.length) return
  await mkdir(join(repoDir(), '.meta'), { recursive: true })
  await writeFile(customGamesRegistryPath(), JSON.stringify(next, null, 2))
  await git(['add', '-A'])
  const name = current.find((e) => e.appId === appId)?.name ?? appId
  await git([...identityFlags(actor), 'commit', '-m', `custom-game: remove ${name}`])
  await git(['push', 'origin', 'main'])
}

// --- Custom game covers ---
// A custom game's cover art is shared, not per-machine, like its name (see
// the registry above) — unlike the save path/processNames, there's no
// reason for a co-op partner's copy to look different. Stored the same way
// avatars are (.meta/covers/<appId>.txt, a raw data URL).

// A custom game's appId is "custom:<uuid>" — a literal ':' in a Windows path
// segment isn't rejected, it's silently reinterpreted as an NTFS Alternate
// Data Stream separator ("custom" + a hidden stream named the rest). Every
// fs call (existsSync/writeFile/readFile) keeps "succeeding" against that
// hidden stream with no error anywhere, but git only ever sees the empty
// base file "custom" — the actual cover data never gets committed at all.
// This is why a cover push could report success and still never reach a
// partner. Replacing ':' keeps the path a normal, git-trackable file.
function coverPath(appId: string): string {
  return join(repoDir(), '.meta', 'covers', `${appId.replace(/:/g, '_')}.txt`)
}

/** Push a custom game's already-cropped cover (or clear it, dataUrl=null) to
 *  the shared repo — best-effort, called right after the local save
 *  succeeds (see ipc.ts's games:save-cover / games:add-custom). */
export async function pushCustomGameCover(
  token: string,
  owner: string,
  actor: string,
  appId: string,
  dataUrl: string | null
): Promise<void> {
  await ensureRepo(token, owner)
  await mkdir(join(repoDir(), '.meta', 'covers'), { recursive: true })
  const p = coverPath(appId)
  if (dataUrl) {
    await writeFile(p, dataUrl)
  } else {
    if (!existsSync(p)) return
    await rm(p, { force: true })
  }
  await git(['add', '-A'])
  const status = await git(['status', '--porcelain'])
  if (!status.trim()) return
  await git([...identityFlags(actor), 'commit', '-m', `custom-game-cover: ${appId}`])
  await git(['push', 'origin', 'main'])
}

async function readRemoteCover(appId: string): Promise<string | null> {
  const p = coverPath(appId)
  if (!existsSync(p)) return null
  try {
    return (await readFile(p, 'utf8')).replace(/^﻿/, '')
  } catch {
    return null
  }
}

/**
 * Download files from the cloud that are missing locally — without touching
 * existing local files (git-like behavior: add what's missing, don't
 * overwrite what's already there). Protects against the scenario where a
 * player deleted part of their local saves (e.g. one world) — on game
 * launch these files are automatically restored from the cloud, and the app
 * no longer treats their absence as "local progress" that needs to be
 * pushed over the cloud.
 * Returns the number of restored files.
 */
export async function restoreMissingFiles(token: string, owner: string, appId: string): Promise<number> {
  await ensureRepo(token, owner)
  const game = findGame(appId)
  const repoPath = join(repoDir(), game.name)
  if (!existsSync(repoPath)) return 0

  let restored = 0
  async function walk(remoteDir: string, localDir: string): Promise<void> {
    const entries = await readdir(remoteDir, { withFileTypes: true })
    for (const e of entries) {
      if (e.name === '.git') continue
      if (game.saveFilePattern && !e.isDirectory() && !game.saveFilePattern.test(e.name)) continue
      const remoteFull = join(remoteDir, e.name)
      const localFull = join(localDir, e.name)
      if (e.isDirectory()) {
        await walk(remoteFull, localFull)
      } else if (!existsSync(localFull)) {
        await mkdir(localDir, { recursive: true })
        await cp(remoteFull, localFull)
        restored++
      }
    }
  }
  await walk(repoPath, game.savePath)
  return restored
}

/** Download the game's saves from GitHub into the local folder (pull). */
export async function downloadGame(token: string, owner: string, appId: string): Promise<SyncResult> {
  await ensureRepo(token, owner)
  const game = findGame(appId)

  const src = join(repoDir(), game.name)
  if (!existsSync(src)) throw makeAppError('NO_CLOUD_SAVES')

  await mkdir(game.savePath, { recursive: true })
  await copyFiltered(src, game.savePath, game.saveFilePattern)

  // Local version now equals the cloud version.
  const remoteVersion = await readRemoteVersion(game.name)
  await setLocalVersion(appId, remoteVersion)
  return { version: remoteVersion }
}

/** Remove the local repo clone and stale versions — after the repo is deleted on GitHub. */
export async function resetLocalSaveState(): Promise<void> {
  await rm(repoDir(), { recursive: true, force: true })
  await rm(localVersionsPath(), { force: true })
}

/** Turn the local clone of a shared repo you're about to leave (or already
 *  got kicked from) into your own, self-owned repo — WITH its full version
 *  history, not just the current save files as a fresh v1. Unlike a normal
 *  leave (resetLocalSaveState), this deliberately keeps the local clone
 *  intact: it's the only copy of that history left once access to the old
 *  repo is gone, so it becomes the new repo's content instead of being
 *  thrown away. If newOwner already has their own saves repo (e.g. from an
 *  earlier host stint), this overwrites it with the local history rather
 *  than blocking — it's their own repo, and updating it in place is what
 *  they'd want instead of being stuck. */
export async function adoptLocalHistoryAsOwnRepo(
  token: string,
  newOwner: string,
  oldHostOwner: string,
  selfLogin: string
): Promise<void> {
  if (!existsSync(join(repoDir(), '.git'))) throw makeAppError('SAVE_FOLDER_NOT_FOUND')

  await createSavesRepo(token, newOwner) // creates it, or returns the existing one — either way we push into it below

  await git(['remote', 'set-url', 'origin', remoteUrl(token, newOwner)])
  // Force, not a plain push — the target repo has unrelated history (its
  // own auto-init README commit, or whatever was there before if it
  // already existed), which this history is meant to replace, not merge
  // with.
  await git(['push', '--force', 'origin', 'main'])

  try {
    await leaveSharedRepo(token, oldHostOwner, selfLogin)
  } catch {
    // Best-effort — if we were already removed (e.g. kicked), there's
    // nothing left to leave; not worth failing the whole adoption over.
  }
}

// --- Sync status detection ---

// A fingerprint of a folder's content: a sorted list of "path:hash" → a
// single hash. Same fingerprint = same content.
async function folderHash(dir: string, pattern?: RegExp): Promise<string> {
  const parts: string[] = []
  async function walk(d: string, rel: string): Promise<void> {
    const entries = (await readdir(d, { withFileTypes: true })).sort((a, b) =>
      a.name.localeCompare(b.name)
    )
    for (const e of entries) {
      if (e.name === '.git') continue
      if (pattern && !e.isDirectory() && !pattern.test(e.name)) continue
      const full = join(d, e.name)
      const r = rel ? `${rel}/${e.name}` : e.name
      if (e.isDirectory()) await walk(full, r)
      else {
        const hash = createHash('sha1').update(await readFile(full)).digest('hex')
        parts.push(`${r}:${hash}`)
      }
    }
  }
  await walk(dir, '')
  return createHash('sha1').update(parts.join('\n')).digest('hex')
}

// Time of the last file change in the folder (freshest mtime, ms). 0 if there are no files.
// Used to distinguish "local progress is genuinely newer" from "local
// content just differs because it was swapped for an old backup".
async function maxMtime(dir: string, pattern?: RegExp): Promise<number> {
  let max = 0
  async function walk(d: string): Promise<void> {
    const entries = await readdir(d, { withFileTypes: true })
    for (const e of entries) {
      if (e.name === '.git') continue
      if (pattern && !e.isDirectory() && !pattern.test(e.name)) continue
      const full = join(d, e.name)
      if (e.isDirectory()) await walk(full)
      else max = Math.max(max, statSync(full).mtimeMs)
    }
  }
  await walk(dir)
  return max
}

// Total size of files in the folder (respecting the same filter pattern as
// copyFiltered/folderHash — so the number matches what's actually synced).
async function folderSize(dir: string, pattern?: RegExp): Promise<number> {
  let total = 0
  async function walk(d: string): Promise<void> {
    const entries = await readdir(d, { withFileTypes: true })
    for (const e of entries) {
      if (e.name === '.git') continue
      if (pattern && !e.isDirectory() && !pattern.test(e.name)) continue
      const full = join(d, e.name)
      if (e.isDirectory()) await walk(full)
      else total += statSync(full).size
    }
  }
  await walk(dir)
  return total
}

/** Sync status for all supported games (a single pull covers all of them). */
export async function getSyncStatuses(
  token: string,
  owner: string,
  actor: string
): Promise<GameSyncStatus[]> {
  try {
    await ensureRepo(token, owner)
  } catch (e) {
    const raw = e instanceof Error ? e.message : String(e)
    if (parseAppError(raw)?.code === 'REPO_NOT_FOUND') {
      // The repo was deleted on GitHub (and the local clone is either
      // missing or stale) — not a network/token error, but a clear "no
      // repo" state. We show this explicitly on every card instead of
      // failing with an error and leaving games stuck on "Checking..." forever.
      return getSyncableGames().map((g) => ({
        appId: g.appId,
        status: 'no-repo',
        localVersion: 0,
        remoteVersion: 0
      }))
    }
    throw e
  }

  // Pick up any custom game a co-op partner added since we last checked
  // (best-effort — an unreachable/corrupt registry file just means nothing
  // new gets picked up this cycle, not a hard failure of the whole check).
  // Also self-heal our OWN custom game(s) whose initial registry push failed
  // silently (games:add-custom swallows that error so using a freshly-added
  // game locally is never blocked by it) — a partner can never discover a
  // game that never made it into the registry no matter how many times they
  // check, so retrying here on every check (on-demand and the ~2min
  // background one) is the only way it ever heals without the user knowing
  // anything failed in the first place. And mirror a partner removing a
  // game they own — games:remove-custom only ever drops the registry entry,
  // never touches an already-materialized local copy elsewhere (so a
  // partner mid-game never loses their local setup out from under them just
  // because a check happened to run) — so removal has to be noticed here
  // instead, the same way an add is.
  try {
    const registry = await readCustomGamesRegistry()
    const registered = new Set(registry.map((e) => e.appId))
    for (const entry of registry) {
      materializeRemoteCustomGame(entry.appId, entry.name)
    }
    for (const g of listCustomGames()) {
      if (registered.has(g.appId)) continue
      if (g.receivedFromPartner) {
        // The owner removed it on their end — stop tracking it here too.
        removeCustomGame(g.appId)
        continue
      }
      // Not in the registry and not something we received -- we own it (added
      // it ourselves on this PC), so it's missing because the original push
      // failed, not because anyone removed it. Push it again.
      try {
        await pushCustomGameToRegistry(token, owner, actor, g.appId, g.name)
      } catch {
        // Try again next check — same reasoning as the outer catch below.
      }
    }
  } catch {
    // See above — try again next time getSyncStatuses runs.
  }

  // Retry a custom game's registry-removal push that failed when it was
  // removed locally (games:remove-custom) — nothing local still references
  // that appId to fall back on, so this list (not the registry-sync pass
  // above) is what remembers it still needs to happen.
  for (const appId of getPendingCustomGameRemovals()) {
    try {
      await removeCustomGameFromRegistry(token, owner, actor, appId)
      clearPendingCustomGameRemoval(appId)
    } catch {
      // Try again next check.
    }
  }

  // Adopt a co-op partner's cover for a custom game we don't already have
  // one for — never overwrites a cover already set locally (own choice, or
  // one already adopted), so this can't clobber an intentional local pick.
  try {
    for (const g of listCustomGames()) {
      if (g.coverDataUrl) continue
      const remoteCover = await readRemoteCover(g.appId)
      if (remoteCover) setCustomGameCover(g.appId, remoteCover)
    }
  } catch {
    // Best-effort, same reasoning as the registry pass above.
  }

  const localVersions = await readLocalVersions()
  const result: GameSyncStatus[] = []
  for (const g of getSyncableGames()) {
    const savePath = resolveSavePath(g)

    // A custom game that's been materialized from a partner's registry entry
    // but this PC hasn't pointed at a local save folder yet (see
    // materializeRemoteCustomGame) — nothing to compare until they do, via
    // the game's detail screen (the same save-path editor a catalog game uses).
    if (isCustomGameId(g.appId) && !savePath) {
      result.push({ appId: g.appId, status: 'needs-setup', localVersion: 0, remoteVersion: 0 })
      continue
    }

    const repoPath = join(repoDir(), g.name)
    const localExists = existsSync(savePath)
    const remoteExists = existsSync(repoPath)

    const localVer = localVersions[g.appId] ?? 0
    const remoteMeta = await readRemoteMeta(g.name)
    const remoteVer = remoteMeta?.version ?? 0

    let status: SyncStatus
    if (!localExists && !remoteExists) {
      status = 'no-saves'
    } else if (localExists && !remoteExists) {
      status = 'not-uploaded'
    } else if (!localExists && remoteExists) {
      status = 'cloud-only'
    } else if (remoteVer > localVer) {
      // The cloud has a newer version → needs to be downloaded.
      status = 'remote-newer'
    } else {
      // Version isn't newer — check for unsaved local changes.
      const [localHash, remoteHash] = await Promise.all([
        folderHash(savePath, g.saveFilePattern),
        folderHash(repoPath, g.saveFilePattern)
      ])
      if (localHash === remoteHash) {
        status = 'synced'
      } else if (
        remoteMeta &&
        (await maxMtime(savePath, g.saveFilePattern)) <= new Date(remoteMeta.updatedAt).getTime()
      ) {
        // Local content differs from the cloud, but no local file was
        // modified AFTER the last known cloud sync — this isn't new
        // progress, it's stale data (e.g. an old save backup was restored).
        // Can't treat this as "locally newer" — otherwise stale data would
        // silently overwrite cloud progress on auto-push.
        status = 'local-stale'
      } else {
        status = 'local-newer'
      }
    }

    // Show time/size from the shared (cloud) copy when it exists — that's
    // what both players see regardless of who synced last.
    // Otherwise (nobody has uploaded yet) — at least the local folder's size.
    const sizeBytes = remoteExists
      ? await folderSize(repoPath, g.saveFilePattern)
      : localExists
        ? await folderSize(savePath, g.saveFilePattern)
        : undefined

    result.push({
      appId: g.appId,
      status,
      localVersion: localVer,
      remoteVersion: remoteVer,
      lastSyncAt: remoteMeta?.updatedAt,
      remoteUpdatedBy: remoteMeta?.updatedBy,
      sizeBytes
    })
  }
  return result
}

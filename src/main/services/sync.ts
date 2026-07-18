import { app } from 'electron'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { createHash } from 'crypto'
import { basename, join } from 'path'
import { existsSync, statSync } from 'fs'
import { cp, rm, mkdir, readdir, readFile, writeFile } from 'fs/promises'
import { SUPPORTED_GAMES, READY_GAMES } from '../games/catalog'
import { SAVES_REPO_NAME } from '../config'
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
  const g = SUPPORTED_GAMES.find((x) => x.appId === appId)
  if (!g) throw makeAppError('GAME_NOT_SUPPORTED')
  return { name: g.name, savePath: g.getSavePath(), saveFilePattern: g.saveFilePattern }
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
  await ensureRepo(token, owner)
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
  await ensureRepo(token, owner)
  const game = findGame(appId)
  const sha = await findCommitForVersion(game.name, targetVersion)

  // Pull that historical snapshot into the clone's working tree, copy it to
  // the local save folder (this is what actually "restores" the save — it
  // overwrites whatever's there now), then put the clone back to a clean
  // HEAD. The clone is a scratch working copy, not a source of truth (see
  // ensureRepo) — uploadGame below re-derives its content from the local
  // save folder fresh anyway.
  await git(['checkout', sha, '--', game.name])
  await rm(game.savePath, { recursive: true, force: true })
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
export async function getSyncStatuses(token: string, owner: string): Promise<GameSyncStatus[]> {
  try {
    await ensureRepo(token, owner)
  } catch (e) {
    const raw = e instanceof Error ? e.message : String(e)
    if (parseAppError(raw)?.code === 'REPO_NOT_FOUND') {
      // The repo was deleted on GitHub (and the local clone is either
      // missing or stale) — not a network/token error, but a clear "no
      // repo" state. We show this explicitly on every card instead of
      // failing with an error and leaving games stuck on "Checking..." forever.
      return READY_GAMES.map((g) => ({
        appId: g.appId,
        status: 'no-repo',
        localVersion: 0,
        remoteVersion: 0
      }))
    }
    throw e
  }

  const localVersions = await readLocalVersions()
  const result: GameSyncStatus[] = []
  for (const g of READY_GAMES) {
    const savePath = g.getSavePath()
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

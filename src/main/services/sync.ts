import { app } from 'electron'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { createHash, randomUUID } from 'crypto'
import { basename, join } from 'path'
import { existsSync, statSync } from 'fs'
import { cp, rm, mkdir, readdir, readFile, writeFile } from 'fs/promises'
import { resolveSavePath } from '../games/savePath'
import { isGamePersonal } from '../games/syncScope'
import {
  getSyncableGames,
  isCustomGameId,
  materializeRemoteCustomGame,
  listCustomGames,
  setCustomGameCover,
  setCustomGameName,
  getPendingCustomGameRemovals,
  clearPendingCustomGameRemoval,
  markCustomGameRegistryConfirmed,
  markCustomGameOrphaned,
  buildExcludePattern,
  materializeRemoteExtraFolder,
  markExtraFolderRegistryConfirmed,
  markExtraFolderOrphaned,
  setExtraFolderLabel,
  getPendingFolderRemovals,
  clearPendingFolderRemoval
} from '../games/customGames'
import { addNotification } from './notificationStore'
import { SAVES_REPO_NAME } from '../config'
import { isGameCurrentlyRunning } from './processCheck'
import { createSavesRepo, leaveSharedRepo } from './github'
import { makeAppError, parseAppError } from '../../shared/errors'
import { formatVersion } from '../../shared/format'
import type {
  SyncStatus,
  GameSyncStatus,
  SyncHistoryEntry,
  SyncResult,
  CustomGame,
  CustomExtraFolder,
  FolderSyncStatus
} from '../../shared/types'

const exec = promisify(execFile)
const BIG_BUFFER = 64 * 1024 * 1024 // headroom for large saves

// Local folder we clone the shared repo into.
function repoDir(): string {
  return join(app.getPath('userData'), 'saves-repo')
}

// A game's main save content lives at <gameName>/main/ in the repo — a
// specific subdirectory, not the whole <gameName>/ folder — so it never
// overlaps with <gameName>/extra/<folderId>/... (see extraFolderContentDir
// further down): every content-touching op (rm, copyFiltered, folderHash)
// only ever reaches into its OWN folder's subtree, this one included, no
// matter how many extra folders a game ends up with. This is deliberately
// NOT the whole-directory path uploadGame/downloadGame/etc. used before
// 2026-07-27 — see extraFolderContentDir's doc comment for the exact
// feedback-loop bug that caused (main folder's rm+recopy wiping an extra
// folder that lived inside it, and vice versa for its hash).
// personalLogin (set only for a CustomGame with personal:true — see its own
// doc comment) routes to a path namespaced by that login instead, mirroring
// extraFolderContentDir's shared/personal split one level up: a restored
// "just for myself" game keeps syncing to the SAME repo, just invisible to
// anyone else and never registered.
function mainContentDir(gameName: string, personalLogin?: string): string {
  return personalLogin
    ? join(repoDir(), gameName, 'main-personal', personalLogin)
    : join(repoDir(), gameName, 'main')
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

// Run git in an arbitrary working directory (see withConflictWorktree below —
// a conflict snapshot's checkout/commit/push happen in a throwaway worktree,
// never in repoDir() itself).
async function gitIn(dir: string, args: string[]): Promise<string> {
  try {
    const { stdout } = await exec('git', [...NO_HELPER, ...args], {
      cwd: dir,
      maxBuffer: BIG_BUFFER,
      env: GIT_ENV
    })
    return stdout
  } catch (e) {
    throw wrapGitError(e)
  }
}

// Run git inside the already-cloned repo.
async function git(args: string[]): Promise<string> {
  return gitIn(repoDir(), args)
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
      // Two different reasons the local clone can become unusable, both
      // fixed the same way (it's a disposable working copy, not a source of
      // truth — see the big comment above): (1) it's stale relative to a
      // recreated GitHub repo, or (2) its own .git data got corrupted —
      // seen in practice as "fatal: bad object HEAD" after the app process
      // was killed mid git-operation (e.g. an installer force-closing a
      // still-running CoopSync while a push was in flight). Either way,
      // every retryable git call from here on would just keep failing with
      // a confusing raw error forever without this — recreate from scratch
      // instead.
      if (
        !retried &&
        /refusing to merge unrelated histories|bad object|fatal: not a git repository|unable to read|is corrupt|does not point to a valid object/i.test(
          raw
        )
      ) {
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

// ANY game (catalog or custom — see settingsStore.ts's personalGameIds doc
// comment) can be personal. `actor` doubles as the personal path's
// namespace: whoever is running THIS client is the only one who could ever
// have this appId marked personal locally — a catalog game's personal
// setting never leaves this machine, and a custom game's counterpart
// (nobody else's copy of the app even HAS the appId at all once it's
// orphaned) works the same way.
export function personalLoginFor(appId: string, actor: string): string | undefined {
  return isGamePersonal(appId) ? actor : undefined
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

// personalLogin — see mainContentDir's doc comment; a personal game's
// version meta lives in its own file so it can never collide with (or feed)
// the shared one a co-op partner reads.
function remoteMetaPath(name: string, personalLogin?: string): string {
  return personalLogin
    ? join(repoDir(), '.meta', `${name}-personal-${personalLogin}.json`)
    : join(repoDir(), '.meta', `${name}.json`)
}

interface RemoteMeta {
  version: number
  updatedAt: string
  updatedBy: string
}

async function readRemoteMeta(name: string, personalLogin?: string): Promise<RemoteMeta | null> {
  const p = remoteMetaPath(name, personalLogin)
  if (!existsSync(p)) return null
  try {
    // Strip a possible leading BOM — otherwise JSON.parse fails.
    const raw = (await readFile(p, 'utf8')).replace(/^﻿/, '')
    return JSON.parse(raw) as RemoteMeta
  } catch {
    return null
  }
}

export async function readRemoteVersion(name: string, personalLogin?: string): Promise<number> {
  const meta = await readRemoteMeta(name, personalLogin)
  return meta?.version ?? 0
}

async function writeRemoteMeta(name: string, version: number, owner: string, personalLogin?: string): Promise<void> {
  await mkdir(join(repoDir(), '.meta'), { recursive: true })
  const meta = { version, updatedAt: new Date().toISOString(), updatedBy: owner }
  await writeFile(remoteMetaPath(name, personalLogin), JSON.stringify(meta, null, 2))
}

// The version number to use for a game's NEXT push, from ANY of its
// folders (the main one, or any extra folder — shared or personal). One
// shared counter per game instead of each folder counting independently —
// otherwise a game's main folder and an extra folder (e.g. world vs.
// characters) drift apart into unrelated-looking numbers purely because one
// happened to get pushed more often than the other, which reads as "why do
// our versions differ?" even though nothing is actually wrong. Folders that
// weren't touched in a given push simply keep their own last version
// (falling behind is honest — it really hasn't changed since then) — this
// only affects what number a NEW push claims.
// Real gap found 2026-07-27: this used to scan EVERY meta file under a
// folder, personal-<login>.json included — meaning ONE person's private
// folder (invisible to their co-op partner, by design — see
// CustomExtraFolder's doc comment) could inflate the version number the
// OTHER person sees for the world/shared folders. E.g. if a friend plays
// solo for a while (only their own personal folder changing, no world
// activity), the world's version would later jump by however much their
// invisible personal activity added, the moment you next save it — "why did
// my world jump from v5 to v9, I only saved once?" with no visible cause.
// Only shared.json entries (main + shared extra folders — visible to and
// meaningful for BOTH people) feed this counter now. A personal folder still
// happily ADOPTS whatever this returns when it's cascaded together with a
// world save (see watcher.ts) — that's the whole point, staying coordinated
// with the world when it participates — it just never feeds back into it.
//
// `ownDestination` — the version already sitting at the SPECIFIC place this
// one push is about to overwrite (its own personal meta, or a personal
// folder's own meta — the caller already knows which, since it's the one
// about to write there), folded into the max on top of the shared baseline
// above. Real bug found 2026-07-28: a game (or folder) switched to personal
// claimed the exact same "sharedBaseline + 1" on EVERY subsequent push,
// forever — since a personal namespace deliberately never feeds the shared
// counter (the paragraph above), nothing ever moved the baseline forward for
// it, so the very first personal push and every one after it computed the
// identical number (e.g. toggling a game to "only me" at v19 pushed v20 —
// then playing, saving and exiting immediately pushed v20 again, not v21).
// This does NOT reintroduce that earlier bug: it only widens what the
// destination's OWN next push considers, never what a later SHARED push
// (which never passes this) reads.
export async function nextGameVersion(gameName: string, ownDestination?: number): Promise<number> {
  let max = await readRemoteVersion(gameName)
  const foldersDir = join(repoDir(), '.meta', 'folders', gameName)
  if (existsSync(foldersDir)) {
    for (const folderId of await readdir(foldersDir)) {
      const folderMetaDir = join(foldersDir, folderId)
      if (!statSync(folderMetaDir).isDirectory()) continue
      const sharedMetaPath = join(folderMetaDir, 'shared.json')
      if (!existsSync(sharedMetaPath)) continue
      try {
        const raw = (await readFile(sharedMetaPath, 'utf8')).replace(/^﻿/, '')
        const meta = JSON.parse(raw) as RemoteMeta
        if (meta.version > max) max = meta.version
      } catch {
        // Corrupt/unreadable entry — ignore it, doesn't block versioning.
      }
    }
  }
  if (ownDestination !== undefined && ownDestination > max) max = ownDestination
  return max + 1
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
 * older version rather than the live save folder. `explicitVersion` — the
 * caller (watcher.ts) always passes nextGameVersion's own result explicitly,
 * rather than this function calling it internally — a single shared
 * per-game counter (see nextGameVersion) means the main folder and its extra
 * folders never drift into unrelated-looking numbers, but each ACTUAL push
 * still claims its own fresh, unique number: two different pushes (e.g. a
 * mid-session save and a later exit save) must never share one version
 * number, or "revert to vX" would stop meaning one specific state. */
export async function uploadGame(
  token: string,
  owner: string,
  appId: string,
  actor: string,
  restoredFrom?: number,
  explicitVersion?: number
): Promise<SyncResult> {
  await ensureRepo(token, owner)
  const game = findGame(appId)
  if (!existsSync(game.savePath)) throw makeAppError('SAVE_FOLDER_NOT_FOUND')

  const personalLogin = personalLoginFor(appId, actor)
  const dest = mainContentDir(game.name, personalLogin)
  const localHash = await folderHash(game.savePath, game.saveFilePattern)

  // If a cloud copy already exists and its content matches the local one
  // (no real changes — typical case: local version tracking got reset, but
  // the game hasn't been launched since) — don't bump the version or create
  // an empty commit, just sync local tracking to the already-current cloud version.
  if (existsSync(dest)) {
    const remoteHash = await folderHash(dest, game.saveFilePattern)
    if (localHash === remoteHash) {
      const remoteVersion = await readRemoteVersion(game.name, personalLogin)
      await setLocalVersion(appId, remoteVersion)
      return { version: remoteVersion, pushed: false }
    }
  }

  // Doesn't match THIS destination's own last content (or there's nothing
  // there yet). Only relevant for the shared->personal direction (dest is
  // the PERSONAL one): a pure toggle (games:set-personal's immediate
  // re-sync) never touches the actual save folder, so right after flipping
  // it, the local content may still match whatever was last active in the
  // SHARED folder, not this (new, or long-stale) personal one. Checking
  // this unconditionally — not only when `dest` is missing — matters just
  // as much once the personal folder already exists from an earlier toggle:
  // it can hold a genuinely stale snapshot from a PREVIOUS personal stint,
  // which would otherwise misread as "new content" purely for being old.
  //
  // Deliberately NOT applied the other way (dest = shared, going personal->
  // shared): if shared's own content already matched local, the check above
  // already caught it (nothing happened while personal, no bump needed) —
  // but if it DIDN'T match, that means real progress happened while
  // personal, and this push is the very first time the co-op partner's
  // client will ever see it. That must always be a real, freshly-numbered,
  // history-logged push (the normal path below), even though the content
  // happens to be identical to the personal folder's own copy — a real bug
  // found 2026-07-28: treating that as "just a scope move" silently
  // dropped it from the shared history, so real personal-mode progress
  // never reached the partner after switching back to shared.
  if (personalLogin) {
    const altDest = mainContentDir(game.name)
    if (existsSync(altDest)) {
      const altHash = await folderHash(altDest, game.saveFilePattern)
      if (localHash === altHash) {
        const carriedVersion = explicitVersion ?? (await readRemoteVersion(game.name))
        await rm(dest, { recursive: true, force: true })
        await copyFiltered(game.savePath, dest, game.saveFilePattern)
        await writeRemoteMeta(game.name, carriedVersion, actor, personalLogin)
        await git(['add', '-A'])
        await git([
          ...identityFlags(actor),
          'commit',
          '-m',
          `sync-scope: ${game.name} now personal (${formatVersion(carriedVersion)}, no content change)`
        ])
        await git(['push', 'origin', 'main'])
        await setLocalVersion(appId, carriedVersion)
        return { version: carriedVersion, pushed: false }
      }
    }
  }

  // Replace the game folder's content in the repo with fresh local saves.
  await rm(dest, { recursive: true, force: true })
  await copyFiltered(game.savePath, dest, game.saveFilePattern)

  const newVersion =
    explicitVersion ??
    (await nextGameVersion(game.name, personalLogin ? await readRemoteVersion(game.name, personalLogin) : undefined))
  await writeRemoteMeta(game.name, newVersion, actor, personalLogin)
  // A personal push is never logged in the shared history — nobody else's
  // client even knows this game still exists (same reasoning as a personal
  // extra folder's uploadExtraFolder, right next to its own appendHistory).
  if (!personalLogin) {
    await appendHistory({
      appId,
      gameName: game.name,
      version: newVersion,
      updatedBy: actor,
      updatedAt: new Date().toISOString(),
      ...(restoredFrom !== undefined ? { restoredFrom } : {})
    })
  }

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

// --- Conflict snapshots ---
// When the cloud has moved ahead of what a local session was based on (see
// watcher.ts's pushGameSaves 'remote-newer' branch), pushing straight to
// main would silently overwrite whatever the other player just uploaded —
// so that push is skipped. But skipping it used to mean this session's
// progress just vanished with no way to get it back. Instead, we push it to
// its own side branch (conflict/<date>-<actor>-<game>-<random>) — never
// touches main's version counter or content, so it can never overwrite the
// other player's push, but the session is preserved and recoverable forever
// (see downloadConflictSnapshot).

function slugifyForRef(s: string): string {
  return s.trim().replace(/\s+/g, '-').replace(/[^A-Za-z0-9._-]/g, '') || 'x'
}

// A conflict snapshot's checkout/commit/push all happen in a throwaway `git
// worktree` — a second working directory attached to the SAME repo, entirely
// separate from repoDir()'s own checkout/HEAD. Every step below only ever
// touches this temp folder, so a crash or failure partway through can't
// corrupt the main clone the rest of sync.ts depends on (see ensureRepo's own
// doc comments on why that clone is treated as a fragile, disposable
// technical copy, never a source of truth).
async function withConflictWorktree<T>(ref: string, run: (dir: string) => Promise<T>): Promise<T> {
  const dir = join(app.getPath('temp'), `coopsync-conflict-${randomUUID()}`)
  await git(['worktree', 'add', '--detach', dir, ref])
  try {
    return await run(dir)
  } finally {
    try {
      await git(['worktree', 'remove', dir, '--force'])
    } catch {
      // Fall through to the raw folder delete below either way.
    }
    await rm(dir, { recursive: true, force: true })
  }
}

/** Preserve a local save that's about to be skipped instead of pushed (see
 *  the doc comment above) — pushes it to its own conflict branch. Returns the
 *  branch name, or null if there was no local save folder to preserve. */
export async function pushConflictSnapshot(
  token: string,
  owner: string,
  appId: string,
  actor: string
): Promise<string | null> {
  await ensureRepo(token, owner)
  const game = findGame(appId)
  if (!existsSync(game.savePath)) return null

  const branch = `conflict/${new Date().toISOString().slice(0, 10)}-${slugifyForRef(actor)}-${slugifyForRef(
    game.name
  )}-${randomUUID().slice(0, 6)}`

  await withConflictWorktree('origin/main', async (dir) => {
    await gitIn(dir, ['checkout', '-b', branch])
    const dest = join(dir, game.name, 'main')
    await rm(dest, { recursive: true, force: true })
    await copyFiltered(game.savePath, dest, game.saveFilePattern)
    await gitIn(dir, ['add', '-A'])
    await gitIn(dir, [
      ...identityFlags(actor),
      'commit',
      '-m',
      `conflict: ${game.name} local snapshot from ${actor}`
    ])
    await gitIn(dir, ['push', 'origin', branch])
  })

  return branch
}

/** Pull a preserved conflict snapshot back out to a plain folder on disk for
 *  the user to inspect/merge by hand — deliberately never overwrites the
 *  live save folder itself, so recovering a conflict can't cause a data-loss
 *  incident of its own. Returns the folder it wrote to. */
export async function downloadConflictSnapshot(
  token: string,
  owner: string,
  appId: string,
  branch: string
): Promise<string> {
  await ensureRepo(token, owner)
  const game = findGame(appId)
  await git(['fetch', 'origin', branch])

  const outDir = join(
    app.getPath('documents'),
    'CoopSync conflict backups',
    `${slugifyForRef(game.name)}-${slugifyForRef(branch.split('/').pop() ?? branch)}`
  )

  await withConflictWorktree(`origin/${branch}`, async (dir) => {
    const src = join(dir, game.name, 'main')
    await rm(outDir, { recursive: true, force: true })
    await mkdir(outDir, { recursive: true })
    if (existsSync(src)) await cp(src, outDir, { recursive: true })
  })

  return outDir
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

// Same idea as findCommitForVersion, one level down for an extra folder —
// but a LOOSER match: an extra folder only gets a new meta entry when its
// OWN content actually changed (see uploadExtraFolder's no-op shortcut), so
// it doesn't necessarily have an entry at the exact world version being
// reverted to. The latest entry at or BEFORE that version is the honest
// answer for "what did this folder look like at that point in time" — if
// nothing changed between v1 and v3, v1's snapshot IS what v2 and v3 looked
// like too. Returns null if the folder didn't exist yet at or before the
// target (nothing to restore, not an error).
async function findNearestCommitForVersion(metaRelPath: string, targetVersion: number): Promise<string | null> {
  const log = await git(['log', '--format=%H', '--', metaRelPath])
  const shas = log
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)
  for (const sha of shas) {
    try {
      const raw = await git(['show', `${sha}:${metaRelPath}`])
      const meta = JSON.parse(raw.replace(/^﻿/, '')) as RemoteMeta
      // git log is newest-first, so the FIRST entry at or below target is
      // the nearest one before/at it.
      if (meta.version <= targetVersion) return sha
    } catch {
      // Meta file didn't exist yet at this commit, or isn't parseable — skip it.
    }
  }
  return null
}

// Relative (git-command) path for an extra folder's meta file and content —
// mirrors extraFolderMetaPath/extraFolderContentDir, which return absolute
// filesystem paths (fine for fs calls, but git commands need paths relative
// to the repo root).
function extraFolderMetaRelPath(gameName: string, folder: CustomExtraFolder, actor: string): string {
  return folder.shared
    ? `.meta/folders/${gameName}/${folder.id}/shared.json`
    : `.meta/folders/${gameName}/${folder.id}/personal-${actor}.json`
}

function extraFolderContentRelPath(gameName: string, folder: CustomExtraFolder, actor: string): string {
  return folder.shared
    ? `${gameName}/extra/${folder.id}/shared`
    : `${gameName}/extra/${folder.id}/personal/${actor}`
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
  await git(['checkout', sha, '--', `${game.name}/main`])
  await clearFiltered(game.savePath, game.saveFilePattern)
  await copyFiltered(mainContentDir(game.name), game.savePath, game.saveFilePattern)
  await git(['checkout', 'HEAD', '--', `${game.name}/main`])

  const result = await uploadGame(token, owner, appId, actor, targetVersion)

  // Cascade the same revert to this game's own extra folders (both shared
  // and this user's personal ones — a partner's personal folder was never
  // materialized on this client at all, so listCustomGames() here can only
  // ever contain the ones actually relevant to whoever's calling this).
  // Each one restores to its OWN nearest state at-or-before targetVersion
  // (see findNearestCommitForVersion's doc comment for why "nearest", not
  // "exact") and re-uploads sharing result.version, so after a revert the
  // world and every folder that had anything to restore land on the exact
  // same number again — same reasoning as the world-save cascade in
  // watcher.ts, just triggered by a revert instead of a live save.
  const customGame = listCustomGames().find((g) => g.appId === appId)
  for (const folder of customGame?.extraFolders ?? []) {
    if (!folder.savePath) continue
    try {
      const metaRelPath = extraFolderMetaRelPath(game.name, folder, actor)
      const folderSha = await findNearestCommitForVersion(metaRelPath, targetVersion)
      if (!folderSha) continue // this folder didn't exist yet at/before that point — nothing to restore

      const contentRelPath = extraFolderContentRelPath(game.name, folder, actor)
      const pattern = buildExcludePattern(folder.excludedFiles)
      await git(['checkout', folderSha, '--', contentRelPath])
      await clearFiltered(folder.savePath, pattern)
      await copyFiltered(join(repoDir(), contentRelPath), folder.savePath, pattern)
      await git(['checkout', 'HEAD', '--', contentRelPath])

      await uploadExtraFolder(token, owner, appId, folder.id, actor, result.version)
    } catch {
      // Best-effort — one folder failing to restore shouldn't fail the
      // whole revert; the world itself already succeeded above regardless.
    }
  }

  return result
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

interface RemoteFolderEntry {
  id: string
  label: string
  /** GitHub login of whoever added this folder — see CustomExtraFolder.addedBy. */
  addedBy?: string
}

interface RemoteCustomGameEntry {
  appId: string
  name: string
  /** Extra shared folders registered on top of this game's main one (see
   *  the "Extra save folders" section below) — a personal folder is never
   *  listed here (see CustomExtraFolder's doc comment). */
  folders?: RemoteFolderEntry[]
}

function customGamesRegistryPath(): string {
  return join(repoDir(), '.meta', 'custom-games.json')
}

// null specifically means "couldn't tell" (the file exists but failed to
// read/parse — a corrupt or mid-write local clone, e.g. a previous run got
// killed mid git-operation) — NOT "the registry is genuinely empty". This
// distinction matters a lot: every writer below reads the current list
// before modifying it, and the self-heal pass in getSyncStatuses treats a
// game/folder that's locally known but absent from this list as "someone
// removed it on purpose" and deletes the local copy to match. Collapsing a
// read failure into an empty array would make that self-heal logic
// misread "I couldn't check" as "everything was deleted" and wipe every
// locally-known custom game/folder — a real data-loss bug, not hypothetical
// (this is exactly what happened once, see project notes). An absent FILE
// (never existed) is the one case that's unambiguous, so that alone still
// returns [].
async function readCustomGamesRegistry(): Promise<RemoteCustomGameEntry[] | null> {
  const p = customGamesRegistryPath()
  if (!existsSync(p)) return []
  try {
    const raw = (await readFile(p, 'utf8')).replace(/^﻿/, '')
    return JSON.parse(raw) as RemoteCustomGameEntry[]
  } catch {
    return null
  }
}

// pushCustomGameToRegistry / deleteCustomGameContent / pushCustomGameCover
// are each called both directly (ipc.ts, right after a local add/remove/cover
// change) AND from inside getSyncStatuses's own registry-sync/cover-adopt
// passes (self-healing a previous failure, or reacting to a partner's
// change) -- two of those landing close together, from a direct call and a
// concurrent background check, would otherwise run fully independent
// read-modify-commit-push sequences against the very same local clone and
// can genuinely corrupt each other's commit, not just redundantly repeat
// work. Serializing all three against each other here is what makes every
// caller's use of them safe without each one needing its own locking.

let customGameRepoLock: Promise<unknown> = Promise.resolve()

function withCustomGameRepoLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = customGameRepoLock.then(fn, fn)
  customGameRepoLock = run.then(
    () => undefined,
    () => undefined
  )
  return run
}

/** Add a just-added custom game to the shared registry, so a co-op partner's
 *  app can see it exists (best-effort — called right after the local add
 *  succeeds, see ipc.ts's games:add-custom). */
export function pushCustomGameToRegistry(
  token: string,
  owner: string,
  actor: string,
  appId: string,
  name: string
): Promise<void> {
  return withCustomGameRepoLock(async () => {
    await ensureRepo(token, owner)
    const current = await readCustomGamesRegistry()
    if (current === null) throw makeAppError('GIT_GENERIC', { detail: 'registry unreadable' })
    if (current.some((e) => e.appId === appId)) return
    await mkdir(join(repoDir(), '.meta'), { recursive: true })
    await writeFile(customGamesRegistryPath(), JSON.stringify([...current, { appId, name }], null, 2))
    await git(['add', '-A'])
    await git([...identityFlags(actor), 'commit', '-m', `custom-game: add ${name}`])
    await git(['push', 'origin', 'main'])
  })
}

/** Rename a custom game — updates the registry entry, and moves its save
 *  folder + version-meta file in the shared repo to match (both are keyed by
 *  name, not appId — a registry-only rename would silently orphan this
 *  game's existing history/version tracking). Best-effort, same as the other
 *  registry writers (see ipc.ts's games:rename-custom). No-op if appId isn't
 *  registered yet, or the name is unchanged. */
export function renameCustomGameInRegistry(
  token: string,
  owner: string,
  actor: string,
  appId: string,
  newName: string
): Promise<void> {
  return withCustomGameRepoLock(async () => {
    await ensureRepo(token, owner)
    const current = await readCustomGamesRegistry()
    if (current === null) throw makeAppError('GIT_GENERIC', { detail: 'registry unreadable' })
    const entry = current.find((e) => e.appId === appId)
    if (!entry || entry.name === newName) return
    const oldName = entry.name
    const next = current.map((e) => (e.appId === appId ? { ...e, name: newName } : e))
    await mkdir(join(repoDir(), '.meta'), { recursive: true })
    await writeFile(customGamesRegistryPath(), JSON.stringify(next, null, 2))
    if (existsSync(join(repoDir(), oldName))) {
      await git(['mv', oldName, newName])
    }
    if (existsSync(remoteMetaPath(oldName))) {
      await git(['mv', `.meta/${oldName}.json`, `.meta/${newName}.json`])
    }
    await git(['add', '-A'])
    await git([...identityFlags(actor), 'commit', '-m', `custom-game: rename ${oldName} -> ${newName}`])
    await git(['push', 'origin', 'main'])
  })
}

/** Remove a custom game for good — its registry entry, main+extra save
 *  content, version meta, cover, and its own history.json entries, all in
 *  one commit+push (see ipc.ts's games:remove-custom). Used to only touch
 *  the registry (with the cover/history dropped separately, best-effort) —
 *  the actual save content and version history stayed in the repo forever,
 *  quietly eating GitHub storage with no way to reclaim it. Same bug and
 *  same fix as deleteExtraFolderContent above; a whole game is just the
 *  bigger version of it. --ignore-unmatch/--allow-empty: a game that was
 *  added locally but never actually confirmed registered still needs a
 *  clean commit even though there's nothing real on the remote side to
 *  remove. Never touches anyone's OWN copy of this game — a partner keeps
 *  playing on their own files; getSyncStatuses' self-heal is what notices
 *  the registry entry vanished and reacts on their side. */
export function deleteCustomGameContent(
  token: string,
  owner: string,
  actor: string,
  appId: string,
  // The registry only ever knows a game's name if it was actually shared —
  // for one that was added but never confirmed registered, there'd be
  // nothing to fall back to here (the local record is already gone by the
  // time this runs — ipc.ts's games:remove-custom removes it from
  // settings.json before this call). The caller reads it while it's still
  // there and passes it through instead.
  knownGameName?: string
): Promise<void> {
  return withCustomGameRepoLock(async () => {
    await ensureRepo(token, owner)
    const current = await readCustomGamesRegistry()
    if (current === null) throw makeAppError('GIT_GENERIC', { detail: 'registry unreadable' })
    const entry = current.find((e) => e.appId === appId)
    const next = current.filter((e) => e.appId !== appId)
    if (next.length !== current.length) {
      await mkdir(join(repoDir(), '.meta'), { recursive: true })
      await writeFile(customGamesRegistryPath(), JSON.stringify(next, null, 2))
    }

    const history = await readHistory()
    const nextHistory = history.filter((e) => e.appId !== appId)
    if (nextHistory.length !== history.length) {
      await mkdir(join(repoDir(), '.meta'), { recursive: true })
      await writeFile(historyPath(), JSON.stringify(nextHistory, null, 2))
    }

    const gameName = entry?.name ?? knownGameName
    if (gameName) {
      // Whole <gameName>/ subtree — main content AND any extra folders live
      // under it (mainContentDir/extraFolderContentDir), so this one rm
      // covers both without walking the folder list separately.
      await git(['rm', '-r', '--ignore-unmatch', gameName])
      await git(['rm', '-r', '--ignore-unmatch', join('.meta', `${gameName}.json`)])
      await git(['rm', '-r', '--ignore-unmatch', join('.meta', 'folders', gameName)])
    }
    await git(['rm', '-r', '--ignore-unmatch', join('.meta', 'covers', `${appId.replace(/:/g, '_')}.txt`)])

    await git(['add', '-A'])
    await git([
      ...identityFlags(actor),
      'commit',
      '--allow-empty',
      '-m',
      `custom-game: delete ${gameName ?? appId}`
    ])
    await git(['push', 'origin', 'main'])
  })
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
export function pushCustomGameCover(
  token: string,
  owner: string,
  actor: string,
  appId: string,
  dataUrl: string | null
): Promise<void> {
  return withCustomGameRepoLock(async () => {
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
  })
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

// --- Extra save folders (CustomGame.extraFolders) ---
// A second (or third...) independently-synced folder on a custom game, on
// top of its main one (game.savePath, handled entirely by the functions
// above, untouched by any of this) — see CustomExtraFolder's doc comment in
// shared/types.ts for the shared/personal split this section implements.
//
// Repo layout — nested under the game's own top-level folder, alongside its
// main save (see mainContentDir near repoDir()), for a tidy repo (one folder
// per game, everything about it inside) instead of a flat pile of unrelated
// top-level entries:
//   shared:   <gameName>/extra/<folderId>/shared/...
//             .meta/folders/<gameName>/<folderId>/shared.json
//   personal: <gameName>/extra/<folderId>/personal/<login>/...
//             .meta/folders/<gameName>/<folderId>/personal-<login>.json
// `actor` is always the right login for a personal folder's path: a
// personal folder is never pushed to the registry below, so it only ever
// exists in the extraFolders of whoever added it — nobody else's client
// ever computes a path for it.
//
// **Real bug found 2026-07-26**: an EARLIER version of this put a folder's
// content at `<gameName>/_folders/<folderId>/...` too, and that caused a
// genuine feedback loop — uploadGame's `rm(dest, {recursive:true})` used
// `dest = <gameName>/` (the WHOLE game folder) back then, so every
// main-folder push wiped out any extra folder living inside it, and
// folderHash(dest) for the main folder's own status check walked that same
// subtree, so every EXTRA folder push made the main folder look "newer" too
// and trigger a pointless real push (which then wiped the extra folder right
// back out). The actual fix isn't "never nest" — it's that `dest` for the
// main folder is now mainContentDir() = `<gameName>/main/`, a specific leaf
// subdirectory, never the shared `<gameName>/` parent — so rm/copyFiltered/
// folderHash for EITHER the main folder or an extra folder only ever touches
// its own leaf subtree, no matter how many folders share the same
// `<gameName>/` parent above them.

function findExtraFolder(appId: string, folderId: string): { game: CustomGame; folder: CustomExtraFolder } {
  const game = listCustomGames().find((g) => g.appId === appId)
  const folder = game?.extraFolders?.find((f) => f.id === folderId)
  if (!game || !folder) throw makeAppError('GAME_NOT_SUPPORTED')
  return { game, folder }
}

function extraFolderContentDir(gameName: string, folder: CustomExtraFolder, actor: string): string {
  const base = join(repoDir(), gameName, 'extra', folder.id)
  return folder.shared ? join(base, 'shared') : join(base, 'personal', actor)
}

function extraFolderMetaDir(gameName: string, folderId: string): string {
  return join(repoDir(), '.meta', 'folders', gameName, folderId)
}

function extraFolderMetaPath(gameName: string, folder: CustomExtraFolder, actor: string): string {
  return folder.shared
    ? join(extraFolderMetaDir(gameName, folder.id), 'shared.json')
    : join(extraFolderMetaDir(gameName, folder.id), `personal-${actor}.json`)
}

export async function readExtraFolderMeta(
  gameName: string,
  folder: CustomExtraFolder,
  actor: string
): Promise<RemoteMeta | null> {
  const p = extraFolderMetaPath(gameName, folder, actor)
  if (!existsSync(p)) return null
  try {
    const raw = (await readFile(p, 'utf8')).replace(/^﻿/, '')
    return JSON.parse(raw) as RemoteMeta
  } catch {
    return null
  }
}

async function writeExtraFolderMeta(
  gameName: string,
  folder: CustomExtraFolder,
  actor: string,
  version: number,
  owner: string
): Promise<void> {
  await mkdir(extraFolderMetaDir(gameName, folder.id), { recursive: true })
  const meta = { version, updatedAt: new Date().toISOString(), updatedBy: owner }
  await writeFile(extraFolderMetaPath(gameName, folder, actor), JSON.stringify(meta, null, 2))
}

// Local version tracking reuses the same flat coopsync-versions.json as the
// main folder (readLocalVersions/setLocalVersion) — just under a composite
// "appId:folderId" key instead of appId alone, so both live in the same file
// with no risk of collision (a bare appId never contains this folder's uuid).
function folderVersionKey(appId: string, folderId: string): string {
  return `${appId}:${folderId}`
}

/** Upload an extra folder's saves to GitHub (push). Mirrors uploadGame one
 *  level down — see this section's own layout comment for where a shared vs
 *  a personal folder's content actually lands. `explicitVersion` — see
 *  uploadGame's own doc comment, same reasoning (shared per-game counter,
 *  each push still claims its own unique number). */
export async function uploadExtraFolder(
  token: string,
  owner: string,
  appId: string,
  folderId: string,
  actor: string,
  explicitVersion?: number
): Promise<SyncResult> {
  await ensureRepo(token, owner)
  const { game, folder } = findExtraFolder(appId, folderId)
  if (!folder.savePath || !existsSync(folder.savePath)) throw makeAppError('SAVE_FOLDER_NOT_FOUND')

  const pattern = buildExcludePattern(folder.excludedFiles)
  const dest = extraFolderContentDir(game.name, folder, actor)
  const localHash = await folderHash(folder.savePath, pattern)

  if (existsSync(dest)) {
    const remoteHash = await folderHash(dest, pattern)
    if (localHash === remoteHash) {
      const remoteVersion = (await readExtraFolderMeta(game.name, folder, actor))?.version ?? 0
      await setLocalVersion(folderVersionKey(appId, folderId), remoteVersion)
      return { version: remoteVersion, pushed: false }
    }
  }

  // Mirrors uploadGame's own altDest check (see its doc comment) — only for
  // the shared->personal direction. Going personal->shared with a genuine
  // mismatch against the shared folder means real progress happened while
  // personal, and this is the first time the co-op partner's client will
  // ever see it — that must stay a real, history-logged push, not get
  // silently treated as "just a scope move" because the bytes happen to
  // match the personal folder's own copy.
  if (!folder.shared) {
    const altFolder: CustomExtraFolder = { ...folder, shared: true }
    const altDest = extraFolderContentDir(game.name, altFolder, actor)
    if (existsSync(altDest)) {
      const altHash = await folderHash(altDest, pattern)
      if (localHash === altHash) {
        const carriedVersion =
          explicitVersion ?? ((await readExtraFolderMeta(game.name, altFolder, actor))?.version ?? 0)
        await rm(dest, { recursive: true, force: true })
        await copyFiltered(folder.savePath, dest, pattern)
        await writeExtraFolderMeta(game.name, folder, actor, carriedVersion, actor)
        await git(['add', '-A'])
        await git([
          ...identityFlags(actor),
          'commit',
          '-m',
          `sync-scope: ${game.name} / ${folder.label} now personal (${formatVersion(carriedVersion)}, no content change)`
        ])
        await git(['push', 'origin', 'main'])
        await setLocalVersion(folderVersionKey(appId, folderId), carriedVersion)
        return { version: carriedVersion, pushed: false }
      }
    }
  }

  await rm(dest, { recursive: true, force: true })
  await copyFiltered(folder.savePath, dest, pattern)

  const newVersion =
    explicitVersion ??
    (await nextGameVersion(
      game.name,
      !folder.shared ? (await readExtraFolderMeta(game.name, folder, actor))?.version : undefined
    ))
  await writeExtraFolderMeta(game.name, folder, actor, newVersion, actor)
  // Shared folder pushes join the same shared history log the main folder
  // already uses — a partner sees them the same way. A personal folder's
  // push is never logged there (or anywhere shared) — see this section's own
  // top comment: nobody else's client ever even learns it exists.
  if (folder.shared) {
    await appendHistory({
      appId,
      gameName: `${game.name} / ${folder.label}`,
      version: newVersion,
      updatedBy: actor,
      updatedAt: new Date().toISOString()
    })
  }

  await git(['add', '-A'])
  await git([
    ...identityFlags(actor),
    'commit',
    '-m',
    `sync: ${game.name} / ${folder.label} ${formatVersion(newVersion)} (${actor})`
  ])
  await git(['push', 'origin', 'main'])
  await setLocalVersion(folderVersionKey(appId, folderId), newVersion)
  return { version: newVersion, pushed: true }
}

/** Download an extra folder's saves from GitHub into its local folder (pull). */
export async function downloadExtraFolder(
  token: string,
  owner: string,
  appId: string,
  folderId: string,
  actor: string
): Promise<SyncResult> {
  await ensureRepo(token, owner)
  const { game, folder } = findExtraFolder(appId, folderId)
  if (!folder.savePath) throw makeAppError('SAVE_FOLDER_NOT_FOUND')

  const pattern = buildExcludePattern(folder.excludedFiles)
  const src = extraFolderContentDir(game.name, folder, actor)
  if (!existsSync(src)) throw makeAppError('NO_CLOUD_SAVES')

  await mkdir(folder.savePath, { recursive: true })
  await copyFiltered(src, folder.savePath, pattern)

  const remoteVersion = (await readExtraFolderMeta(game.name, folder, actor))?.version ?? 0
  await setLocalVersion(folderVersionKey(appId, folderId), remoteVersion)
  return { version: remoteVersion }
}

/** Same as restoreMissingFiles, one level down — files missing locally are
 *  copied in without touching what's already there, never overwriting. */
export async function restoreExtraFolderMissingFiles(
  token: string,
  owner: string,
  appId: string,
  folderId: string,
  actor: string
): Promise<number> {
  await ensureRepo(token, owner)
  const { game, folder } = findExtraFolder(appId, folderId)
  if (!folder.savePath) return 0
  const pattern = buildExcludePattern(folder.excludedFiles)
  const repoPath = extraFolderContentDir(game.name, folder, actor)
  if (!existsSync(repoPath)) return 0

  let restored = 0
  async function walk(remoteDir: string, localDir: string): Promise<void> {
    const entries = await readdir(remoteDir, { withFileTypes: true })
    for (const e of entries) {
      if (e.name === '.git') continue
      if (pattern && !e.isDirectory() && !pattern.test(e.name)) continue
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
  await walk(repoPath, folder.savePath)
  return restored
}

/** Add a just-added SHARED extra folder to the shared registry, nested under
 *  its game's existing entry, so a co-op partner's app can see it exists
 *  (best-effort, same pattern as pushCustomGameToRegistry — see ipc.ts's
 *  games:add-extra-folder). A no-op (silently) if the game itself isn't
 *  registered yet — the game-level self-heal in getSyncStatuses will push
 *  this folder once it is, the same way it retries the game itself. */
/** Labels of a custom game's currently-registered SHARED extra folders —
 *  used only to check for a name collision before adding a new one (see
 *  ipc.ts's games:add-extra-folder). A personal folder is never in the
 *  registry, so this can't catch a collision with one of those — by design,
 *  nobody else's client ever knows a personal folder's name to collide with. */
export async function getRegisteredFolderLabels(
  token: string,
  owner: string,
  appId: string
): Promise<string[]> {
  await ensureRepo(token, owner)
  const registry = await readCustomGamesRegistry()
  // null (unreadable registry) just means we can't check — non-destructive
  // either way, so fail open (no collision detected) rather than blocking
  // the add over a transient read glitch.
  return (registry?.find((e) => e.appId === appId)?.folders ?? []).map((f) => f.label)
}

export function pushFolderToRegistry(
  token: string,
  owner: string,
  actor: string,
  appId: string,
  folderId: string,
  label: string,
  addedBy: string
): Promise<void> {
  return withCustomGameRepoLock(async () => {
    await ensureRepo(token, owner)
    const current = await readCustomGamesRegistry()
    if (current === null) throw makeAppError('GIT_GENERIC', { detail: 'registry unreadable' })
    const idx = current.findIndex((e) => e.appId === appId)
    if (idx === -1) return
    const entry = current[idx]
    if ((entry.folders ?? []).some((f) => f.id === folderId)) return
    const next = [...current]
    next[idx] = { ...entry, folders: [...(entry.folders ?? []), { id: folderId, label, addedBy }] }
    await mkdir(join(repoDir(), '.meta'), { recursive: true })
    await writeFile(customGamesRegistryPath(), JSON.stringify(next, null, 2))
    await git(['add', '-A'])
    await git([...identityFlags(actor), 'commit', '-m', `custom-game-folder: add ${entry.name} / ${label}`])
    await git(['push', 'origin', 'main'])
  })
}

/** Remove an extra folder for good — both its registry entry (if it was
 *  ever shared; a personal folder never had one) AND its actual synced
 *  content + version meta in the repo (see ipc.ts's games:remove-extra-folder).
 *  Used to only touch the registry, leaving the real files behind forever —
 *  a real complaint (2026-07-28): a "removed" folder kept occupying space on
 *  GitHub with no way to reclaim it. --ignore-unmatch makes the git rm calls
 *  a no-op for a folder that was added but never actually pushed, instead of
 *  failing the whole removal over nothing to delete. --allow-empty on the
 *  commit covers that same case when there's also no registry entry to
 *  touch (a personal folder that was never synced at all) — still leaves a
 *  log entry of the deletion rather than silently doing nothing. */
export function deleteExtraFolderContent(
  token: string,
  owner: string,
  actor: string,
  appId: string,
  folderId: string
): Promise<void> {
  return withCustomGameRepoLock(async () => {
    await ensureRepo(token, owner)
    const current = await readCustomGamesRegistry()
    if (current === null) throw makeAppError('GIT_GENERIC', { detail: 'registry unreadable' })
    const idx = current.findIndex((e) => e.appId === appId)
    const gameName = idx !== -1 ? current[idx].name : listCustomGames().find((g) => g.appId === appId)?.name
    if (!gameName) return // game itself is already gone — nothing left to clean up
    let label = folderId
    if (idx !== -1) {
      const entry = current[idx]
      const folders = entry.folders ?? []
      const nextFolders = folders.filter((f) => f.id !== folderId)
      if (nextFolders.length !== folders.length) {
        label = folders.find((f) => f.id === folderId)?.label ?? folderId
        const next = [...current]
        next[idx] = { ...entry, folders: nextFolders }
        await mkdir(join(repoDir(), '.meta'), { recursive: true })
        await writeFile(customGamesRegistryPath(), JSON.stringify(next, null, 2))
      }
    }
    await git(['rm', '-r', '--ignore-unmatch', join(gameName, 'extra', folderId)])
    await git(['rm', '-r', '--ignore-unmatch', join('.meta', 'folders', gameName, folderId)])
    await git(['add', '-A'])
    await git([
      ...identityFlags(actor),
      'commit',
      '--allow-empty',
      '-m',
      `custom-game-folder: delete ${gameName} / ${label}`
    ])
    await git(['push', 'origin', 'main'])
  })
}

/** Unregister an extra folder WITHOUT touching its synced content — used
 *  only by games:set-extra-folder-shared's shared→personal flip (the
 *  content keeps syncing personally, it just stops being visible to
 *  everyone else; deleting it here would destroy the owner's own backup
 *  over a visibility change, not a removal). Actual deletion is
 *  deleteExtraFolderContent above. */
export function removeFolderFromRegistry(
  token: string,
  owner: string,
  actor: string,
  appId: string,
  folderId: string
): Promise<void> {
  return withCustomGameRepoLock(async () => {
    await ensureRepo(token, owner)
    const current = await readCustomGamesRegistry()
    if (current === null) throw makeAppError('GIT_GENERIC', { detail: 'registry unreadable' })
    const idx = current.findIndex((e) => e.appId === appId)
    if (idx === -1) return
    const entry = current[idx]
    const folders = entry.folders ?? []
    const nextFolders = folders.filter((f) => f.id !== folderId)
    if (nextFolders.length === folders.length) return
    const next = [...current]
    next[idx] = { ...entry, folders: nextFolders }
    await mkdir(join(repoDir(), '.meta'), { recursive: true })
    await writeFile(customGamesRegistryPath(), JSON.stringify(next, null, 2))
    await git(['add', '-A'])
    const label = folders.find((f) => f.id === folderId)?.label ?? folderId
    await git([...identityFlags(actor), 'commit', '-m', `custom-game-folder: unshare ${entry.name} / ${label}`])
    await git(['push', 'origin', 'main'])
  })
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
export async function restoreMissingFiles(
  token: string,
  owner: string,
  appId: string,
  actor: string
): Promise<number> {
  await ensureRepo(token, owner)
  const game = findGame(appId)
  const repoPath = mainContentDir(game.name, personalLoginFor(appId, actor))
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
export async function downloadGame(
  token: string,
  owner: string,
  appId: string,
  actor: string
): Promise<SyncResult> {
  await ensureRepo(token, owner)
  const game = findGame(appId)
  const personalLogin = personalLoginFor(appId, actor)

  const src = mainContentDir(game.name, personalLogin)
  if (!existsSync(src)) throw makeAppError('NO_CLOUD_SAVES')

  await mkdir(game.savePath, { recursive: true })
  await copyFiltered(src, game.savePath, game.saveFilePattern)

  // Local version now equals the cloud version.
  const remoteVersion = await readRemoteVersion(game.name, personalLogin)
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
export async function folderHash(dir: string, pattern?: RegExp): Promise<string> {
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

// Cheap, content-free signature of a game's local save folder — file names +
// sizes + mtimes, no reads. Unlike folderHash (which hashes every file's
// actual bytes), this costs one stat() per file, so it's affordable to call
// on every watcher tick (every 5s, for every running game) to notice "did
// anything change" — folderHash's real cost is fine for the occasional
// status check, not for continuous polling while a game is running.
async function folderFingerprint(dir: string, pattern?: RegExp): Promise<string | null> {
  if (!existsSync(dir)) return null
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
        const st = statSync(full)
        parts.push(`${r}:${st.size}:${st.mtimeMs}`)
      }
    }
  }
  await walk(dir, '')
  return parts.join('\n')
}

export async function localSaveFingerprint(appId: string): Promise<string | null> {
  const { savePath, saveFilePattern } = findGame(appId)
  return folderFingerprint(savePath, saveFilePattern)
}

/** Same as localSaveFingerprint, one level down for an extra folder. */
export async function localExtraFolderFingerprint(appId: string, folderId: string): Promise<string | null> {
  const { folder } = findExtraFolder(appId, folderId)
  if (!folder.savePath) return null
  return folderFingerprint(folder.savePath, buildExcludePattern(folder.excludedFiles))
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

// Called from several independent places close together (an on-demand
// renderer refresh, the ~2min background check, a game launch/exit) — each
// one, past the shared ensureRepo() pull above, goes on to do its OWN
// separate registry read + materialize + self-heal/removal pushes + cover
// adopt, all against the same local clone. Two of those running at once can
// genuinely race each other's git commits, not just redundantly repeat work
// — serialize the whole thing the same way ensureRepo already serializes
// the pull it opens with.
let getSyncStatusesInFlight: Promise<GameSyncStatus[]> | null = null

/** Sync status for all supported games (a single pull covers all of them). */
export async function getSyncStatuses(
  token: string,
  owner: string,
  actor: string
): Promise<GameSyncStatus[]> {
  if (!getSyncStatusesInFlight) {
    getSyncStatusesInFlight = doGetSyncStatuses(token, owner, actor).finally(() => {
      getSyncStatusesInFlight = null
    })
  }
  return getSyncStatusesInFlight
}

async function doGetSyncStatuses(token: string, owner: string, actor: string): Promise<GameSyncStatus[]> {
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
  // game locally is never blocked by it), and mirror ANYONE removing a game
  // — games:remove-custom only ever drops the registry entry, never touches
  // an already-materialized local copy elsewhere, so removal has to be
  // noticed here instead, the same way an add is.
  //
  // Getting "missing from the registry" right needs more than "do I own
  // this" (a first version of this used receivedFromPartner for that, but
  // ANYONE can remove ANY custom game, not just its original adder) — from
  // the ORIGINAL adder's own client, their game being deleted by someone
  // else and their own initial push having simply failed look identical:
  // "an appId I have locally that the registry doesn't". Telling those
  // apart needs to know whether this appId was EVER actually seen
  // registered before. registryConfirmed tracks exactly that (see its own
  // doc comment) — only an appId that's never been confirmed gets pushed
  // again; one that has, and is now gone, means somebody removed it on
  // purpose, and every client (owner or not) should just drop it locally.
  try {
    const registry = await readCustomGamesRegistry()
    // null = couldn't actually read the registry (see readCustomGamesRegistry's
    // own doc comment) — must NOT fall through to the reconciliation below,
    // which would misread "couldn't check" as "registry is empty" and delete
    // every locally-known custom game/folder as if someone removed them all
    // on purpose. Throwing (not returning) routes this into the catch right
    // below, same "try again next time" handling as any other failure here —
    // a bare return would exit doGetSyncStatuses entirely and skip building
    // the actual status list further down.
    if (registry === null) throw new Error('registry unreadable')
    const registered = new Set(registry.map((e) => e.appId))
    const registeredNames = new Map(registry.map((e) => [e.appId, e.name]))
    // A removal we're still actively pushing (see the pending-removals retry
    // below) means the registry can be stale — it may still list an appId we
    // already dropped locally on purpose. Without this, materializing it
    // right back the moment it's seen would resurrect a game the user just
    // deleted, on every single check, for as long as the removal push keeps
    // failing to land.
    const pendingRemovals = new Set(getPendingCustomGameRemovals())
    for (const entry of registry) {
      if (pendingRemovals.has(entry.appId)) continue
      materializeRemoteCustomGame(entry.appId, entry.name)
    }
    for (const g of listCustomGames()) {
      // Orphaned (awaiting the user's own Restore decision) or personal
      // (restored, or deliberately switched via the game's own sync-scope
      // toggle) — either way this game has opted out of the shared registry
      // until the user acts again via the UI. Must never re-push it or
      // re-flag it as newly orphaned.
      if (g.orphaned || isGamePersonal(g.appId)) continue
      if (registered.has(g.appId)) {
        if (!g.registryConfirmed) markCustomGameRegistryConfirmed(g.appId)
        // Someone renamed it (owner or not, same as a removal) — mirror the
        // new name locally. Safe even mid-rename: the registry write lands
        // before the folder/meta git-mv (renameCustomGameInRegistry), so at
        // worst this picks up the new name a tick before the renamed folder
        // is visible, which self-corrects next check either way.
        const registeredName = registeredNames.get(g.appId)
        if (registeredName && registeredName !== g.name) setCustomGameName(g.appId, registeredName)

        // Reconcile this game's extra SHARED folders the exact same
        // converge-don't-fight way, one level down — a personal folder is
        // never in this registry entry at all (see CustomExtraFolder's doc
        // comment), so it never appears on either side of this comparison.
        const entry = registry.find((e) => e.appId === g.appId)
        const remoteFolders = entry?.folders ?? []
        const remoteFolderIds = new Set(remoteFolders.map((f) => f.id))
        const pendingFolderRemovals = new Set(getPendingFolderRemovals())
        for (const rf of remoteFolders) {
          if (pendingFolderRemovals.has(`${g.appId}:${rf.id}`)) continue
          materializeRemoteExtraFolder(g.appId, rf.id, rf.label, rf.addedBy)
        }
        for (const f of g.extraFolders ?? []) {
          if (!f.shared || f.orphaned) continue
          if (remoteFolderIds.has(f.id)) {
            if (!f.registryConfirmed) markExtraFolderRegistryConfirmed(g.appId, f.id)
            const rLabel = remoteFolders.find((rf) => rf.id === f.id)?.label
            if (rLabel && rLabel !== f.label) setExtraFolderLabel(g.appId, f.id, rLabel)
            continue
          }
          if (f.registryConfirmed) {
            markExtraFolderOrphaned(g.appId, f.id)
            addNotification('folder-removed', { game: g.name, folder: f.label, appId: g.appId, folderId: f.id })
            continue
          }
          try {
            // Folders that predate the addedBy field fall back to actor —
            // it's this exact device pushing it for the first time, the
            // closest thing to a real answer for "who added this".
            await pushFolderToRegistry(token, owner, actor, g.appId, f.id, f.label, f.addedBy ?? actor)
          } catch {
            // Try again next check.
          }
        }
        continue
      }
      if (g.registryConfirmed) {
        // Was registered before, isn't now -- somebody removed it on
        // purpose (whether or not it was "ours"). Converge, don't fight it —
        // but "converge" now means going orphaned, not silently deleting the
        // local copy (see CustomGame.orphaned's doc comment): the game-removed
        // notification's Restore action is how the user takes it from here.
        markCustomGameOrphaned(g.appId)
        addNotification('game-removed', { game: g.name, appId: g.appId })
        continue
      }
      // Never confirmed registered yet -- this is a fresh local add whose
      // initial push may have failed. Push it again.
      try {
        await pushCustomGameToRegistry(token, owner, actor, g.appId, g.name)
      } catch {
        // Try again next check — same reasoning as the outer catch below.
      }
    }
  } catch {
    // See above — try again next time getSyncStatuses runs.
  }

  // Retry a custom game's content-deletion push that failed when it was
  // removed locally (games:remove-custom) — nothing local still references
  // that appId (or its name) to fall back on, so this list (not the
  // registry-sync pass above) is what remembers it still needs to happen.
  // No knownGameName here: if the registry itself never had this game
  // either (never confirmed registered before the removal), its content
  // can't be located anymore — same rare edge case deleteCustomGameContent's
  // own doc comment already covers.
  for (const appId of getPendingCustomGameRemovals()) {
    try {
      await deleteCustomGameContent(token, owner, actor, appId)
      clearPendingCustomGameRemoval(appId)
    } catch {
      // Try again next check.
    }
  }

  // Same retry, one level down, for an extra folder's registry-removal push
  // (games:remove-extra-folder) — the composite key's LAST ':' is always the
  // appId/folderId boundary: a custom game's appId is itself "custom:<uuid>"
  // (so it already contains a ':'), but folderId (also a uuid) never does.
  for (const key of getPendingFolderRemovals()) {
    const sep = key.lastIndexOf(':')
    const appId = key.slice(0, sep)
    const folderId = key.slice(sep + 1)
    try {
      await deleteExtraFolderContent(token, owner, actor, appId, folderId)
      clearPendingFolderRemoval(appId, folderId)
    } catch {
      // Try again next check.
    }
  }

  // Keep a custom game's cover mirroring the shared one — per this file's
  // own "shared, not per-machine, like its name" comment above coverPath(),
  // there's no such thing as an intentional LOCAL cover choice to protect
  // once someone else changes it; the shared file is the single source of
  // truth either way. Used to only ever adopt once (skipped entirely the
  // moment g.coverDataUrl was set at all) — meaning the very first cover a
  // partner ever saw synced fine, but any later change to it never did,
  // forever, since that guard was already permanently tripped. Comparing
  // content instead converges on every check, and is a no-op once already
  // in sync (including right after our OWN push, once it lands here too).
  try {
    for (const g of listCustomGames()) {
      const remoteCover = await readRemoteCover(g.appId)
      if (remoteCover && remoteCover !== g.coverDataUrl) setCustomGameCover(g.appId, remoteCover)
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

    // Orphaned — someone else removed this game from the shared group (see
    // CustomGame.orphaned). Its old shared path may well still exist locally
    // from before, but comparing against it would be meaningless (nothing
    // pushes there anymore) — show a distinct status instead until the user
    // resolves it via the game-removed notification's Restore action.
    if (isCustomGameId(g.appId) && listCustomGames().find((x) => x.appId === g.appId)?.orphaned) {
      result.push({ appId: g.appId, status: 'orphaned', localVersion: 0, remoteVersion: 0 })
      continue
    }

    const personalLogin = personalLoginFor(g.appId, actor)
    const repoPath = mainContentDir(g.name, personalLogin)
    const localExists = existsSync(savePath)
    const remoteExists = existsSync(repoPath)

    const localVer = localVersions[g.appId] ?? 0
    const remoteMeta = await readRemoteMeta(g.name, personalLogin)
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
      // 'local-stale' (content differs, but no local file's mtime is newer
      // than the last known cloud sync — e.g. an old backup was restored
      // while nobody was watching) used to be a separate status here, and
      // used to block auto-push. It no longer does (see watcher.ts's
      // pushGameSaves/pushFolderSaves) — everywhere it could actually get
      // acted on is preceded by this exact folder being continuously
      // watched, so "swapped in unwatched" structurally can't apply there.
      // Keeping it as a SEPARATE status here just showed a confusing
      // "outdated" label moments before a real, successful push — so
      // hash-differs now always reads as 'local-newer', full stop. (The
      // 'local-stale' SyncStatus value/UI strings are left in place,
      // unused, rather than ripped out — no functional difference either way.)
      status = localHash === remoteHash ? 'synced' : 'local-newer'
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

  // Extra folders (custom games only) — attached onto each game's own entry
  // above, computed the same way one level down. A catalog game, or a custom
  // game with none added, just keeps extraFolders unset.
  for (const cg of listCustomGames()) {
    const folders = cg.extraFolders ?? []
    if (folders.length === 0) continue
    const gameEntry = result.find((r) => r.appId === cg.appId)
    if (!gameEntry) continue

    const folderStatuses: FolderSyncStatus[] = []
    for (const f of folders) {
      if (!f.savePath) {
        folderStatuses.push({
          folderId: f.id,
          label: f.label,
          shared: f.shared,
          status: 'needs-setup',
          localVersion: 0,
          remoteVersion: 0
        })
        continue
      }

      // Orphaned — see CustomExtraFolder.orphaned. f.shared is still true
      // here (only the Restore action flips it), so comparing against
      // extraFolderContentDir's shared path would just compare against
      // content that's already gone — a distinct status until the user
      // resolves it via the folder-removed notification's Restore action.
      if (f.orphaned) {
        folderStatuses.push({
          folderId: f.id,
          label: f.label,
          shared: f.shared,
          status: 'orphaned',
          localVersion: 0,
          remoteVersion: 0
        })
        continue
      }

      const pattern = buildExcludePattern(f.excludedFiles)
      const repoPath = extraFolderContentDir(cg.name, f, actor)
      const localExists = existsSync(f.savePath)
      const remoteExists = existsSync(repoPath)

      const localVer = localVersions[folderVersionKey(cg.appId, f.id)] ?? 0
      const remoteMeta = await readExtraFolderMeta(cg.name, f, actor)
      const remoteVer = remoteMeta?.version ?? 0

      let status: SyncStatus
      if (!localExists && !remoteExists) {
        status = 'no-saves'
      } else if (localExists && !remoteExists) {
        status = 'not-uploaded'
      } else if (!localExists && remoteExists) {
        status = 'cloud-only'
      } else if (remoteVer > localVer) {
        status = 'remote-newer'
      } else {
        // See the main-folder status logic above for why 'local-stale' is no
        // longer a separate outcome here either — same reasoning.
        const [localHash, remoteHash] = await Promise.all([
          folderHash(f.savePath, pattern),
          folderHash(repoPath, pattern)
        ])
        status = localHash === remoteHash ? 'synced' : 'local-newer'
      }

      const sizeBytes = remoteExists
        ? await folderSize(repoPath, pattern)
        : localExists
          ? await folderSize(f.savePath, pattern)
          : undefined

      folderStatuses.push({
        folderId: f.id,
        label: f.label,
        shared: f.shared,
        status,
        localVersion: localVer,
        remoteVersion: remoteVer,
        lastSyncAt: remoteMeta?.updatedAt,
        remoteUpdatedBy: remoteMeta?.updatedBy,
        sizeBytes
      })
    }
    gameEntry.extraFolders = folderStatuses
  }

  return result
}

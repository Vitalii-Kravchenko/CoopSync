import { getSyncableGames, listCustomGames, isCustomGameId, buildExcludePattern } from '../games/customGames'
import { resolveSavePath } from '../games/savePath'
import type { SupportedGame } from '../games/catalog'
import type { CustomExtraFolder } from '../../shared/types'
import {
  uploadGame,
  downloadGame,
  getSyncStatuses,
  restoreMissingFiles,
  localSaveFingerprint,
  uploadExtraFolder,
  downloadExtraFolder,
  restoreExtraFolderMissingFiles,
  localExtraFolderFingerprint,
  nextGameVersion,
  folderHash,
  personalLoginFor,
  readRemoteVersion,
  readExtraFolderMeta
} from './sync'
import { getRunningProcesses, isGameRunning } from './processCheck'
import { getNotified, markNotified } from './notifyState'
import { getSavesRepo, listInvitations, listCollaborators } from './github'
import { notifySavePushed, notifyPlayingState, getPlayingSnapshot } from './presenceService'
import {
  getKnownPending,
  getKnownCollaborators,
  setKnownFriendState,
  getHadAccess,
  setHadAccess
} from './backgroundState'
import { addNotification } from './notificationStore'
import { log } from './logger'
import { parseAppError } from '../../shared/errors'
import type { AutoSyncEvent, FriendSaveUpdate } from '../../shared/types'

// Watches game processes: launch → pull fresh saves, exit → push.

let timer: NodeJS.Timeout | null = null
let running: Record<string, boolean> = {}
let busy = false

/** Whether WE are currently running this exact game — the gate for the
 *  "friend is playing" toast/bell notification (see ipc.ts's onPlaying):
 *  it should only interrupt when it's actually about a session I'm also in
 *  right now, not for every game a friend happens to touch (Vitalii's call,
 *  2026-07-30). The GameCard badge stays unconditional — that screen is
 *  specifically for browsing games I'm NOT currently playing. */
export function isCurrentlyPlaying(appId: string): boolean {
  return running[appId] === true
}

// Dedup guard for the "friend is playing" toast/bell notification — friendId
// -> gameId already notified about. TWO independent code paths can each
// decide to fire it for the exact same join: this file's own launch-time
// "already there" check further down, and ipc.ts's onPlaying (fired for
// every 'playing' event from that friend — including the periodic bootstrap
// re-send presenceService.ts's friends-refresh triggers every ~2 min while
// both are still playing, and any presence reconnect). Without a shared
// guard, both can land for the exact same join — the "two notifications
// instead of one" Vitalii saw in practice (2026-07-30).
const notifiedFriendPlaying = new Map<number, string>()

/** Returns true (and marks it) only the first time this friend+game pairing
 *  hasn't already been notified about — both onPlaying (ipc.ts) and the
 *  launch-time check below must go through this before ever calling
 *  addNotification('friend-playing', ...). */
export function markFriendPlayingNotified(friendId: number, gameId: string): boolean {
  if (notifiedFriendPlaying.get(friendId) === gameId) return false
  notifiedFriendPlaying.set(friendId, gameId)
  return true
}

/** Friend stopped playing (or went offline) — clears just their entry, so
 *  the NEXT time they join while I'm still playing, I get notified again.
 *  See ipc.ts's onPlaying(gameId: null) case. */
export function clearFriendPlayingNotified(friendId: number): void {
  notifiedFriendPlaying.delete(friendId)
}

// Mid-session auto-push (while the game is still running, not just at exit)
// runs on its OWN faster timer (fingerprintTimer, see below), separate from
// the 5s process-launch/exit poll — checking the save folder is just a
// handful of stat() calls (localSaveFingerprint), nowhere near tasklist's
// cost of actually spawning a process, so there's no reason to tie it to the
// same interval.
//
// `lastSeenFingerprint` is what the previous check saw — comparing to the
// current reading is how a change is detected in the first place.
// `lastChangedAt` is a real debounce timestamp: the moment a change was last
// seen, reset every time the fingerprint moves again. A save is only pushed
// once SETTLE_QUIET_MS has genuinely elapsed since that moment — an explicit
// countdown from "the write stopped," not a coincidence of two fixed-grid
// snapshots happening to match. `lastHandledFingerprint` is the fingerprint
// already acted on (pushed, or found nothing worth pushing for) — without it
// every settled tick would re-run a full status check (a real git pull) for
// as long as a game with no NEW saves sits open.
// Keyed by appId for the game's main folder, or "appId:folderId" for an
// extra folder (see folderKey below) — sharing one flat map for both is safe
// since a bare appId never collides with a composite key built from it.
let lastSeenFingerprint: Record<string, string | null> = {}
let lastChangedAt: Record<string, number> = {}
let lastHandledFingerprint: Record<string, string | null> = {}

function folderKey(appId: string, folderId: string): string {
  return `${appId}:${folderId}`
}

// Custom games' extra folders configured with a local save path (see
// CustomGame.extraFolders) — a partner-added shared folder not yet pointed
// at a local path here is skipped, same as a 'needs-setup' whole game.
function extraFoldersOf(appId: string): CustomExtraFolder[] {
  if (!isCustomGameId(appId)) return []
  const cg = listCustomGames().find((c) => c.appId === appId)
  return (cg?.extraFolders ?? []).filter((f) => f.savePath)
}
// So we don't spam a banner every tick (5s) if tasklist consistently fails
// (e.g. no permissions) — notify once and stay quiet until it recovers.
let processCheckFailing = false

const POLL_MS = 5000
// How often (in ticks) we check for a friend's save pushed while we weren't
// looking — much rarer than the 5s process poll since it costs a real git
// pull. ~2 minutes is frequent enough for a "your friend just played" toast
// without hammering GitHub while the app just sits in the tray.
const FRIEND_CHECK_EVERY_TICKS = 24
let friendCheckTicks = 0

let fingerprintTimer: NodeJS.Timeout | null = null
// Only stat() calls (no process spawn, no disk read of file content) —
// affordable to run several times a second, but once a second is already
// far more responsive than the old design (which only sampled on the 5s
// process poll) without doing meaningfully more work.
const FINGERPRINT_POLL_MS = 1000
// How long a save folder must sit completely untouched before we treat it as
// finished writing and safe to upload. A real save is done well within this;
// it's here specifically so a slow or multi-step write is never caught
// mid-way and pushed truncated.
const SETTLE_QUIET_MS = 3000

// Decodes an AppError (the main process doesn't know the language — the
// renderer localizes it later via describeError/describeSyncResult).
// Unrecognized exceptions become GIT_GENERIC.
function errorCode(e: unknown): { code: string; params?: Record<string, string> } {
  const raw = e instanceof Error ? e.message : String(e)
  return parseAppError(raw) ?? { code: 'GIT_GENERIC', params: { detail: raw } }
}

// Detects a friend's save pushed while this device wasn't looking (the
// process-launch/exit sync above only ever notices OUR OWN games starting or
// closing — a friend playing on their own PC never touches that). Diffs
// each ready game's remote version against what we've already toasted about
// (notifyState), so a still-unseen push doesn't re-fire every cycle.
async function checkFriendUpdates(
  token: string,
  owner: string,
  actor: string,
  onFriendUpdate: (updates: FriendSaveUpdate[]) => void,
  onBackgroundCheck: () => void
): Promise<void> {
  try {
    const statuses = await getSyncStatuses(token, owner, actor)
    // getSyncStatuses also materializes a co-op partner's newly-added custom
    // game and adopts their newly-pushed cover for one we already know about
    // (see sync.ts) — both write straight to local settings with no signal
    // of their own. Firing this on every successful check (not just when
    // there's a friend-save toast to show) is what lets the renderer notice
    // either change without the user having to switch tabs away and back or
    // relaunch the app first.
    onBackgroundCheck()
    const updates: FriendSaveUpdate[] = []
    for (const s of statuses) {
      if (!s.remoteUpdatedBy || s.remoteVersion <= 0 || s.remoteUpdatedBy === actor) continue
      // 'cloud-only' — this device has never had local saves for this game
      // (never installed, or installed but never actually played/synced) —
      // a friend playing a game we don't even have is noise, not signal.
      if (s.status === 'cloud-only') continue
      if (s.remoteVersion <= getNotified(s.appId)) continue
      const game = getSyncableGames().find((g) => g.appId === s.appId)
      updates.push({
        appId: s.appId,
        name: game?.name ?? s.appId,
        version: s.remoteVersion,
        updatedBy: s.remoteUpdatedBy
      })
      markNotified(s.appId, s.remoteVersion)
    }
    if (updates.length > 0) onFriendUpdate(updates)
  } catch {
    // Best-effort background check (network/git can fail) — not user-initiated,
    // so we stay quiet and just try again on the next cycle.
  }
}

// Host-only: notices a friend accepting or declining the invite while this
// device wasn't looking at the Friends tab. Diffs the current
// pending/collaborator logins against the last known baseline — the first
// run ever just seeds the baseline (no notification for people who were
// already there before CoopSync started watching).
async function checkHostFriendStatus(token: string, owner: string): Promise<void> {
  try {
    const [invites, collabs] = await Promise.all([listInvitations(token, owner), listCollaborators(token, owner)])
    const pending = invites.map((i) => i.login)
    const collaborators = collabs.map((c) => c.login)

    const knownPending = getKnownPending()
    const knownCollaborators = getKnownCollaborators()
    if (knownPending && knownCollaborators) {
      const collabSet = new Set(collaborators)
      for (const login of knownPending) {
        if (pending.includes(login)) continue // still pending, nothing changed
        if (collabSet.has(login)) {
          addNotification('friend-accepted', { login })
        } else {
          addNotification('friend-declined', { login })
        }
      }
    }
    setKnownFriendState(pending, collaborators)
  } catch {
    // Best-effort — try again next cycle.
  }
}

// 'join'-only: notices losing access to the host's shared storage (kicked,
// or the host deleted the repo) while this device wasn't actively syncing —
// otherwise the first sign would be a cryptic sync error next time a game runs.
async function checkAccessStillValid(token: string, hostOwner: string): Promise<void> {
  try {
    const repo = await getSavesRepo(token, hostOwner)
    const had = getHadAccess()
    if (had === true && !repo) {
      addNotification('access-revoked', { host: hostOwner })
    }
    setHadAccess(repo !== null)
  } catch {
    // Best-effort — try again next cycle.
  }
}

async function tick(
  token: string,
  owner: string,
  actor: string,
  onEvent: (e: AutoSyncEvent) => void,
  onFriendUpdate: (updates: FriendSaveUpdate[]) => void,
  onBackgroundCheck: () => void,
  initial: boolean
): Promise<void> {
  if (busy) return // don't let ticks overlap
  busy = true
  try {
    if (!initial) {
      friendCheckTicks++
      if (friendCheckTicks % FRIEND_CHECK_EVERY_TICKS === 1) {
        void checkFriendUpdates(token, owner, actor, onFriendUpdate, onBackgroundCheck)
        // owner === actor only for the host (for 'join' it's the host friend's
        // login) — cheap way to tell the two roles apart without a settings read.
        if (owner === actor) {
          void checkHostFriendStatus(token, owner)
        } else {
          void checkAccessStillValid(token, owner)
        }
      }
    }
    let procs: Set<string>
    try {
      procs = await getRunningProcesses()
    } catch (e) {
      // This used to fail as a raw unhandled rejection — no event, no
      // banner, auto-sync would silently stop seeing games launch/exit. Now
      // we notify once (not on every tick) and try again next time.
      if (!processCheckFailing) {
        processCheckFailing = true
        onEvent({ appId: '', name: '', action: 'watcher-error', ok: false, ...errorCode(e) })
      }
      return
    }
    processCheckFailing = false
    for (const game of getSyncableGames()) {
      const now = isGameRunning(game, procs)
      const was = running[game.appId] ?? false
      running[game.appId] = now

      // The first tick just records state — no sync.
      if (initial) continue

      if (!was && now) {
        // Tell mutual friends we're playing this — best-effort, a no-op if
        // presence isn't connected (see presenceService.ts). Fired before
        // the pull work below so a friend's badge lights up the instant the
        // game opens, not after however long the sync itself takes.
        notifyPlayingState(game.appId)
        // A friend who was ALREADY playing this exact game before we joined
        // sent their own 'playing' event earlier — back when isCurrentlyPlaying
        // for us was still false, so ipc.ts's onPlaying handler correctly
        // skipped notifying us then. No fresh event will arrive now to
        // trigger it (they're not launching again), so this is the other
        // half of the "only notify about a game I'm actually in" rule: check
        // the current snapshot ourselves the moment WE join.
        const alreadyThere = Object.entries(getPlayingSnapshot()).find(([, p]) => p.gameId === game.appId)
        if (alreadyThere) {
          const [friendId, info] = alreadyThere
          if (markFriendPlayingNotified(Number(friendId), game.appId)) {
            addNotification('friend-playing', { login: info.login, game: game.name })
          }
        }
        // The game just launched → first, download files missing locally
        // (e.g. a deleted world), without touching existing local files —
        // this is always safe, regardless of versions. Then a full pull,
        // BUT only if the cloud is newer. Otherwise we'd overwrite newer local progress.
        let statuses: Awaited<ReturnType<typeof getSyncStatuses>> | null = null
        try {
          const restored = await restoreMissingFiles(token, owner, game.appId, actor)
          statuses = await getSyncStatuses(token, owner, actor)
          const st = statuses.find((s) => s.appId === game.appId)
          if (
            st &&
            (st.status === 'remote-newer' || st.status === 'cloud-only' || st.status === 'local-stale')
          ) {
            const result = await downloadGame(token, owner, game.appId, actor)
            onEvent({
              appId: game.appId,
              name: game.name,
              action: 'pull',
              ok: true,
              code: 'download-success',
              params: { version: String(result.version) }
            })
          } else if (restored > 0) {
            onEvent({
              appId: game.appId,
              name: game.name,
              action: 'pull',
              ok: true,
              code: 'restore-success',
              params: { count: String(restored) }
            })
          }
          // synced / local-newer (no files restored) → nothing to pull.
        } catch (e) {
          onEvent({ appId: game.appId, name: game.name, action: 'pull', ok: false, ...errorCode(e) })
        }
        // Seed the mid-session baseline to whatever's on disk right after
        // launch (including anything just pulled above) — a mid-session push
        // should only fire for a change made DURING this session, not for
        // content the game already had, and not for a pull we just did
        // (pushing that straight back would be a pointless round trip: same
        // content, wrong direction).
        try {
          const fp = await localSaveFingerprint(game.appId)
          lastSeenFingerprint[game.appId] = fp
          lastHandledFingerprint[game.appId] = fp
        } catch {
          // Best-effort — the fingerprint timer just treats the first real
          // reading as a fresh baseline instead.
        }

        // Same launch-time restore/pull, one level down, for each of this
        // game's configured extra folders (see CustomGame.extraFolders) —
        // reuses the `statuses` fetched above (each entry's extraFolders)
        // instead of pulling again per folder.
        for (const f of extraFoldersOf(game.appId)) {
          const label = `${game.name} / ${f.label}`
          try {
            const restored = await restoreExtraFolderMissingFiles(token, owner, game.appId, f.id, actor)
            const fst = statuses
              ?.find((s) => s.appId === game.appId)
              ?.extraFolders?.find((x) => x.folderId === f.id)
            if (
              fst &&
              (fst.status === 'remote-newer' || fst.status === 'cloud-only' || fst.status === 'local-stale')
            ) {
              const result = await downloadExtraFolder(token, owner, game.appId, f.id, actor)
              onEvent({
                appId: game.appId,
                name: label,
                action: 'pull',
                ok: true,
                code: 'download-success',
                params: { version: String(result.version) }
              })
            } else if (restored > 0) {
              onEvent({
                appId: game.appId,
                name: label,
                action: 'pull',
                ok: true,
                code: 'restore-success',
                params: { count: String(restored) }
              })
            }
          } catch (e) {
            onEvent({ appId: game.appId, name: label, action: 'pull', ok: false, ...errorCode(e) })
          }
          try {
            const fp = await localExtraFolderFingerprint(game.appId, f.id)
            const key = folderKey(game.appId, f.id)
            lastSeenFingerprint[key] = fp
            lastHandledFingerprint[key] = fp
          } catch {
            // Best-effort, same reasoning as the main folder's seed above.
          }
        }
      } else if (was && !now) {
        // Tell mutual friends we stopped — same best-effort no-op reasoning
        // as the launch-time call above.
        notifyPlayingState(null)
        // I'm the one leaving now, not a friend — clear the WHOLE guard (not
        // just one entry), so the next time I join anything, whoever's
        // already there gets freshly notified again instead of staying
        // silenced by a stale entry from this session.
        notifiedFriendPlaying.clear()
        // The game closed → the exit-time push is still the final catch-all,
        // regardless of whatever the mid-session settle check already did —
        // it covers whatever changed in the gap since the last settled push,
        // and uploadGame's own content-hash check (see pushGameSaves) makes
        // a redundant push here a harmless no-op when there's nothing new.
        //
        // The version pushed here (if any) is reused for every extra folder
        // pushed right below — these all happen in this one synchronous exit
        // sequence, a genuine single batch (unlike a mid-session push, which
        // can settle minutes apart for different folders — those still each
        // claim their own fresh number, see pushGameSaves/pushFolderSaves).
        // Without this, the main save and an extra folder that BOTH have new
        // content at the exact same exit would get two different numbers for
        // what's really one coherent "closed the game" moment.
        let batchVersion = await pushGameSaves(token, owner, actor, game, onEvent)
        delete lastSeenFingerprint[game.appId]
        delete lastChangedAt[game.appId]
        delete lastHandledFingerprint[game.appId]

        for (const f of extraFoldersOf(game.appId)) {
          const pushed = await pushFolderSaves(token, owner, actor, game, f, onEvent, false, batchVersion)
          if (pushed !== undefined) batchVersion = pushed
          const key = folderKey(game.appId, f.id)
          delete lastSeenFingerprint[key]
          delete lastChangedAt[key]
          delete lastHandledFingerprint[key]
        }
      }
    }
  } finally {
    busy = false
  }
}

// Uploads a game's saves, BUT first checks the status:
// - someone else (e.g. the host friend) already pushed a newer version while
//   we were playing — otherwise we'd silently overwrite their progress;
// - local content differs from the cloud, but not because we actually
//   played (no file changed since the last sync, e.g. saves were swapped for
//   an old backup) — otherwise stale data would silently overwrite current
//   cloud progress. This specific check only makes sense for the EXIT/launch
//   path, though — see midSession below.
// Shared by the exit-time push and the mid-session settle check below —
// same safety checks either way, only the trigger differs.
//
// `midSession` — true when called from checkMidSessionSave (the game is
// CONFIRMED still running right now, via the process poll). The
// "local-stale" verdict exists to catch one specific scenario: a file was
// swapped in from an old backup while nobody — neither the game nor this
// app — was touching the save folder. That scenario is structurally
// impossible while the game is actively running and being watched every
// second by the fingerprint timer; any hash difference caught here is real
// new progress, full stop. Treating it as "stale" here was a genuine bug —
// found via coopsync.log on 2026-07-26: a mid-session push for an extra
// folder got skipped as "stale" seconds after a normal push, even though
// nothing but active gameplay had happened in between (some games — Terraria
// included — don't always bump a save file's mtime on every rewrite the way
// this heuristic assumes, e.g. a temp-file-then-rename write pattern can
// leave the visible mtime looking older than the actual last write).
// Returns the version number actually pushed (undefined if skipped, no-op,
// or errored).
async function pushGameSaves(
  token: string,
  owner: string,
  actor: string,
  game: SupportedGame,
  onEvent: (e: AutoSyncEvent) => void,
  midSession = false,
  explicitVersion?: number
): Promise<number | undefined> {
  // GameDetailScreen uses this to block "Restore" for this game until the
  // matching terminal event below, so a manual revert can't race the same
  // underlying git clone against this background push.
  onEvent({ appId: game.appId, name: game.name, action: 'push-start', ok: true, code: 'push-start' })
  try {
    const statuses = await getSyncStatuses(token, owner, actor)
    const st = statuses.find((s) => s.appId === game.appId)
    // Short content-hash prefix, not just size/mtime — lets a log reader
    // tell definitively whether the actual save bytes changed between two
    // pushes, or the exact same content just got claimed again.
    const localHash = await folderHash(resolveSavePath(game), game.saveFilePattern).catch(() => 'ERR')
    log(
      `push ${game.name}: status=${st?.status} localVer=${st?.localVersion} remoteVer=${st?.remoteVersion} lastSyncAt=${st?.lastSyncAt} midSession=${midSession} localHash=${localHash.slice(0, 10)}`
    )
    if (st?.status === 'remote-newer' || st?.status === 'cloud-only') {
      onEvent({ appId: game.appId, name: game.name, action: 'push-skipped', ok: true, code: 'push-skipped' })
      // A real conflict (not the more benign "local was just stale") — this
      // session's progress genuinely wasn't uploaded, worth a persisted bell
      // entry, not just a toast that vanishes in 5s.
      addNotification('sync-conflict-skipped', { game: game.name })
    } else {
      // 'local-stale' (content differs, but no local file changed after the
      // last known cloud sync) used to also skip here — right, but ONLY the
      // very first time this game's status is ever checked after CoopSync
      // itself (re)starts, when there's a real gap where an old backup could
      // have been swapped in without us watching. pushGameSaves is never
      // called in that position — it only ever runs after this game was
      // already confirmed running (mid-session, or here at exit, always
      // preceded by 'was' being true in tick()) — i.e. our own 1s fingerprint
      // monitor was continuously watching this exact folder the whole time,
      // so "an old backup got silently swapped in" simply cannot have
      // happened in that window. Treating it as newer here is safe; the
      // status label itself (still computed, still shown in the UI) is
      // unaffected — only this push/skip decision changed.
      //
      // The version number itself is always freshly claimed per actual push
      // (not cached across a play session) — a mid-session push and a later
      // exit push are genuinely different content snapshots, and giving them
      // the same version number would make that number stop uniquely
      // identifying one specific state (which one would "revert to vX" even
      // mean?). Main and an extra folder's numbers stay close (one shared
      // growing sequence, see nextGameVersion) without being forced equal —
      // EXCEPT when the caller passes explicitVersion, meaning this push is
      // part of the same synchronous exit-time batch as another folder's
      // push (see tick()'s exit branch) — then it reuses that number instead.
      // A personal game's own last version has to feed into ITS OWN next
      // number here too (see nextGameVersion's ownDestination doc comment)
      // — this is the one call that decides the whole exit batch's shared
      // version number (see tick()'s exit branch), so getting it wrong here
      // means every folder pushed alongside it inherits the stuck number too.
      const personalLogin = personalLoginFor(game.appId, actor)
      const ownDestination = personalLogin ? await readRemoteVersion(game.name, personalLogin) : undefined
      const version = explicitVersion ?? (await nextGameVersion(game.name, ownDestination))
      const result = await uploadGame(token, owner, game.appId, actor, undefined, version)
      if (result.pushed === false) {
        // The local and cloud content hashes matched — nothing was actually
        // uploaded (we played, but didn't save/change the save, or the
        // mid-session check already pushed this exact state). "Uploaded"
        // would be a lie here, so a separate, honest code. Silent only while
        // still mid-session (the world-save cascade firing several of these
        // in quick succession IS just noise) — at exit this is the one
        // confirmation the user actually watches for: "did my last save make
        // it up, or was there really nothing left to do" — silencing THAT
        // one reads as "did it even check?", not "all good".
        onEvent({
          appId: game.appId,
          name: game.name,
          action: 'push-skipped',
          ok: true,
          code: midSession ? 'push-skipped-nochange' : 'push-skipped-nochange-exit',
          silent: midSession
        })
      } else {
        onEvent({
          appId: game.appId,
          name: game.name,
          action: 'push',
          ok: true,
          code: 'upload-success',
          params: { version: String(result.version) }
        })
        notifySavePushed(game.appId)
        return result.version
      }
    }
  } catch (e) {
    onEvent({ appId: game.appId, name: game.name, action: 'push', ok: false, ...errorCode(e) })
  }
  return undefined
}

// Same safety-checked upload as pushGameSaves, one level down for an extra
// folder — shares the exact same reasoning (don't overwrite a newer cloud
// push, don't push stale local data), just reading a FolderSyncStatus
// instead of a GameSyncStatus.
async function pushFolderSaves(
  token: string,
  owner: string,
  actor: string,
  game: SupportedGame,
  folder: CustomExtraFolder,
  onEvent: (e: AutoSyncEvent) => void,
  midSession = false,
  explicitVersion?: number
): Promise<number | undefined> {
  const label = `${game.name} / ${folder.label}`
  onEvent({ appId: game.appId, name: label, action: 'push-start', ok: true, code: 'push-start' })
  try {
    const statuses = await getSyncStatuses(token, owner, actor)
    const fst = statuses.find((s) => s.appId === game.appId)?.extraFolders?.find((x) => x.folderId === folder.id)
    const localHash = await folderHash(folder.savePath, buildExcludePattern(folder.excludedFiles)).catch(
      () => 'ERR'
    )
    log(
      `push ${label}: status=${fst?.status} localVer=${fst?.localVersion} remoteVer=${fst?.remoteVersion} lastSyncAt=${fst?.lastSyncAt} midSession=${midSession} localHash=${localHash.slice(0, 10)}`
    )
    if (fst?.status === 'remote-newer' || fst?.status === 'cloud-only') {
      onEvent({ appId: game.appId, name: label, action: 'push-skipped', ok: true, code: 'push-skipped' })
      addNotification('sync-conflict-skipped', { game: label })
    } else {
      // Same reasoning as pushGameSaves — this only ever runs after the
      // folder's game was already confirmed running, so 'local-stale' can't
      // mean "an old backup was swapped in unwatched" here either. Version
      // freshly claimed per push unless explicitVersion carries one forward
      // from the same exit-time batch — same reasoning as pushGameSaves above.
      // A personal FOLDER (independent of the game's own scope — see
      // extraFolderContentDir) needs the same ownDestination treatment.
      const ownDestination = !folder.shared
        ? (await readExtraFolderMeta(game.name, folder, actor))?.version
        : undefined
      const version = explicitVersion ?? (await nextGameVersion(game.name, ownDestination))
      const result = await uploadExtraFolder(token, owner, game.appId, folder.id, actor, version)
      if (result.pushed === false) {
        // Silent only mid-session — see pushGameSaves's identical reasoning.
        onEvent({
          appId: game.appId,
          name: label,
          action: 'push-skipped',
          ok: true,
          code: midSession ? 'push-skipped-nochange' : 'push-skipped-nochange-exit',
          silent: midSession
        })
      } else {
        onEvent({
          appId: game.appId,
          name: label,
          action: 'push',
          ok: true,
          code: 'upload-success',
          params: { version: String(result.version) }
        })
        notifySavePushed(game.appId)
        return result.version
      }
    }
  } catch (e) {
    onEvent({ appId: game.appId, name: label, action: 'push', ok: false, ...errorCode(e) })
  }
  return undefined
}

// While a game is running (not just at exit): notices a save that's
// finished writing and pushes it right away, so progress reaches the cloud
// (and a co-op partner) within seconds of saving instead of only when the
// player eventually quits.
//
// "Finished writing" is inferred, not signaled by the game — a save can
// touch a file in more than one step, and reading it mid-write could push a
// truncated one. Any change to the fingerprint (name+size+mtime, see
// localSaveFingerprint — no file content read) resets a countdown; only once
// SETTLE_QUIET_MS has passed with the fingerprint completely unchanged do we
// treat the write as finished and safe to upload. Same reasoning as
// sync.ts's local-stale mtime check, just applied while the game is still
// open rather than after it closes, and as an explicit "quiet for N ms"
// timer rather than "matched the previous sample."
async function checkMidSessionSave(
  token: string,
  owner: string,
  actor: string,
  game: SupportedGame,
  onEvent: (e: AutoSyncEvent) => void
): Promise<number | undefined> {
  let fp: string | null
  try {
    fp = await localSaveFingerprint(game.appId)
  } catch {
    return undefined // best-effort — try again next check
  }
  const prev = lastSeenFingerprint[game.appId]
  if (fp !== prev) {
    // Changed since the last check (or this is the very first reading this
    // session) — restart the quiet countdown and wait.
    lastSeenFingerprint[game.appId] = fp
    lastChangedAt[game.appId] = Date.now()
    return undefined
  }
  if (fp === null) return undefined // no save folder yet
  if (fp === lastHandledFingerprint[game.appId]) return undefined // already pushed (or found nothing to push) for this exact state
  if (Date.now() - (lastChangedAt[game.appId] ?? 0) < SETTLE_QUIET_MS) return undefined // still within the quiet window

  const pushed = await pushGameSaves(token, owner, actor, game, onEvent, true)
  // Marked as handled regardless of outcome — including a failed push: it'll
  // simply be caught by the exit-time push instead, and retrying an error
  // every second for as long as the game stays open would just hammer
  // git/GitHub for no benefit while whatever's actually wrong (offline,
  // auth) persists.
  lastHandledFingerprint[game.appId] = fp
  return pushed
}

// The fingerprint timer's own tick: checks every currently-running ready
// game. Shares the same `busy` flag as the process-poll tick() — both touch
// the same internal git clone, so they must never run at once.
async function fingerprintTick(
  token: string,
  owner: string,
  actor: string,
  onEvent: (e: AutoSyncEvent) => void
): Promise<void> {
  if (busy) return // the process-poll tick (or another push) is already using the clone
  const active = getSyncableGames().filter((g) => running[g.appId])
  if (active.length === 0) return
  busy = true
  try {
    for (const game of active) {
      const mainVersion = await checkMidSessionSave(token, owner, actor, game, onEvent)
      // By design, an extra folder is never watched on its own — a world
      // save IS the save event, full stop, and every extra folder rides
      // along with it as one unit, one shared version, whether or not that
      // specific folder's own content happened to change. No independent
      // per-folder settle timer, no folder ever "catching up" on its own
      // between world saves.
      if (mainVersion !== undefined) {
        for (const f of extraFoldersOf(game.appId)) {
          await pushFolderSaves(token, owner, actor, game, f, onEvent, true, mainVersion)
        }
      }
    }
  } finally {
    busy = false
  }
}

// Captured on startWatcher so triggerFriendCheck (below) can re-run
// checkFriendUpdates on demand, without every caller having to carry these
// around separately.
interface WatcherContext {
  token: string
  owner: string
  actor: string
  onFriendUpdate: (updates: FriendSaveUpdate[]) => void
  onBackgroundCheck: () => void
}
let currentContext: WatcherContext | null = null

export function startWatcher(
  token: string,
  owner: string,
  actor: string,
  onEvent: (e: AutoSyncEvent) => void,
  onFriendUpdate: (updates: FriendSaveUpdate[]) => void,
  onBackgroundCheck: () => void
): void {
  stopWatcher()
  currentContext = { token, owner, actor, onFriendUpdate, onBackgroundCheck }
  running = {}
  lastSeenFingerprint = {}
  lastChangedAt = {}
  lastHandledFingerprint = {}
  friendCheckTicks = 0
  // Initialize state without taking action (in case a game is already running at startup).
  void tick(token, owner, actor, onEvent, onFriendUpdate, onBackgroundCheck, true)
  timer = setInterval(
    () => void tick(token, owner, actor, onEvent, onFriendUpdate, onBackgroundCheck, false),
    POLL_MS
  )
  fingerprintTimer = setInterval(() => void fingerprintTick(token, owner, actor, onEvent), FINGERPRINT_POLL_MS)
}

export function stopWatcher(): void {
  if (timer) clearInterval(timer)
  timer = null
  if (fingerprintTimer) clearInterval(fingerprintTimer)
  fingerprintTimer = null
  currentContext = null
}

// An instant presence 'save:pushed' notice (see presenceService.ts) arrived
// — re-runs the same friend-update check checkFriendUpdates would do on its
// next ~2min tick anyway, just right now, so the toast/bell shows up within
// moments of a friend's push instead of waiting for the regular poll (which
// stays as the fallback for whenever presence isn't connected). A no-op if
// the watcher isn't running.
export function triggerFriendCheck(): void {
  if (!currentContext) return
  void checkFriendUpdates(
    currentContext.token,
    currentContext.owner,
    currentContext.actor,
    currentContext.onFriendUpdate,
    currentContext.onBackgroundCheck
  )
}

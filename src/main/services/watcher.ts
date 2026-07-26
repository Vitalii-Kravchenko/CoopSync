import { getSyncableGames } from '../games/customGames'
import type { SupportedGame } from '../games/catalog'
import { uploadGame, downloadGame, getSyncStatuses, restoreMissingFiles, localSaveFingerprint } from './sync'
import { getRunningProcesses, isGameRunning } from './processCheck'
import { getNotified, markNotified } from './notifyState'
import { getSavesRepo, listInvitations, listCollaborators } from './github'
import {
  getKnownPending,
  getKnownCollaborators,
  setKnownFriendState,
  getHadAccess,
  setHadAccess
} from './backgroundState'
import { addNotification } from './notificationStore'
import { parseAppError } from '../../shared/errors'
import type { AutoSyncEvent, FriendSaveUpdate } from '../../shared/types'

// Watches game processes: launch → pull fresh saves, exit → push.

let timer: NodeJS.Timeout | null = null
let running: Record<string, boolean> = {}
let busy = false

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
let lastSeenFingerprint: Record<string, string | null> = {}
let lastChangedAt: Record<string, number> = {}
let lastHandledFingerprint: Record<string, string | null> = {}
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
        // The game just launched → first, download files missing locally
        // (e.g. a deleted world), without touching existing local files —
        // this is always safe, regardless of versions. Then a full pull,
        // BUT only if the cloud is newer. Otherwise we'd overwrite newer local progress.
        try {
          const restored = await restoreMissingFiles(token, owner, game.appId)
          const statuses = await getSyncStatuses(token, owner, actor)
          const st = statuses.find((s) => s.appId === game.appId)
          if (
            st &&
            (st.status === 'remote-newer' || st.status === 'cloud-only' || st.status === 'local-stale')
          ) {
            const result = await downloadGame(token, owner, game.appId)
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
      } else if (was && !now) {
        // The game closed → the exit-time push is still the final catch-all,
        // regardless of whatever the mid-session settle check already did —
        // it covers whatever changed in the gap since the last settled push,
        // and uploadGame's own content-hash check (see pushGameSaves) makes
        // a redundant push here a harmless no-op when there's nothing new.
        await pushGameSaves(token, owner, actor, game, onEvent)
        delete lastSeenFingerprint[game.appId]
        delete lastChangedAt[game.appId]
        delete lastHandledFingerprint[game.appId]
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
//   cloud progress.
// Shared by the exit-time push and the mid-session settle check below —
// same safety checks either way, only the trigger differs.
async function pushGameSaves(
  token: string,
  owner: string,
  actor: string,
  game: SupportedGame,
  onEvent: (e: AutoSyncEvent) => void
): Promise<void> {
  // GameDetailScreen uses this to block "Restore" for this game until the
  // matching terminal event below, so a manual revert can't race the same
  // underlying git clone against this background push.
  onEvent({ appId: game.appId, name: game.name, action: 'push-start', ok: true, code: 'push-start' })
  try {
    const statuses = await getSyncStatuses(token, owner, actor)
    const st = statuses.find((s) => s.appId === game.appId)
    // TODO(temporary): diagnostics for "saved in-game, exited — nothing got pushed".
    console.log(
      `[watcher] push ${game.name}: status=${st?.status} localVer=${st?.localVersion} remoteVer=${st?.remoteVersion} lastSyncAt=${st?.lastSyncAt}`
    )
    if (st?.status === 'remote-newer' || st?.status === 'cloud-only') {
      onEvent({ appId: game.appId, name: game.name, action: 'push-skipped', ok: true, code: 'push-skipped' })
      // A real conflict (not the more benign "local was just stale") — this
      // session's progress genuinely wasn't uploaded, worth a persisted bell
      // entry, not just a toast that vanishes in 5s.
      addNotification('sync-conflict-skipped', { game: game.name })
    } else if (st?.status === 'local-stale') {
      onEvent({
        appId: game.appId,
        name: game.name,
        action: 'push-skipped',
        ok: true,
        code: 'push-skipped-stale'
      })
    } else {
      const result = await uploadGame(token, owner, game.appId, actor)
      if (result.pushed === false) {
        // The local and cloud content hashes matched — nothing was actually
        // uploaded (we played, but didn't save/change the save, or the
        // mid-session check already pushed this exact state). "Uploaded"
        // would be a lie here, so a separate, honest code.
        onEvent({
          appId: game.appId,
          name: game.name,
          action: 'push-skipped',
          ok: true,
          code: 'push-skipped-nochange'
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
      }
    }
  } catch (e) {
    onEvent({ appId: game.appId, name: game.name, action: 'push', ok: false, ...errorCode(e) })
  }
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
): Promise<void> {
  let fp: string | null
  try {
    fp = await localSaveFingerprint(game.appId)
  } catch {
    return // best-effort — try again next check
  }
  const prev = lastSeenFingerprint[game.appId]
  if (fp !== prev) {
    // Changed since the last check (or this is the very first reading this
    // session) — restart the quiet countdown and wait.
    lastSeenFingerprint[game.appId] = fp
    lastChangedAt[game.appId] = Date.now()
    return
  }
  if (fp === null) return // no save folder yet
  if (fp === lastHandledFingerprint[game.appId]) return // already pushed (or found nothing to push) for this exact state
  if (Date.now() - (lastChangedAt[game.appId] ?? 0) < SETTLE_QUIET_MS) return // still within the quiet window

  await pushGameSaves(token, owner, actor, game, onEvent)
  // Marked as handled regardless of outcome — including a failed push: it'll
  // simply be caught by the exit-time push instead, and retrying an error
  // every second for as long as the game stays open would just hammer
  // git/GitHub for no benefit while whatever's actually wrong (offline,
  // auth) persists.
  lastHandledFingerprint[game.appId] = fp
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
      await checkMidSessionSave(token, owner, actor, game, onEvent)
    }
  } finally {
    busy = false
  }
}

export function startWatcher(
  token: string,
  owner: string,
  actor: string,
  onEvent: (e: AutoSyncEvent) => void,
  onFriendUpdate: (updates: FriendSaveUpdate[]) => void,
  onBackgroundCheck: () => void
): void {
  stopWatcher()
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
}

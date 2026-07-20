import { getSyncableGames } from '../games/customGames'
import { uploadGame, downloadGame, getSyncStatuses, restoreMissingFiles } from './sync'
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
    const statuses = await getSyncStatuses(token, owner)
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
          const statuses = await getSyncStatuses(token, owner)
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
      } else if (was && !now) {
        // The game closed → upload saves, BUT first check the status:
        // - someone else (e.g. the host friend) already pushed a newer
        //   version while we were playing — otherwise we'd silently overwrite
        //   their progress with our save;
        // - local content differs from the cloud, but not because we
        //   actually played (no file changed since the last sync, e.g. saves
        //   were swapped for an old backup) — otherwise stale data would
        //   silently overwrite current cloud progress.
        // Fire the "starting" marker before any of that work — GameDetailScreen
        // uses it to block "Restore" for this game until the matching
        // terminal event below, so a manual revert can't race the same
        // underlying git clone against this background push.
        onEvent({ appId: game.appId, name: game.name, action: 'push-start', ok: true, code: 'push-start' })
        try {
          const statuses = await getSyncStatuses(token, owner)
          const st = statuses.find((s) => s.appId === game.appId)
          // TODO(temporary): diagnostics for "saved in-game, exited — nothing got pushed".
          console.log(
            `[watcher] exit ${game.name}: status=${st?.status} localVer=${st?.localVersion} remoteVer=${st?.remoteVersion} lastSyncAt=${st?.lastSyncAt}`
          )
          if (st?.status === 'remote-newer' || st?.status === 'cloud-only') {
            onEvent({
              appId: game.appId,
              name: game.name,
              action: 'push-skipped',
              ok: true,
              code: 'push-skipped'
            })
            // A real conflict (not the more benign "local was just stale")
            // — this session's progress genuinely wasn't uploaded, worth a
            // persisted bell entry, not just a toast that vanishes in 5s.
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
              // The local and cloud content hashes matched — nothing was
              // actually uploaded (we played, but didn't save/change the
              // save). "Uploaded" would be a lie here, so a separate, honest code.
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
  friendCheckTicks = 0
  // Initialize state without taking action (in case a game is already running at startup).
  void tick(token, owner, actor, onEvent, onFriendUpdate, onBackgroundCheck, true)
  timer = setInterval(
    () => void tick(token, owner, actor, onEvent, onFriendUpdate, onBackgroundCheck, false),
    POLL_MS
  )
}

export function stopWatcher(): void {
  if (timer) clearInterval(timer)
  timer = null
}

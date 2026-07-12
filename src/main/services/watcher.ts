import { execFile } from 'child_process'
import { promisify } from 'util'
import { READY_GAMES, type SupportedGame } from '../games/catalog'
import { uploadGame, downloadGame, getSyncStatuses, restoreMissingFiles } from './sync'
import { parseAppError } from '../../shared/errors'
import type { AutoSyncEvent } from '../../shared/types'

const exec = promisify(execFile)

// Watches game processes: launch → pull fresh saves, exit → push.

let timer: NodeJS.Timeout | null = null
let running: Record<string, boolean> = {}
let busy = false
// So we don't spam a banner every tick (5s) if tasklist consistently fails
// (e.g. no permissions) — notify once and stay quiet until it recovers.
let processCheckFailing = false

const POLL_MS = 5000

// Set of running processes (image names, lowercased).
async function getRunningProcesses(): Promise<Set<string>> {
  const { stdout } = await exec('tasklist', ['/fo', 'csv', '/nh'], { maxBuffer: 16 * 1024 * 1024 })
  const set = new Set<string>()
  for (const line of stdout.split('\n')) {
    const m = line.match(/^"([^"]+)"/)
    if (m) set.add(m[1].toLowerCase())
  }
  return set
}

function isGameRunning(game: SupportedGame, procs: Set<string>): boolean {
  return game.processNames.some((p) => procs.has(p.toLowerCase()))
}

// Decodes an AppError (the main process doesn't know the language — the
// renderer localizes it later via describeError/describeSyncResult).
// Unrecognized exceptions become GIT_GENERIC.
function errorCode(e: unknown): { code: string; params?: Record<string, string> } {
  const raw = e instanceof Error ? e.message : String(e)
  return parseAppError(raw) ?? { code: 'GIT_GENERIC', params: { detail: raw } }
}

async function tick(
  token: string,
  owner: string,
  actor: string,
  onEvent: (e: AutoSyncEvent) => void,
  initial: boolean
): Promise<void> {
  if (busy) return // don't let ticks overlap
  busy = true
  try {
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
    for (const game of READY_GAMES) {
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
  onEvent: (e: AutoSyncEvent) => void
): void {
  stopWatcher()
  running = {}
  // Initialize state without taking action (in case a game is already running at startup).
  void tick(token, owner, actor, onEvent, true)
  timer = setInterval(() => void tick(token, owner, actor, onEvent, false), POLL_MS)
}

export function stopWatcher(): void {
  if (timer) clearInterval(timer)
  timer = null
}

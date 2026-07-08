import { execFile } from 'child_process'
import { promisify } from 'util'
import { READY_GAMES, type SupportedGame } from '../games/catalog'
import { uploadGame, downloadGame, getSyncStatuses, isRemoteAhead } from './sync'
import type { AutoSyncEvent } from '../../shared/types'

const exec = promisify(execFile)

// Стежимо за процесами ігор: запуск → pull свіжих сейвів, вихід → push.

let timer: NodeJS.Timeout | null = null
let running: Record<string, boolean> = {}
let busy = false

const POLL_MS = 5000

// Множина запущених процесів (image-назви у нижньому регістрі).
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

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : 'Помилка'
}

async function tick(
  token: string,
  owner: string,
  onEvent: (e: AutoSyncEvent) => void,
  initial: boolean
): Promise<void> {
  if (busy) return // не накладаємо тіки один на одного
  busy = true
  try {
    const procs = await getRunningProcesses()
    for (const game of READY_GAMES) {
      const now = isGameRunning(game, procs)
      const was = running[game.appId] ?? false
      running[game.appId] = now

      // Перший тік лише запам'ятовує стан — без синку.
      if (initial) continue

      if (!was && now) {
        // Гра щойно запустилася → тягнемо свіжі сейви, АЛЕ лише якщо хмара
        // новіша. Інакше затерли б новіший локальний прогрес.
        try {
          const statuses = await getSyncStatuses(token, owner)
          const st = statuses.find((s) => s.appId === game.appId)
          if (st && (st.status === 'remote-newer' || st.status === 'cloud-only')) {
            const message = await downloadGame(token, owner, game.appId)
            onEvent({ appId: game.appId, name: game.name, action: 'pull', ok: true, message })
          }
          // synced / local-newer / not-uploaded → нічого тягнути не треба.
        } catch (e) {
          onEvent({ appId: game.appId, name: game.name, action: 'pull', ok: false, message: errMsg(e) })
        }
      } else if (was && !now) {
        // Гра закрилася → вивантажуємо сейви, АЛЕ спершу перевіряємо, чи хтось
        // інший (напр. друг-хост) уже не запушив новішу версію, поки ми грали —
        // інакше ми б мовчки затерли його прогрес своїм (можливо, застарілим) сейвом.
        try {
          if (await isRemoteAhead(token, owner, game.appId)) {
            onEvent({
              appId: game.appId,
              name: game.name,
              action: 'push-skipped',
              ok: true,
              message:
                'У хмарі вже новіша версія (хтось інший вивантажив свою) — автосинк пропущено. Онови вручну на екрані ігор.'
            })
          } else {
            const message = await uploadGame(token, owner, game.appId)
            onEvent({ appId: game.appId, name: game.name, action: 'push', ok: true, message })
          }
        } catch (e) {
          onEvent({ appId: game.appId, name: game.name, action: 'push', ok: false, message: errMsg(e) })
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
  onEvent: (e: AutoSyncEvent) => void
): void {
  stopWatcher()
  running = {}
  // Ініціалізуємо стан без дій (раптом гра вже запущена на момент старту).
  void tick(token, owner, onEvent, true)
  timer = setInterval(() => void tick(token, owner, onEvent, false), POLL_MS)
}

export function stopWatcher(): void {
  if (timer) clearInterval(timer)
  timer = null
}

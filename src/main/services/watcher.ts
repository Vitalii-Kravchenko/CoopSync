import { execFile } from 'child_process'
import { promisify } from 'util'
import { READY_GAMES, type SupportedGame } from '../games/catalog'
import { uploadGame, downloadGame, getSyncStatuses, restoreMissingFiles } from './sync'
import { parseAppError } from '../../shared/errors'
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

// Розкодовує AppError (main-процес не знає мови — далі локалізує renderer через
// describeError/describeSyncResult). Нерозпізнані винятки йдуть як GIT_GENERIC.
function errorCode(e: unknown): { code: string; params?: Record<string, string> } {
  const raw = e instanceof Error ? e.message : String(e)
  return parseAppError(raw) ?? { code: 'GIT_GENERIC', params: { detail: raw } }
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
        // Гра щойно запустилася → спершу довантажуємо файли, яких бракує
        // локально (напр. видалений світ), не чіпаючи наявні локальні файли —
        // це безпечно завжди, незалежно від версій. Далі повний pull, АЛЕ
        // лише якщо хмара новіша. Інакше затерли б новіший локальний прогрес.
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
          // synced / local-newer (без відновлених файлів) → нічого тягнути не треба.
        } catch (e) {
          onEvent({ appId: game.appId, name: game.name, action: 'pull', ok: false, ...errorCode(e) })
        }
      } else if (was && !now) {
        // Гра закрилася → вивантажуємо сейви, АЛЕ спершу перевіряємо статус:
        // - хтось інший (напр. друг-хост) уже запушив новішу версію, поки ми
        //   грали — інакше ми б мовчки затерли його прогрес своїм сейвом;
        // - локальний вміст відрізняється від хмарного, але не тому, що ми
        //   реально грали (жоден файл не змінювався після останнього синку,
        //   напр. підмінили сейви старим бекапом) — інакше застаріле мовчки
        //   затре актуальний хмарний прогрес.
        try {
          const statuses = await getSyncStatuses(token, owner)
          const st = statuses.find((s) => s.appId === game.appId)
          // TODO(тимчасово): діагностика "зберіг у грі, вийшов — нічого не запушилось".
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
            const result = await uploadGame(token, owner, game.appId)
            if (result.pushed === false) {
              // Хеш локального й хмарного вмісту збігся — реально нічого не
              // вивантажувалось (грали, але не зберігали/не міняли сейв).
              // "Вивантажено" тут була б брехнею, тож окремий, чесний код.
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

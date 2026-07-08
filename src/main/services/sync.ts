import { app } from 'electron'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { createHash } from 'crypto'
import { basename, join } from 'path'
import { existsSync, statSync } from 'fs'
import { cp, rm, mkdir, readdir, readFile, writeFile } from 'fs/promises'
import { SUPPORTED_GAMES, READY_GAMES } from '../games/catalog'
import { SAVES_REPO_NAME } from '../config'
import { makeAppError } from '../../shared/errors'
import type { SyncStatus, GameSyncStatus, SyncHistoryEntry, SyncResult } from '../../shared/types'

const exec = promisify(execFile)
const BIG_BUFFER = 64 * 1024 * 1024 // запас для великих сейвів

// Локальна папка, куди клонуємо спільне сховище.
function repoDir(): string {
  return join(app.getPath('userData'), 'saves-repo')
}

// URL репо з токеном для приватного доступу (push/pull без окремого логіну git).
function remoteUrl(token: string, owner: string): string {
  return `https://x-access-token:${token}@github.com/${owner}/${SAVES_REPO_NAME}.git`
}

// Прапори, що вимикають credential helper (gh/GCM) — інакше при push/pull
// вискакує вікно "вибери акаунт GitHub". Очищаємо і загальний, і
// github.com-специфічний helper (його ставить gh). Так git бере токен з URL.
const NO_HELPER = [
  '-c',
  'credential.helper=',
  '-c',
  'credential.https://github.com.helper='
]

// Середовище: забороняємо будь-які інтерактивні запити (вікна/промпти).
const GIT_ENV = {
  ...process.env,
  GIT_TERMINAL_PROMPT: '0',
  GCM_INTERACTIVE: 'never'
}

// Розпізнати сирий exec()-виняток git (технічний stderr, "Command failed: git...")
// і перетворити на код помилки, зрозумілий користувачу. Нерозпізнані випадки не
// губимо повністю — лишаємо найзмістовніший рядок stderr (fatal:/error:) як деталь.
function wrapGitError(e: unknown): Error {
  const raw = e instanceof Error ? e.message : String(e)
  if (/could not resolve host|network is unreachable|connection timed out|failed to connect|recv failure|could not connect/i.test(raw)) {
    return makeAppError('NO_INTERNET')
  }
  if (/authentication failed|could not read username|repository not found|401 unauthorized|403 forbidden/i.test(raw)) {
    return makeAppError('GIT_AUTH_FAILED')
  }
  const lines = raw
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
  const detail = [...lines].reverse().find((l) => /^(fatal|error):/i.test(l)) ?? lines.at(-1) ?? raw
  return makeAppError('GIT_GENERIC', { detail })
}

// Запустити git у вже клонованому репо.
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

// Одночасні виклики (напр. MainScreen і HistoryScreen смикають ensureRepo
// паралельно на старті) інакше змагаються за той самий клон і ламають один
// одного (два "git clone" в ту саму папку). Серіалізуємо через спільний proмiс.
let ensureRepoInFlight: Promise<void> | null = null

// Переконатися, що репо склоновано локально й оновлено з GitHub.
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
    // Оновлюємо токен у remote (міг змінитись) і підтягуємо свіже.
    await git(['remote', 'set-url', 'origin', url])
    try {
      await exec('git', [...NO_HELPER, 'pull', '--no-rebase', 'origin', 'main'], {
        cwd: dir,
        maxBuffer: BIG_BUFFER,
        env: GIT_ENV
      })
    } catch (e) {
      const raw = e instanceof Error ? e.message : String(e)
      if (!retried && /refusing to merge unrelated histories/i.test(raw)) {
        // Локальний клон застарів відносно пересозданого на GitHub репо (напр.
        // хтось видалив і перестворив сховище) — самі перестворюємо клон з нуля
        // замість падати назавжди з незрозумілою git-помилкою.
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

// Копіює папку, пропускаючи файли (не папки), що не матчаться паттерном гри —
// потрібно для ігор, де та сама папка сейвів містить ще й акаунт-специфічні
// файли, які не можна переносити на чужий ПК (див. SupportedGame.saveFilePattern).
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

// --- Версії сейвів ---
// Хмарна версія лежить у репо в .meta/<гра>.json; локальна — у userData.

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
    // Прибираємо можливий BOM на початку — інакше JSON.parse падає.
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

// --- Історія синхронізацій ---
// Лог push-подій, спільний для host і join (лежить у самому репо, тож
// синкається разом із сейвами). Тільки push — download локальний, у хмарі
// нічого не міняє, тож логувати його в спільній історії нема сенсу.

const MAX_HISTORY_ENTRIES = 50

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
  const next = [entry, ...current].slice(0, MAX_HISTORY_ENTRIES)
  await mkdir(join(repoDir(), '.meta'), { recursive: true })
  await writeFile(historyPath(), JSON.stringify(next, null, 2))
}

/** Історія push-подій, найновіші перші. */
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

// Версія для показу: 1 → "v1.001".
function formatVersion(n: number): string {
  return `v1.${String(n).padStart(3, '0')}`
}

// Легка перевірка перед push при виході з гри: чи хмара вже випередила
// відому нам локальну версію (хтось інший встиг запушити, поки ми грали).
// Без хешування вмісту папки — досить порівняти номери версій з .meta.
export async function isRemoteAhead(token: string, owner: string, appId: string): Promise<boolean> {
  await ensureRepo(token, owner)
  const game = findGame(appId)
  const localVersions = await readLocalVersions()
  const localVer = localVersions[appId] ?? 0
  const remoteVer = await readRemoteVersion(game.name)
  return remoteVer > localVer
}

/** Вивантажити сейви гри на GitHub (push). Піднімає версію. */
export async function uploadGame(token: string, owner: string, appId: string): Promise<SyncResult> {
  await ensureRepo(token, owner)
  const game = findGame(appId)
  if (!existsSync(game.savePath)) throw makeAppError('SAVE_FOLDER_NOT_FOUND')

  // Замінюємо вміст папки гри в репо свіжими локальними сейвами.
  const dest = join(repoDir(), game.name)
  await rm(dest, { recursive: true, force: true })
  await copyFiltered(game.savePath, dest, game.saveFilePattern)

  // Завжди створюємо нову версію — навіть якщо файли начебто ті самі
  // (могли змінитися дрібниці: координати персонажа, час у грі тощо).
  // Мета-файл оновлюється щоразу, тож коміт ніколи не буде порожнім.
  const newVersion = (await readRemoteVersion(game.name)) + 1
  await writeRemoteMeta(game.name, newVersion, owner)
  await appendHistory({
    appId,
    gameName: game.name,
    version: newVersion,
    updatedBy: owner,
    updatedAt: new Date().toISOString()
  })

  await git(['add', '-A'])
  await git(['commit', '-m', `sync: ${game.name} ${formatVersion(newVersion)} (${owner})`])
  await git(['push', 'origin', 'main'])
  await setLocalVersion(appId, newVersion)
  return { version: newVersion }
}

/** Завантажити сейви гри з GitHub у локальну папку (pull). */
export async function downloadGame(token: string, owner: string, appId: string): Promise<SyncResult> {
  await ensureRepo(token, owner)
  const game = findGame(appId)

  const src = join(repoDir(), game.name)
  if (!existsSync(src)) throw makeAppError('NO_CLOUD_SAVES')

  await mkdir(game.savePath, { recursive: true })
  await copyFiltered(src, game.savePath, game.saveFilePattern)

  // Локальна версія тепер дорівнює хмарній.
  const remoteVersion = await readRemoteVersion(game.name)
  await setLocalVersion(appId, remoteVersion)
  return { version: remoteVersion }
}

/** Прибрати локальний клон сховища й забуті версії — після видалення репо на GitHub. */
export async function resetLocalSaveState(): Promise<void> {
  await rm(repoDir(), { recursive: true, force: true })
  await rm(localVersionsPath(), { force: true })
}

// --- Визначення статусу синхронізації ---

// Відбиток вмісту папки: відсортований список "шлях:хеш" → один хеш.
// Однаковий відбиток = однаковий вміст.
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

// Сумарний розмір файлів у папці (з урахуванням того самого паттерна фільтрації,
// що й copyFiltered/folderHash — щоб цифра відповідала тому, що реально синкається).
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

/** Статус синку для всіх підтримуваних ігор (один pull на всі). */
export async function getSyncStatuses(token: string, owner: string): Promise<GameSyncStatus[]> {
  await ensureRepo(token, owner)

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
      // У хмарі новіша версія → треба завантажити.
      status = 'remote-newer'
    } else {
      // Версія не новіша — перевіряємо, чи є незбережені локальні зміни.
      const [localHash, remoteHash] = await Promise.all([
        folderHash(savePath, g.saveFilePattern),
        folderHash(repoPath, g.saveFilePattern)
      ])
      status = localHash === remoteHash ? 'synced' : 'local-newer'
    }

    // Час/розмір показуємо зі спільної (хмарної) копії, коли вона є — це те,
    // що бачать обидва гравці незалежно від того, хто синкав востаннє.
    // Інакше (ще нікому не вивантажено) — розмір хоча б локальної папки.
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
      sizeBytes
    })
  }
  return result
}

import { app } from 'electron'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { createHash } from 'crypto'
import { join } from 'path'
import { existsSync } from 'fs'
import { cp, rm, mkdir, readdir, readFile, writeFile, stat } from 'fs/promises'
import { SUPPORTED_GAMES } from '../games/catalog'
import { SAVES_REPO_NAME } from '../config'
import type { SyncStatus, GameSyncStatus } from '../../shared/types'

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

// Запустити git у вже клонованому репо.
async function git(args: string[]): Promise<string> {
  const { stdout } = await exec('git', args, { cwd: repoDir(), maxBuffer: BIG_BUFFER })
  return stdout
}

// Переконатися, що репо склоновано локально й оновлено з GitHub.
async function ensureRepo(token: string, owner: string): Promise<void> {
  const dir = repoDir()
  const url = remoteUrl(token, owner)

  if (!existsSync(join(dir, '.git'))) {
    await mkdir(app.getPath('userData'), { recursive: true })
    await exec('git', ['clone', url, dir], { maxBuffer: BIG_BUFFER })
  } else {
    // Оновлюємо токен у remote (міг змінитись) і підтягуємо свіже.
    await git(['remote', 'set-url', 'origin', url])
    await git(['pull', '--no-rebase', 'origin', 'main'])
  }
}

function findGame(appId: string): { name: string; savePath: string } {
  const g = SUPPORTED_GAMES.find((x) => x.appId === appId)
  if (!g) throw new Error('Гра не підтримується')
  return { name: g.name, savePath: g.getSavePath() }
}

// --- Версії сейвів ---
// Хмарна версія лежить у репо в .meta/<гра>.json; локальна — у userData.

function remoteMetaPath(name: string): string {
  return join(repoDir(), '.meta', `${name}.json`)
}

async function readRemoteVersion(name: string): Promise<number> {
  const p = remoteMetaPath(name)
  if (!existsSync(p)) return 0
  try {
    const data = JSON.parse(await readFile(p, 'utf8')) as { version?: number }
    return data.version ?? 0
  } catch {
    return 0
  }
}

async function writeRemoteMeta(name: string, version: number, owner: string): Promise<void> {
  await mkdir(join(repoDir(), '.meta'), { recursive: true })
  const meta = { version, updatedAt: new Date().toISOString(), updatedBy: owner }
  await writeFile(remoteMetaPath(name), JSON.stringify(meta, null, 2))
}

function localVersionsPath(): string {
  return join(app.getPath('userData'), 'coopsync-versions.json')
}

async function readLocalVersions(): Promise<Record<string, number>> {
  const p = localVersionsPath()
  if (!existsSync(p)) return {}
  try {
    return JSON.parse(await readFile(p, 'utf8')) as Record<string, number>
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

/** Вивантажити сейви гри на GitHub (push). Піднімає версію. */
export async function uploadGame(token: string, owner: string, appId: string): Promise<string> {
  await ensureRepo(token, owner)
  const game = findGame(appId)
  if (!existsSync(game.savePath)) throw new Error('Папку сейвів не знайдено')

  // Замінюємо вміст папки гри в репо свіжими локальними сейвами.
  const dest = join(repoDir(), game.name)
  await rm(dest, { recursive: true, force: true })
  await cp(game.savePath, dest, { recursive: true })

  // Чи змінилися самі сейви (без урахування мета-файлу)?
  await git(['add', game.name])
  const status = await git(['status', '--porcelain', '--', game.name])

  const currentVersion = await readRemoteVersion(game.name)
  if (!status.trim()) {
    // Сейви не змінилися. Якщо версія вже є — нічого робити не треба.
    if (currentVersion > 0) {
      await setLocalVersion(appId, currentVersion)
      return 'Уже актуально — змін немає'
    }
    // Legacy: гра в сховищі без версії (вивантажена до версіонування) —
    // ініціалізуємо стартову версію.
    await writeRemoteMeta(game.name, 1, owner)
    await git(['add', '-A'])
    await git(['commit', '-m', `meta: ${game.name} ${formatVersion(1)} (${owner})`])
    await git(['push', 'origin', 'main'])
    await setLocalVersion(appId, 1)
    return `Вивантажено на GitHub ✓ (${formatVersion(1)})`
  }

  // Сейви змінилися → піднімаємо версію.
  const newVersion = currentVersion + 1
  await writeRemoteMeta(game.name, newVersion, owner)

  await git(['add', '-A'])
  await git(['commit', '-m', `sync: ${game.name} ${formatVersion(newVersion)} (${owner})`])
  await git(['push', 'origin', 'main'])
  await setLocalVersion(appId, newVersion)
  return `Вивантажено на GitHub ✓ (${formatVersion(newVersion)})`
}

/** Завантажити сейви гри з GitHub у локальну папку (pull). */
export async function downloadGame(token: string, owner: string, appId: string): Promise<string> {
  await ensureRepo(token, owner)
  const game = findGame(appId)

  const src = join(repoDir(), game.name)
  if (!existsSync(src)) throw new Error('У сховищі ще немає сейвів цієї гри')

  await mkdir(game.savePath, { recursive: true })
  await cp(src, game.savePath, { recursive: true })

  // Локальна версія тепер дорівнює хмарній.
  const remoteVersion = await readRemoteVersion(game.name)
  await setLocalVersion(appId, remoteVersion)
  return `Завантажено з GitHub ✓ (${formatVersion(remoteVersion)})`
}

// --- Визначення статусу синхронізації ---

// Відбиток вмісту папки: відсортований список "шлях:хеш" → один хеш.
// Однаковий відбиток = однаковий вміст.
async function folderHash(dir: string): Promise<string> {
  const parts: string[] = []
  async function walk(d: string, rel: string): Promise<void> {
    const entries = (await readdir(d, { withFileTypes: true })).sort((a, b) =>
      a.name.localeCompare(b.name)
    )
    for (const e of entries) {
      if (e.name === '.git') continue
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

// Час останньої зміни найсвіжішого файлу в папці (мс).
async function newestMtime(dir: string): Promise<number> {
  let newest = 0
  async function walk(d: string): Promise<void> {
    for (const e of await readdir(d, { withFileTypes: true })) {
      if (e.name === '.git') continue
      const full = join(d, e.name)
      if (e.isDirectory()) await walk(full)
      else {
        const s = await stat(full)
        if (s.mtimeMs > newest) newest = s.mtimeMs
      }
    }
  }
  await walk(dir)
  return newest
}

// Дата останнього коміту, що чіпав папку гри (коли востаннє вивантажили).
async function remoteCommitDate(name: string): Promise<number> {
  try {
    const out = await git(['log', '-1', '--format=%cI', '--', name])
    const t = Date.parse(out.trim())
    return Number.isNaN(t) ? 0 : t
  } catch {
    return 0
  }
}

/** Статус синку для всіх підтримуваних ігор (один pull на всі). */
export async function getSyncStatuses(token: string, owner: string): Promise<GameSyncStatus[]> {
  await ensureRepo(token, owner)

  const localVersions = await readLocalVersions()
  const result: GameSyncStatus[] = []
  for (const g of SUPPORTED_GAMES) {
    const savePath = g.getSavePath()
    const repoPath = join(repoDir(), g.name)
    const localExists = existsSync(savePath)
    const remoteExists = existsSync(repoPath)

    let status: SyncStatus
    if (!localExists && !remoteExists) {
      status = 'no-saves'
    } else if (localExists && !remoteExists) {
      status = 'not-uploaded'
    } else if (!localExists && remoteExists) {
      status = 'cloud-only'
    } else {
      const [localHash, remoteHash] = await Promise.all([
        folderHash(savePath),
        folderHash(repoPath)
      ])
      if (localHash === remoteHash) {
        status = 'synced'
      } else {
        const [localTime, remoteTime] = await Promise.all([
          newestMtime(savePath),
          remoteCommitDate(g.name)
        ])
        status = localTime > remoteTime ? 'local-newer' : 'remote-newer'
      }
    }
    result.push({
      appId: g.appId,
      status,
      localVersion: localVersions[g.appId] ?? 0,
      remoteVersion: await readRemoteVersion(g.name)
    })
  }
  return result
}

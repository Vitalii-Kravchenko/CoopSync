import { app } from 'electron'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { createHash } from 'crypto'
import { basename, join } from 'path'
import { existsSync, statSync } from 'fs'
import { cp, rm, mkdir, readdir, readFile, writeFile } from 'fs/promises'
import { SUPPORTED_GAMES, READY_GAMES } from '../games/catalog'
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

// Запустити git у вже клонованому репо.
async function git(args: string[]): Promise<string> {
  const { stdout } = await exec('git', [...NO_HELPER, ...args], {
    cwd: repoDir(),
    maxBuffer: BIG_BUFFER,
    env: GIT_ENV
  })
  return stdout
}

// Переконатися, що репо склоновано локально й оновлено з GitHub.
async function ensureRepo(token: string, owner: string): Promise<void> {
  const dir = repoDir()
  const url = remoteUrl(token, owner)

  if (!existsSync(join(dir, '.git'))) {
    await mkdir(app.getPath('userData'), { recursive: true })
    await exec('git', [...NO_HELPER, 'clone', url, dir], { maxBuffer: BIG_BUFFER, env: GIT_ENV })
  } else {
    // Оновлюємо токен у remote (міг змінитись) і підтягуємо свіже.
    await git(['remote', 'set-url', 'origin', url])
    await git(['pull', '--no-rebase', 'origin', 'main'])
  }
}

function findGame(appId: string): { name: string; savePath: string; saveFilePattern?: RegExp } {
  const g = SUPPORTED_GAMES.find((x) => x.appId === appId)
  if (!g) throw new Error('Гра не підтримується')
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

async function readRemoteVersion(name: string): Promise<number> {
  const p = remoteMetaPath(name)
  if (!existsSync(p)) return 0
  try {
    // Прибираємо можливий BOM на початку — інакше JSON.parse падає.
    const raw = (await readFile(p, 'utf8')).replace(/^﻿/, '')
    const data = JSON.parse(raw) as { version?: number }
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

/** Вивантажити сейви гри на GitHub (push). Піднімає версію. */
export async function uploadGame(token: string, owner: string, appId: string): Promise<string> {
  await ensureRepo(token, owner)
  const game = findGame(appId)
  if (!existsSync(game.savePath)) throw new Error('Папку сейвів не знайдено')

  // Замінюємо вміст папки гри в репо свіжими локальними сейвами.
  const dest = join(repoDir(), game.name)
  await rm(dest, { recursive: true, force: true })
  await copyFiltered(game.savePath, dest, game.saveFilePattern)

  // Завжди створюємо нову версію — навіть якщо файли начебто ті самі
  // (могли змінитися дрібниці: координати персонажа, час у грі тощо).
  // Мета-файл оновлюється щоразу, тож коміт ніколи не буде порожнім.
  const newVersion = (await readRemoteVersion(game.name)) + 1
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
  await copyFiltered(src, game.savePath, game.saveFilePattern)

  // Локальна версія тепер дорівнює хмарній.
  const remoteVersion = await readRemoteVersion(game.name)
  await setLocalVersion(appId, remoteVersion)
  return `Завантажено з GitHub ✓ (${formatVersion(remoteVersion)})`
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
    const remoteVer = await readRemoteVersion(g.name)

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

    result.push({ appId: g.appId, status, localVersion: localVer, remoteVersion: remoteVer })
  }
  return result
}

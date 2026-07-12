import { app } from 'electron'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { createHash } from 'crypto'
import { basename, join } from 'path'
import { existsSync, statSync } from 'fs'
import { cp, rm, mkdir, readdir, readFile, writeFile } from 'fs/promises'
import { SUPPORTED_GAMES, READY_GAMES } from '../games/catalog'
import { SAVES_REPO_NAME } from '../config'
import { makeAppError, parseAppError } from '../../shared/errors'
import { formatVersion } from '../../shared/format'
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
  // Окремо від інших auth-помилок: "repository not found" на git-рівні означає
  // саме "такого репо більше нема" (видалили на GitHub) — токен тут ні до чого,
  // тож не радимо переlogінюватись, а даємо код, який вище перетворюємо на
  // чіткий "сховище не підключено" замість голої git-помилки.
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

// Явна ідентичність коміту (-c user.name/user.email) — інакше на машині, де в
// git ніколи не налаштовували global user.name/user.email (типово для когось,
// хто поставив CoopSync і більше нічим git не користується), commit падає з
// "unable to auto-detect email address". noreply-адреса від GitHub не
// потребує підтвердження, просто валідна для git.
function identityFlags(actor: string): string[] {
  return ['-c', `user.name=${actor}`, '-c', `user.email=${actor}@users.noreply.github.com`]
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
    // Скидаємо будь-які незакомічені зміни в цьому внутрішньому клоні перед
    // пулом. Це технічна робоча копія, не джерело істини (справжні сейви
    // копіюються сюди наново з реальної папки гри при кожному uploadGame) —
    // якщо застосунок впав/закрився посеред копіювання файлів (після
    // copyFiltered, до git commit), клон лишається "брудним" і pull назавжди
    // падає з "local changes would be overwritten by merge", ламаючи взагалі
    // весь синк (історію, upload, download) до ручного втручання.
    try {
      await git(['reset', '--hard', 'HEAD'])
      await git(['clean', '-fd'])
    } catch {
      // Якщо навіть reset/clean не вдався — не блокуємо спробу pull нижче,
      // хай вона впаде своєю власною, зрозумілішою помилкою.
    }
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

/** Вивантажити сейви гри на GitHub (push). Піднімає версію.
 * `owner` — чиє сховище (ціль синку, для join це хост); `actor` — хто реально
 * зараз тисне кнопку (для join це НЕ owner) — саме actor йде в історію/коміт. */
export async function uploadGame(
  token: string,
  owner: string,
  appId: string,
  actor: string
): Promise<SyncResult> {
  await ensureRepo(token, owner)
  const game = findGame(appId)
  if (!existsSync(game.savePath)) throw makeAppError('SAVE_FOLDER_NOT_FOUND')

  const dest = join(repoDir(), game.name)

  // Якщо хмарна копія вже є і вміст співпадає з локальним (реальних змін
  // немає — типовий випадок: локальний трекінг версій скинувся, а в гру
  // після цього не заходили) — не бампаємо версію і не створюємо порожній
  // коміт, просто підтягуємо локальний трекінг до вже актуальної хмарної версії.
  if (existsSync(dest)) {
    const [localHash, remoteHash] = await Promise.all([
      folderHash(game.savePath, game.saveFilePattern),
      folderHash(dest, game.saveFilePattern)
    ])
    if (localHash === remoteHash) {
      const remoteVersion = await readRemoteVersion(game.name)
      await setLocalVersion(appId, remoteVersion)
      return { version: remoteVersion, pushed: false }
    }
  }

  // Замінюємо вміст папки гри в репо свіжими локальними сейвами.
  await rm(dest, { recursive: true, force: true })
  await copyFiltered(game.savePath, dest, game.saveFilePattern)

  const newVersion = (await readRemoteVersion(game.name)) + 1
  await writeRemoteMeta(game.name, newVersion, actor)
  await appendHistory({
    appId,
    gameName: game.name,
    version: newVersion,
    updatedBy: actor,
    updatedAt: new Date().toISOString()
  })

  await git(['add', '-A'])
  await git([
    ...identityFlags(actor),
    'commit',
    '-m',
    `sync: ${game.name} ${formatVersion(newVersion)} (${actor})`
  ])
  await git(['push', 'origin', 'main'])
  await setLocalVersion(appId, newVersion)
  return { version: newVersion, pushed: true }
}

// --- Аватарки учасників ---
// Зберігаються прямо в спільному сховищі (.meta/avatars/<нік>.txt — сирий
// data URL, той самий формат, що й локальний avatarDataUrl), щоб кожен
// учасник кооп-групи бачив картинку іншого. Аватарка локальна лише до першого
// вивантаження — після uploadAvatar вона доступна всім, у кого є доступ.

function avatarPath(login: string): string {
  return join(repoDir(), '.meta', 'avatars', `${login}.txt`)
}

/** Вивантажити (або прибрати, якщо dataUrl === null) свою аватарку в спільне сховище. */
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
  // Якщо файл не змінився (та сама картинка вже була запушена) — нема чого
  // комітити, а голий `git commit` без змін падає з "nothing to commit".
  const status = await git(['status', '--porcelain'])
  if (!status.trim()) return
  await git([...identityFlags(actor), 'commit', '-m', `avatar: ${actor}`])
  await git(['push', 'origin', 'main'])
}

/** Аватарки учасників (owner + collaborators) зі спільного сховища, ключ — нік. */
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
        // Пошкоджений файл — просто пропускаємо, показуватиметься заглушка.
      }
    }
  }
  return result
}

/**
 * Довантажити з хмари файли, яких бракує локально — не чіпаючи наявні
 * локальні файли (git-подібна поведінка: додаємо те, чого нема, а не
 * перезаписуємо те, що вже є). Захищає від сценарію, коли гравець видалив
 * частину локальних сейвів (напр. один світ) — при вході в гру ці файли
 * автоматично повертаються з хмари, і застосунок більше не сприймає їхню
 * відсутність як "локальний прогрес", який треба запушити поверх хмари.
 * Повертає кількість відновлених файлів.
 */
export async function restoreMissingFiles(token: string, owner: string, appId: string): Promise<number> {
  await ensureRepo(token, owner)
  const game = findGame(appId)
  const repoPath = join(repoDir(), game.name)
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

// Час останньої зміни файлу в папці (найсвіжіший mtime, мс). 0, якщо файлів нема.
// Використовується, щоб відрізнити "локально реально новіший прогрес" від
// "локальний вміст просто відрізняється, бо підмінили старим бекапом".
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
  try {
    await ensureRepo(token, owner)
  } catch (e) {
    const raw = e instanceof Error ? e.message : String(e)
    if (parseAppError(raw)?.code === 'REPO_NOT_FOUND') {
      // Сховище видалене на GitHub (і локальний клон або відсутній, або
      // застарів) — не помилка мережі/токена, а чіткий стан "нема сховища".
      // Показуємо це явно на кожній картці замість того, щоб падати помилкою
      // і лишати ігри вічно висіти на "Перевіряю...".
      return READY_GAMES.map((g) => ({
        appId: g.appId,
        status: 'no-repo',
        localVersion: 0,
        remoteVersion: 0
      }))
    }
    throw e
  }

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
      if (localHash === remoteHash) {
        status = 'synced'
      } else if (
        remoteMeta &&
        (await maxMtime(savePath, g.saveFilePattern)) <= new Date(remoteMeta.updatedAt).getTime()
      ) {
        // Локальний вміст відрізняється від хмарного, але жоден локальний файл
        // не змінювався ПІСЛЯ останнього відомого хмарного синку — це не новий
        // прогрес, а застарілі дані (напр. відновлений старий бекап сейвів).
        // Не можна вважати це "локально новіше" — інакше застаріле мовчки
        // затре хмарний прогрес при автопуші.
        status = 'local-stale'
      } else {
        status = 'local-newer'
      }
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

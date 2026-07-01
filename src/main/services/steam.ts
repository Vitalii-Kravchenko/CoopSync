import { execFileSync } from 'child_process'
import { join } from 'path'
import { existsSync, readdirSync, readFileSync } from 'fs'
import { READY_GAMES } from '../games/catalog'
import type { DetectedGame, InstalledGame } from '../../shared/types'

// Записи Steam, які не є іграми (інструменти, рантайми, редистрибутиви) —
// не показуємо їх у бібліотеці.
const NON_GAME_IDS = new Set([
  '228980', // Steamworks Common Redistributables
  '1070560', // Steam Linux Runtime
  '1391110', // Steam Linux Runtime - Soldier
  '1628350', // Steam Linux Runtime 3.0 (Sniper)
  '431960' // Wallpaper Engine
])
const NON_GAME_PATTERN =
  /redistributable|runtime|proton|dedicated server|soundtrack|wallpaper engine|steamvr|benchmark|\bsdk\b/i

function isRealGame(appId: string, name: string): boolean {
  return !NON_GAME_IDS.has(appId) && !NON_GAME_PATTERN.test(name)
}

// Знайти, де встановлений Steam (через реєстр Windows, з фолбеком на стандартний шлях).
function findSteamPath(): string | null {
  try {
    const out = execFileSync(
      'reg',
      ['query', 'HKCU\\Software\\Valve\\Steam', '/v', 'SteamPath'],
      { encoding: 'utf8' }
    )
    const match = out.match(/SteamPath\s+REG_SZ\s+(.+)/)
    if (match) return match[1].trim()
  } catch {
    // реєстр недоступний — спробуємо стандартний шлях нижче
  }
  const fallback = 'C:\\Program Files (x86)\\Steam'
  return existsSync(fallback) ? fallback : null
}

// Прочитати всі бібліотеки Steam (їх може бути кілька — на різних дисках).
function getLibraryFolders(steamPath: string): string[] {
  const vdf = join(steamPath, 'steamapps', 'libraryfolders.vdf')
  if (!existsSync(vdf)) return [steamPath]

  const content = readFileSync(vdf, 'utf8')
  const paths: string[] = []
  const regex = /"path"\s+"([^"]+)"/g
  let match: RegExpExecArray | null
  while ((match = regex.exec(content)) !== null) {
    // У VDF шляхи з подвійними бекслешами — повертаємо їх до звичайних.
    paths.push(match[1].replace(/\\\\/g, '\\'))
  }
  return paths.length > 0 ? paths : [steamPath]
}

// Зібрати всі встановлені ігри (appId → назва) з файлів appmanifest_*.acf.
function getInstalledGames(): Map<string, string> {
  const games = new Map<string, string>()
  const steamPath = findSteamPath()
  if (!steamPath) return games

  for (const lib of getLibraryFolders(steamPath)) {
    const appsDir = join(lib, 'steamapps')
    if (!existsSync(appsDir)) continue
    for (const file of readdirSync(appsDir)) {
      const match = file.match(/^appmanifest_(\d+)\.acf$/)
      if (!match) continue
      const appId = match[1]
      try {
        const content = readFileSync(join(appsDir, file), 'utf8')
        const nameMatch = content.match(/"name"\s+"([^"]+)"/)
        games.set(appId, nameMatch ? nameMatch[1] : `App ${appId}`)
      } catch {
        games.set(appId, `App ${appId}`)
      }
    }
  }
  return games
}

// Які з ГОТОВИХ ігор встановлені + чи знайдено їхні сейви.
export function detectGames(): DetectedGame[] {
  const installed = getInstalledGames()
  return READY_GAMES.filter((game) => installed.has(game.appId)).map((game) => {
    const savePath = game.getSavePath()
    return {
      appId: game.appId,
      name: game.name,
      savePath,
      saveFound: existsSync(savePath)
    }
  })
}

// Усі встановлені Steam-ІГРИ (без інструментів/рантаймів) з позначкою,
// чи має CoopSync готову підтримку. Підтримувані — спочатку, далі за назвою.
export function detectAllInstalled(): InstalledGame[] {
  const installed = getInstalledGames()
  const readyIds = new Set(READY_GAMES.map((g) => g.appId))
  return [...installed.entries()]
    .filter(([appId, name]) => isRealGame(appId, name))
    .map(([appId, name]) => ({ appId, name, supported: readyIds.has(appId) }))
    .sort((a, b) => {
      if (a.supported !== b.supported) return a.supported ? -1 : 1
      return a.name.localeCompare(b.name)
    })
}

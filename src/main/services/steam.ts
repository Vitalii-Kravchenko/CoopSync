import { execFileSync } from 'child_process'
import { join } from 'path'
import { existsSync, readdirSync, readFileSync } from 'fs'
import { READY_GAMES } from '../games/catalog'
import { resolveSavePath } from '../games/savePath'
import { listCustomGames } from '../games/customGames'
import type { DetectedGame, InstalledGame } from '../../shared/types'

// Steam entries that aren't games (tools, runtimes, redistributables) —
// don't show these in the library.
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

// Find where Steam is installed (via the Windows registry, falling back to the default path).
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
    // registry unavailable — fall back to the default path below
  }
  const fallback = 'C:\\Program Files (x86)\\Steam'
  return existsSync(fallback) ? fallback : null
}

// Read all Steam libraries (there can be several — on different drives).
function getLibraryFolders(steamPath: string): string[] {
  const vdf = join(steamPath, 'steamapps', 'libraryfolders.vdf')
  if (!existsSync(vdf)) return [steamPath]

  const content = readFileSync(vdf, 'utf8')
  const paths: string[] = []
  const regex = /"path"\s+"([^"]+)"/g
  let match: RegExpExecArray | null
  while ((match = regex.exec(content)) !== null) {
    // Paths in the VDF use double backslashes — convert them back to normal ones.
    paths.push(match[1].replace(/\\\\/g, '\\'))
  }
  return paths.length > 0 ? paths : [steamPath]
}

// Collect all installed games (appId → name) from appmanifest_*.acf files.
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

// Which of the READY games are installed + whether their saves were found.
export function detectGames(): DetectedGame[] {
  const installed = getInstalledGames()
  return READY_GAMES.filter((game) => installed.has(game.appId)).map((game) => {
    const savePath = resolveSavePath(game)
    return {
      appId: game.appId,
      name: game.name,
      savePath,
      saveFound: existsSync(savePath)
    }
  })
}

// All installed Steam GAMES (excluding tools/runtimes) flagged with whether
// CoopSync has ready support for them, plus every manually-added custom game
// (always "installed" — the user pointed us straight at its save folder, no
// Steam library scan needed). Supported ones come first, then sorted by name.
export function detectAllInstalled(): InstalledGame[] {
  const installed = getInstalledGames()
  const readyIds = new Set(READY_GAMES.map((g) => g.appId))
  const steamGames = [...installed.entries()]
    .filter(([appId, name]) => isRealGame(appId, name))
    .map(([appId, name]) => ({ appId, name, supported: readyIds.has(appId) }))
  const customGames = listCustomGames().map((g) => ({
    appId: g.appId,
    name: g.name,
    supported: true,
    isCustom: true
  }))
  return [...steamGames, ...customGames].sort((a, b) => {
    if (a.supported !== b.supported) return a.supported ? -1 : 1
    return a.name.localeCompare(b.name)
  })
}

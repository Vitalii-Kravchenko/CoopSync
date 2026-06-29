import { execFileSync } from 'child_process'
import { join } from 'path'
import { existsSync, readdirSync, readFileSync } from 'fs'
import { SUPPORTED_GAMES } from '../games/catalog'
import type { DetectedGame } from '../../shared/types'

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

// Зібрати AppID усіх встановлених ігор (з файлів appmanifest_*.acf у кожній бібліотеці).
function getInstalledAppIds(): Set<string> {
  const ids = new Set<string>()
  const steamPath = findSteamPath()
  if (!steamPath) return ids

  for (const lib of getLibraryFolders(steamPath)) {
    const appsDir = join(lib, 'steamapps')
    if (!existsSync(appsDir)) continue
    for (const file of readdirSync(appsDir)) {
      const match = file.match(/^appmanifest_(\d+)\.acf$/)
      if (match) ids.add(match[1])
    }
  }
  return ids
}

// Які з підтримуваних ігор встановлені + чи знайдено їхні сейви.
export function detectGames(): DetectedGame[] {
  const installed = getInstalledAppIds()
  return SUPPORTED_GAMES.filter((game) => installed.has(game.appId)).map((game) => {
    const savePath = game.getSavePath()
    return {
      appId: game.appId,
      name: game.name,
      savePath,
      saveFound: existsSync(savePath)
    }
  })
}

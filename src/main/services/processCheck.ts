import { execFile } from 'child_process'
import { promisify } from 'util'
import type { SupportedGame } from '../games/catalog'
import { getSyncableGames } from '../games/customGames'

const exec = promisify(execFile)

/** Set of running processes (image names, lowercased). */
export async function getRunningProcesses(): Promise<Set<string>> {
  const { stdout } = await exec('tasklist', ['/fo', 'csv', '/nh'], { maxBuffer: 16 * 1024 * 1024 })
  const set = new Set<string>()
  for (const line of stdout.split('\n')) {
    const m = line.match(/^"([^"]+)"/)
    if (m) set.add(m[1].toLowerCase())
  }
  return set
}

export function isGameRunning(game: SupportedGame, procs: Set<string>): boolean {
  return game.processNames.some((p) => procs.has(p.toLowerCase()))
}

// A live OS check (not watcher.ts's polled/cached state, which can lag a
// few seconds behind reality) — used right before a destructive operation
// like restoring an older save, which must never run while the game itself
// might still be running and writing to those same files.
export async function isGameCurrentlyRunning(appId: string): Promise<boolean> {
  const game = getSyncableGames().find((g) => g.appId === appId)
  if (!game) return false
  const procs = await getRunningProcesses()
  return isGameRunning(game, procs)
}

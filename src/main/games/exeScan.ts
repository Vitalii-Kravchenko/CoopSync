import { readdirSync, statSync } from 'fs'
import { basename, join } from 'path'

// Finds candidate game executables in a folder the user points at when
// adding a custom game (AddCustomGameModal) — so they pick an install
// folder instead of having to know/type an exe filename themselves.

// Installers, redistributables, anti-cheat, crash reporters, engine helper
// processes — never the actual game, but extremely common clutter in a real
// install folder (especially Unreal/Unity games ship several of these next
// to the real .exe).
const NOISE_PATTERN =
  /unins(tall)?|redist|vc_redist|vcredist|dotnet|directx|dxsetup|crash(report|pad|handler)?|_subprocess|subprocess|easyanticheat|battleye|setup|updater|launcher[-_]?helper|prereq|cleanup|report\.exe$/i

const MAX_DEPTH = 4
const MAX_RESULTS = 25

export function scanForExecutables(rootDir: string): string[] {
  const found: string[] = []

  function walk(dir: string, depth: number): void {
    if (depth > MAX_DEPTH || found.length >= MAX_RESULTS) return
    let entries: string[]
    try {
      entries = readdirSync(dir)
    } catch {
      return
    }
    for (const entry of entries) {
      if (found.length >= MAX_RESULTS) return
      const full = join(dir, entry)
      let isDir: boolean
      try {
        isDir = statSync(full).isDirectory()
      } catch {
        continue
      }
      if (isDir) {
        walk(full, depth + 1)
      } else if (entry.toLowerCase().endsWith('.exe') && !NOISE_PATTERN.test(entry)) {
        found.push(basename(full))
      }
    }
  }

  walk(rootDir, 0)
  return [...new Set(found)]
}

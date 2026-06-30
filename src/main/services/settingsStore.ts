import { app } from 'electron'
import { join } from 'path'
import { readFileSync, writeFileSync } from 'fs'

// Прості налаштування застосунку (окрім автозапуску, який зберігає система).
interface AppSettings {
  startMinimized: boolean
}

const DEFAULTS: AppSettings = { startMinimized: false }

function settingsPath(): string {
  return join(app.getPath('userData'), 'app-settings.json')
}

export function readSettings(): AppSettings {
  try {
    const raw = readFileSync(settingsPath(), 'utf8').replace(/^﻿/, '')
    return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<AppSettings>) }
  } catch {
    return { ...DEFAULTS }
  }
}

export function writeSettings(patch: Partial<AppSettings>): void {
  const next = { ...readSettings(), ...patch }
  writeFileSync(settingsPath(), JSON.stringify(next, null, 2))
}

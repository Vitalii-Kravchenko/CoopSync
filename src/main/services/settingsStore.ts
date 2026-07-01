import { app } from 'electron'
import { dirname, join } from 'path'
import { readFileSync, unlinkSync, writeFileSync } from 'fs'

import type { UserRole } from '../../shared/types'

// Прості налаштування застосунку (окрім автозапуску, який зберігає система).
interface AppSettings {
  startMinimized: boolean
  /** Роль користувача (host/join). undefined = ще не вибрано (треба онбординг). */
  role?: UserRole
  /** Чиє сховище синхронізуємо (логін host'а). */
  hostOwner?: string
  /** Мова інтерфейсу. */
  language: string
  /** Кастомний аватар користувача (data URL), якщо завантажив свій. */
  avatarDataUrl?: string
}

// Англійська — універсальний фолбек, якщо мову з інсталятора визначити не вдалось.
const DEFAULTS: AppSettings = { startMinimized: false, language: 'en' }

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

/**
 * Мова, яку користувач обрав у діалозі вибору мови NSIS-інсталятора
 * (записана в build/installer.nsh) у папку встановлення — НЕ в userData,
 * бо при "встановити для всіх користувачів" адмінська сесія інсталятора і
 * пізніший запуск застосунку звичайним користувачем можуть мати різний
 * %APPDATA%, а $INSTDIR (= папка поруч з .exe) завжди той самий.
 * Файл одноразовий — читаємо й намагаємось видалити (може не вдатись, якщо
 * застосунок встановлено в Program Files і запущено не від адміністратора —
 * це нешкідливо, просто лишиться порожній файл).
 */
export function consumeInstallerLanguage(): string | null {
  const markerPath = join(dirname(app.getPath('exe')), 'installer-language.txt')
  try {
    const lang = readFileSync(markerPath, 'utf8').trim()
    try {
      unlinkSync(markerPath)
    } catch {
      // Немає прав видалити (Program Files, не-адмін) — не критично.
    }
    return lang || null
  } catch {
    return null
  }
}

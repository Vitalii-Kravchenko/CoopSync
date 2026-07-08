import { parseAppError } from '../../shared/errors'
import type { Translation } from './i18n'

// "1" → "v1.001".
function fmtVersion(n: number): string {
  return `v1.${String(n).padStart(3, '0')}`
}

/**
 * Перетворити помилку з window.api-виклику на читабельний локалізований текст.
 * Розпізнані (AppError-закодовані) помилки йдуть через t.errors[code]; нерозпізнані —
 * очищені від технічного Electron-префікса "Error invoking remote method '...': ".
 */
export function describeError(e: unknown, t: Translation, fallback: string): string {
  const raw = e instanceof Error ? e.message : String(e)
  const parsed = parseAppError(raw)
  if (parsed) {
    const entry = t.errors[parsed.code]
    if (entry) return entry(parsed.params ?? {})
  }
  const cleaned = raw.replace(/^Error invoking remote method '[^']+':\s*(Error:\s*)?/, '').trim()
  return cleaned || fallback
}

/** Текст для коду результату upload/download — той самий і для ручного синку, і для автосинку. */
export function describeSyncResult(code: string, params: Record<string, string> | undefined, t: Translation): string {
  switch (code) {
    case 'upload-success':
      return t.main.uploadSuccess(fmtVersion(Number(params?.version ?? 0)))
    case 'download-success':
      return t.main.downloadSuccess(fmtVersion(Number(params?.version ?? 0)))
    case 'push-skipped':
      return t.main.pushSkipped
    default: {
      const entry = t.errors[code as keyof Translation['errors']]
      return entry ? entry(params ?? {}) : t.main.syncErrorFallback
    }
  }
}

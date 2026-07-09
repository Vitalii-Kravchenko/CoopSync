import { parseAppError } from '../../shared/errors'
import { formatVersion } from '../../shared/format'
import type { Translation } from './i18n'

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
      return t.main.uploadSuccess(formatVersion(Number(params?.version ?? 0)))
    case 'download-success':
      return t.main.downloadSuccess(formatVersion(Number(params?.version ?? 0)))
    case 'restore-success':
      return t.main.restoreSuccess(String(params?.count ?? 0))
    case 'push-skipped':
      return t.main.pushSkipped
    case 'push-skipped-stale':
      return t.main.pushSkippedStale
    default: {
      const entry = t.errors[code as keyof Translation['errors']]
      return entry ? entry(params ?? {}) : t.main.syncErrorFallback
    }
  }
}

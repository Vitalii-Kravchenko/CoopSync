import { Menu, nativeImage, Tray } from 'electron'

// Tray icon as base64 PNG (32×32) — to avoid depending on files and paths in
// dev/prod. A blue circle with the letter "C".
export const TRAY_ICON_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAC1UlEQVR42sWXSWgTURyH52Qzk8m+TJM2aW3SVkmjdqELJNgaW0u1SMWKFEMDQhUtVAuCSw9SCtYeRA+KiJCjelDxYEHw4qHYXhRcEMRTT6JFrAouoD/5T9I0syQvIkwGvkNO38d7M+/lz0lVjZD8DfDK1Mt4fEQ4Q2UI7hx1cEt1cEkbM3iJWjgJT42MQyYIh5sIwE64AhBEZ5rTe4yQ213VMoLo0EYYJbc5q2R4syrCSHkGP3izPa0IMFJudRA+8EI2ohxyGXslTIItzZVLbsnClVNusUngSpVLWztR1T8kU0jeGO7Dls370RDqK0kuUkAxuScURXhqBi2Lz9G+/F7Bpqs34Ym2o9IXwWD3JUyPrWJuHDno96GBOwhWtxeUizbvWoBW7ov16Yrzib/9gBPTKwqxGgqJtU7oyrMBWrm0rQttr98x5QcfrWJk/gtOz/4qGkG0RVMauWilAJ09j96fLyonhp58luVE8sFXXDj5h7kSbk+9Qm62esCp5b5YL1O+/c3HnHyNySs/mauQ6JxSyNcD8t52eulYAQNLnzQBh29/YwYcG15QyM0WNzj1d/6vy58PK4DIl2cDlIeMIQFZuUAB6hOuYfYyM2DwqXYLUnfZWzA58lIhFywucOrjNTCcZAbsfLGiCRi/8Z0ZsC9xXSEXxGyA+mxvZhxAxIHHq4qAmVO/mQF+X7NCLohOcHoXi3/XXmZAz6v1T3Hi2g+mfCB+USPnMwH6F0swdbSkrShl6Uf6b+nKeTMFFLlSvV09aLr3UFfevPgM1aNjaGocwvHhBV3x2dQyWiLJgnLe7KAA9n3uirQiMHoEdWfOy0i9ezQXS7h2BxIdU9gdn0Oi4xxCNd2aF04tN1HA//yZUF8s6kOGJTcJdnDllMsBNLGUSy4H0EMTSznkFYINufmAJhaj5RV8XkAmwp42Ul7BW6GZFWliMUquG0APTSxGyDeYrPgLzz6+akiLLY0AAAAASUVORK5CYII='

// A minimal separate i18n for the tray (doesn't depend on renderer/i18n —
// that lives in a different bundle and would pull in extra stuff). Same set
// of languages as the UI.
type TrayLang = 'en' | 'uk' | 'de' | 'fr' | 'pl' | 'ru' | 'es' | 'pt-BR' | 'tr' | 'zh-CN'

interface TrayStrings {
  tooltip: string
  open: string
  quit: string
}

const TRAY_TRANSLATIONS: Record<TrayLang, TrayStrings> = {
  en: { tooltip: 'CoopSync — co-op save sync', open: 'Open CoopSync', quit: 'Quit' },
  uk: { tooltip: 'CoopSync — синхронізація кооп-сейвів', open: 'Відкрити CoopSync', quit: 'Вийти' },
  de: { tooltip: 'CoopSync — Koop-Speicherstand-Synchronisierung', open: 'CoopSync öffnen', quit: 'Beenden' },
  fr: { tooltip: 'CoopSync — synchronisation des sauvegardes coop', open: 'Ouvrir CoopSync', quit: 'Quitter' },
  pl: { tooltip: 'CoopSync — synchronizacja zapisów kooperacyjnych', open: 'Otwórz CoopSync', quit: 'Zamknij' },
  ru: { tooltip: 'CoopSync — синхронизация кооп-сейвов', open: 'Открыть CoopSync', quit: 'Выйти' },
  es: { tooltip: 'CoopSync — sincronización de partidas cooperativas', open: 'Abrir CoopSync', quit: 'Salir' },
  'pt-BR': { tooltip: 'CoopSync — sincronização de saves cooperativos', open: 'Abrir CoopSync', quit: 'Sair' },
  tr: { tooltip: 'CoopSync — ortak oyun kayıt senkronizasyonu', open: "CoopSync'i Aç", quit: 'Çıkış' },
  'zh-CN': { tooltip: 'CoopSync — 联机存档同步', open: '打开 CoopSync', quit: '退出' }
}

function trayStrings(language: string): TrayStrings {
  return TRAY_TRANSLATIONS[language as TrayLang] ?? TRAY_TRANSLATIONS.en
}

let tray: Tray | null = null
let onOpenCallback: (() => void) | null = null
let onQuitCallback: (() => void) | null = null

function applyTrayLanguage(language: string): void {
  if (!tray) return
  const t = trayStrings(language)
  tray.setToolTip(t.tooltip)
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: t.open, click: () => onOpenCallback?.() },
      { type: 'separator' },
      { label: t.quit, click: () => onQuitCallback?.() }
    ])
  )
}

/** Creates the tray icon. Call once at startup. */
export function createTray(language: string, onOpen: () => void, onQuit: () => void): Tray {
  onOpenCallback = onOpen
  onQuitCallback = onQuit
  const icon = nativeImage.createFromDataURL(`data:image/png;base64,${TRAY_ICON_BASE64}`)
  tray = new Tray(icon)
  tray.on('click', () => onOpenCallback?.())
  applyTrayLanguage(language)
  return tray
}

/** Redraw the tray tooltip and menu in a new language (without recreating the icon). */
export function updateTrayLanguage(language: string): void {
  applyTrayLanguage(language)
}

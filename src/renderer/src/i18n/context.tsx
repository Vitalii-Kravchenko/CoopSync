import { createContext, useContext, useEffect, useState } from 'react'
import { translations } from './registry'
import { isLanguageCode, type LanguageCode, type Translation } from './types'

interface I18nContextValue {
  language: LanguageCode
  setLanguage: (code: LanguageCode) => void
  t: Translation
}

const I18nContext = createContext<I18nContextValue | null>(null)

// Мова інтерфейсу — глобальна для всього застосунку, збережена в app-settings.json.
function I18nProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const [language, setLanguageState] = useState<LanguageCode>('uk')

  useEffect(() => {
    window.api.settings.getGeneral().then((g) => {
      if (isLanguageCode(g.language)) setLanguageState(g.language)
    })
  }, [])

  function setLanguage(code: LanguageCode): void {
    setLanguageState(code)
    void window.api.settings.setLanguage(code)
  }

  return (
    <I18nContext.Provider value={{ language, setLanguage, t: translations[language] }}>
      {children}
    </I18nContext.Provider>
  )
}

function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext)
  if (!ctx) throw new Error('useI18n must be used within I18nProvider')
  return ctx
}

export { I18nProvider, useI18n }

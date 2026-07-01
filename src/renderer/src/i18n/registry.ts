import type { LanguageCode, Translation } from './types'
import { en } from './en'
import { uk } from './uk'
import { de } from './de'
import { fr } from './fr'
import { pl } from './pl'
import { ru } from './ru'
import { es } from './es'
import { ptBR } from './pt-BR'
import { tr } from './tr'
import { zhCN } from './zh-CN'

export const translations: Record<LanguageCode, Translation> = {
  en,
  uk,
  de,
  fr,
  pl,
  ru,
  es,
  'pt-BR': ptBR,
  tr,
  'zh-CN': zhCN
}

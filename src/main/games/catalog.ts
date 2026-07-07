import { join } from 'path'
import { homedir } from 'os'

// Каталог ігор, які підтримує CoopSync.
// Сейви лежать не в папці Steam, а в системних папках — у кожної гри свій шлях.
// Щоб додати нову гру — допиши сюди запис.

export interface SupportedGame {
  /** Steam AppID — за ним визначаємо, чи встановлена гра. */
  appId: string
  /** Назва для показу. */
  name: string
  /** Абсолютний шлях до папки сейвів (залежить від системних змінних). */
  getSavePath: () => string
  /** Можливі назви процесів гри (.exe) — для детекту запуску/виходу. */
  processNames: string[]
  /**
   * Чи готова повноцінна підтримка синку цієї гри.
   * false = ми знаємо гру, але ще не доопрацювали її специфіку
   * (структура сейвів, персонажі тощо) → показуємо "не підтримується".
   */
  ready: boolean
  /**
   * Якщо задано — синкаємо (upload/download) лише файли, чиє ІМ'Я (не шлях)
   * матчиться цим паттерном; папки завжди прохідні. Потрібно для ігор, у яких
   * та сама папка сейвів містить ще й файли облікового запису/платформи
   * (кеш логіну, entitlements тощо) — їх копіювати між різними ПК не можна.
   * Якщо не задано — синкається вся папка як є (як для решти ігор).
   */
  saveFilePattern?: RegExp
}

export const SUPPORTED_GAMES: SupportedGame[] = [
  {
    appId: '526870',
    name: 'Satisfactory',
    getSavePath: () => join(process.env.LOCALAPPDATA ?? '', 'FactoryGame', 'Saved', 'SaveGames'),
    processNames: ['FactoryGame.exe', 'FactoryGameSteam.exe', 'FactoryGameEGS.exe'],
    ready: false
  },
  {
    appId: '413150',
    name: 'Stardew Valley',
    getSavePath: () => join(process.env.APPDATA ?? '', 'StardewValley', 'Saves'),
    processNames: ['Stardew Valley.exe', 'StardewValley.exe', 'StardewModdingAPI.exe'],
    ready: false
  },
  {
    appId: '105600',
    name: 'Terraria',
    getSavePath: () => join(homedir(), 'Documents', 'My Games', 'Terraria'),
    processNames: ['Terraria.exe', 'tModLoader.exe'],
    ready: false
  },
  {
    appId: '1962700',
    name: 'Subnautica 2',
    // Unreal Engine кладе сейви в стандартну "Saved/SaveGames" поруч з LOCALAPPDATA
    // (не Unity LocalLow, як в оригінальній Subnautica). Світ + прогрес усіх
    // гравців — в одному файлі на хості, окремих файлів на гравця нема.
    getSavePath: () => join(process.env.LOCALAPPDATA ?? '', 'Subnautica2', 'Saved', 'SaveGames'),
    processNames: ['Subnautica2.exe', 'Subnautica2-Win64-Shipping.exe'],
    ready: true,
    // Папка SaveGames тут ще й містить файли акаунта/платформи (GPPGuestFile,
    // PlatformEntitlementsCache, RecentLoginPlatform, steam_autocloud.vdf) —
    // вони прив'язані до Steam/GDK-акаунта того ПК і НЕ повинні їхати на чужий
    // комп'ютер. Синкаємо лише самі файли світу.
    saveFilePattern: /^savegame_\d+(_\d+)?\.(sav|bak)$/i
  }
]

// Лише ігри з готовою підтримкою синку (для синку/автосинку/статусів).
export const READY_GAMES = SUPPORTED_GAMES.filter((g) => g.ready)

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
}

export const SUPPORTED_GAMES: SupportedGame[] = [
  {
    appId: '526870',
    name: 'Satisfactory',
    getSavePath: () => join(process.env.LOCALAPPDATA ?? '', 'FactoryGame', 'Saved', 'SaveGames'),
    processNames: ['FactoryGame.exe', 'FactoryGameSteam.exe', 'FactoryGameEGS.exe']
  },
  {
    appId: '413150',
    name: 'Stardew Valley',
    getSavePath: () => join(process.env.APPDATA ?? '', 'StardewValley', 'Saves'),
    processNames: ['Stardew Valley.exe', 'StardewValley.exe', 'StardewModdingAPI.exe']
  },
  {
    appId: '105600',
    name: 'Terraria',
    getSavePath: () => join(homedir(), 'Documents', 'My Games', 'Terraria'),
    processNames: ['Terraria.exe', 'tModLoader.exe']
  }
]

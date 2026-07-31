import { join } from 'path'
import { homedir } from 'os'

// Catalog of games supported by CoopSync.
// Saves don't live in the Steam folder but in system folders — each game has
// its own path.
// To add a new game — append an entry here.

export interface SupportedGame {
  /** Steam AppID — used to detect whether the game is installed. */
  appId: string
  /** Display name. */
  name: string
  /** Absolute path to the saves folder (depends on system env vars). */
  getSavePath: () => string
  /** Possible game process names (.exe) — used to detect launch/exit. */
  processNames: string[]
  /**
   * Whether full sync support for this game is ready.
   * false = we know the game, but haven't finished handling its specifics
   * yet (save structure, characters, etc.) → shown as "not supported".
   */
  ready: boolean
  /**
   * If set — only sync (upload/download) files whose NAME (not path)
   * matches this pattern; folders always pass through. Needed for games
   * where the same saves folder also contains account/platform files
   * (login cache, entitlements, etc.) that must not be copied between
   * different PCs.
   * If not set — the whole folder is synced as-is (like for the other games).
   */
  saveFilePattern?: RegExp
  /**
   * Files (by NAME, same matching rules as saveFilePattern) that live in the
   * same save folder as saveFilePattern's world/progress files, but are
   * per-player preferences (keybinds, graphics/audio options, UI state) —
   * not something a co-op partner should ever see. Synced separately into a
   * bucket namespaced by this user's own GitHub login (see sync.ts's
   * syncPersonalSettings) — follows this one player between their own
   * devices, never touches the shared world content or its version counter.
   * A file matching neither saveFilePattern nor personalFilePattern is
   * simply never synced anywhere (e.g. Subnautica 2's account/platform
   * cache) — same as today.
   */
  personalFilePattern?: RegExp
  /**
   * True while this game's shared/personal file split hasn't been confirmed
   * by real co-op sessions yet — shows a "🧪 experimental" badge instead of
   * (or alongside) the normal ready state, and feeds the confirmation-loop
   * prompt (see ROADMAP.md's "Петля підтвердження"). Undefined/false = no
   * badge, treated as fully confirmed (the games added before this field
   * existed).
   */
  experimental?: boolean
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
    // Unreal Engine puts saves in the standard "Saved/SaveGames" next to
    // LOCALAPPDATA (not Unity LocalLow, like the original Subnautica). The
    // world + progress of all players lives in a single file on the host,
    // there are no per-player world files.
    getSavePath: () => join(process.env.LOCALAPPDATA ?? '', 'Subnautica2', 'Saved', 'SaveGames'),
    processNames: ['Subnautica2.exe', 'Subnautica2-Win64-Shipping.exe'],
    ready: true,
    // The SaveGames folder here also contains account/platform files
    // (GPPGuestFile, PlatformEntitlementsCache, RecentLoginPlatform,
    // steam_autocloud.vdf) — they're tied to that PC's Steam/GDK account and
    // must NOT travel to another computer. We only sync the actual world files.
    saveFilePattern: /^savegame_\d+(_\d+)?\.(sav|bak)$/i,
    // Per-player preference files sitting in the same folder — synced
    // privately (2026-07-30 research): EnhancedInputUserSettings.sav is
    // Unreal Engine's own built-in Enhanced Input plugin save (confirmed via
    // Epic's docs — keybinds/sensitivity/accessibility). SharedGameSettings.sav
    // and FrontendSavedState.sav are unconfirmed game-specific files, but
    // "Shared" here reads as UE convention for "shared across save slots on
    // this PC", not "shared with a co-op partner" — treated as personal as
    // the safe default (worst case a preference doesn't reach the partner,
    // never a data-loss risk). See `experimental` below.
    personalFilePattern: /^(EnhancedInputUserSettings|SharedGameSettings|FrontendSavedState)\.sav$/i,
    // SharedGameSettings.sav's classification isn't confirmed by us — real
    // players' feedback via the confirmation loop decides whether this stays
    // personal (see ROADMAP.md's "Петля підтвердження").
    experimental: true
  }
]

// Only games with ready sync support (used for sync/autosync/statuses).
export const READY_GAMES = SUPPORTED_GAMES.filter((g) => g.ready)

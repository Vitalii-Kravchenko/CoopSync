import type { SyncHistoryEntry } from '../../shared/types'

// Dev-only fixture for the History UI. The dev build runs with its own clean
// userData (separate from the installed app), so its repo clone has no
// history.json — every History screen would stay permanently empty while
// working on the design. When the real list comes back empty in dev, the
// screens show this instead. Call sites are guarded with import.meta.env.DEV,
// so none of this reaches the production bundle.

// Real catalog appIds — Steam posters load for them like for real entries.
const GAMES = [
  { appId: '526870', name: 'Satisfactory' },
  { appId: '413150', name: 'Stardew Valley' },
  { appId: '105600', name: 'Terraria' },
  { appId: '1962700', name: 'Subnautica 2' }
]

// Built once per app session and cached — history.js is called again every
// time the tab regains focus. Rebuilding with a fresh Date.now() on every
// call would give every entry a new timestamp each time (different
// historyKey), making the whole list look "new" and replay the entrance
// animation on every visit. A real history.json is static between real
// pushes, so the fixture needs to behave the same way.
let cached: SyncHistoryEntry[] | null = null

// Real history is capped at this many entries (MAX_HISTORY_ENTRIES in
// main/services/sync.ts) — the fixture uses the same cap so "Show more"/
// "end of history" get tested against the actual worst case, not an
// arbitrary number.
const ENTRY_COUNT = 50

/** Fake pushes spanning many days — enough to click through several
 *  "Show more" batches and reach the end, and to exercise the filter and
 *  both avatar variants (selfLogin gets the real local avatar, the fake
 *  friend gets the placeholder). */
export function devHistoryMock(selfLogin: string): SyncHistoryEntry[] {
  if (cached) return cached

  const players = [selfLogin, 'PixelPartner']
  const version: Record<string, number> = {}
  const list: SyncHistoryEntry[] = []
  // Oldest → newest, then reversed: versions must grow with time.
  let ts = Date.now() - ENTRY_COUNT * 5 * 60 * 60 * 1000
  for (let i = 0; i < ENTRY_COUNT; i++) {
    const game = GAMES[(i * 3) % GAMES.length]
    version[game.appId] = (version[game.appId] ?? 0) + 1
    list.push({
      appId: game.appId,
      gameName: game.name,
      version: version[game.appId],
      updatedBy: players[(i * 5 + 1) % 3 === 0 ? 0 : 1],
      updatedAt: new Date(ts).toISOString()
    })
    ts += (2 + ((i * 13) % 6)) * 60 * 60 * 1000
  }
  cached = list.reverse()
  return cached
}

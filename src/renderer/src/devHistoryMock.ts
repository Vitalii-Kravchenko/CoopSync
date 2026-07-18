import type { SyncHistoryEntry } from '../../shared/types'

// Dev-only fixture for the History UI. The dev build runs with its own clean
// userData (separate from the installed app), so its repo clone has no
// history.json — every History screen would stay permanently empty while
// working on the design. When the real list comes back empty in dev, the
// screens show this instead. Call sites are guarded with import.meta.env.DEV,
// so none of this reaches the production bundle.

// Real catalog appIds — Steam posters load for them like for real entries.
// Subnautica 2 first and heavily weighted below — this is the fixture the
// pagination UI gets eyeballed against, so it should look like one game
// someone actually plays a lot, with the others as occasional variety, not
// four games in perfect rotation.
const GAMES = [
  { appId: '1962700', name: 'Subnautica 2' },
  { appId: '526870', name: 'Satisfactory' },
  { appId: '413150', name: 'Stardew Valley' },
  { appId: '105600', name: 'Terraria' }
]

// Built once per app session and cached — history.js is called again every
// time the tab regains focus. Rebuilding with a fresh Date.now() on every
// call would give every entry a new timestamp each time (different
// historyKey), making the whole list look "new" and replay the entrance
// animation on every visit. A real history.json is static between real
// pushes, so the fixture needs to behave the same way.
let cached: SyncHistoryEntry[] | null = null

// Real history has no cap (main/services/sync.ts keeps every push forever).
// 240 lands around 10-12 pages at the row counts a normal desktop window
// gets (see useRowCapacity's tiers) — enough to click through several pages
// and hit the "…" ellipsis, without being a completely arbitrary number.
const ENTRY_COUNT = 240

/** Fake pushes spanning many days — enough to click through several pages
 *  of pagination and reach the end, and to exercise the filter and both
 *  avatar variants (selfLogin gets the real local avatar, the fake friend
 *  gets the placeholder). */
export function devHistoryMock(selfLogin: string): SyncHistoryEntry[] {
  if (cached) return cached

  const players = [selfLogin, 'PixelPartner']
  const version: Record<string, number> = {}
  const list: SyncHistoryEntry[] = []
  // Oldest → newest, then reversed: versions must grow with time.
  let ts = Date.now() - ENTRY_COUNT * 5 * 60 * 60 * 1000
  for (let i = 0; i < ENTRY_COUNT; i++) {
    // 3 out of every 4 pushes are Subnautica 2; the 4th rotates through the
    // other three games.
    const game = i % 4 === 3 ? GAMES[1 + (Math.floor(i / 4) % 3)] : GAMES[0]
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

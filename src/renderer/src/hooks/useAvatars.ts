import { useEffect, useState } from 'react'

// Avatars fetched this session, keyed by login. Module-level, so the History
// tab and every game's detail page share one cache instead of each refetching
// the same people — .meta avatars only change when someone re-uploads their
// picture, which is rare enough that once per app launch is plenty.
const cache: Record<string, string> = {}
// Logins we already asked about (successfully) that simply have no avatar in
// the repo — without this, every render cycle would refetch them forever.
const known = new Set<string>()

/**
 * Avatars for history rows, keyed by login. My own comes from local settings
 * (always fresher than the repo copy — same rule as FriendsScreen), everyone
 * else's from .meta/avatars in the shared repo. Logins missing from the
 * result just render the placeholder.
 *
 * @param refreshKey Pass the same syncVersion App.tsx already threads
 *   through for this purpose. `known`/`cache` above used to mean a friend's
 *   avatar, once fetched, was NEVER checked again for the rest of the app's
 *   run (by design — see their comments) — so a friend changing their
 *   picture mid-session only ever showed up after a full restart. Any bump
 *   here (a real sync happened, including the ~2min background check) now
 *   re-fetches everyone currently visible instead of trusting that cache.
 */
export function useAvatars(
  logins: string[],
  selfLogin: string,
  selfAvatar: string | null,
  refreshKey = 0
): Record<string, string> {
  const [avatars, setAvatars] = useState<Record<string, string>>(() => ({ ...cache }))

  // Stable key — the effect re-runs only when the set of people actually
  // changes, not on every parent render with a fresh array instance.
  const key = [...new Set(logins)].sort().join(',')

  useEffect(() => {
    const targets = key.split(',').filter((l) => l && l !== selfLogin)
    // refreshKey === 0 on mount — nothing to have changed yet, so the
    // original "only fetch what we've genuinely never seen" behavior still
    // applies there. Once it's bumped at least once, always re-check.
    const missing = refreshKey > 0 ? targets : targets.filter((l) => !known.has(l) && !(l in cache))
    if (missing.length === 0) return
    let cancelled = false
    window.api.repo
      .getAvatars(missing)
      .then((fetched) => {
        Object.assign(cache, fetched)
        for (const l of missing) known.add(l)
        if (!cancelled) setAvatars({ ...cache })
      })
      .catch(() => {
        // Not critical (offline etc.) — rows keep the placeholder, and since
        // `known` wasn't touched, the next visit will simply retry.
      })
    return () => {
      cancelled = true
    }
  }, [key, selfLogin, refreshKey])

  return selfAvatar ? { ...avatars, [selfLogin]: selfAvatar } : avatars
}

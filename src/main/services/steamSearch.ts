import type { SteamSearchResult } from '../../shared/types'

// Public, no-auth search across the whole Steam store (not installed games —
// used for the "Support" → "I want a game added" button).
const SEARCH_URL = 'https://store.steampowered.com/api/storesearch/'

interface StoreSearchItem {
  id: number
  name: string
  // Newer Steam games are served from hash-versioned paths
  // (store_item_assets/...), so the image URL can no longer always be built
  // dynamically from the appId alone — we take the ready-made link directly
  // from the search response.
  tiny_image?: string
}

interface StoreSearchResponse {
  items?: StoreSearchItem[]
}

/** Search games in the Steam store by name. Empty array if the query is too short or nothing was found. */
export async function searchSteamStore(term: string): Promise<SteamSearchResult[]> {
  const query = term.trim()
  if (query.length < 2) return []

  const url = `${SEARCH_URL}?term=${encodeURIComponent(query)}&l=english&cc=US`
  const res = await fetch(url).catch(() => null)
  if (!res || !res.ok) return []

  const data = (await res.json().catch(() => null)) as StoreSearchResponse | null
  if (!data?.items) return []

  return data.items
    .slice(0, 8)
    .map((item) => ({ appId: String(item.id), name: item.name, imageUrl: item.tiny_image }))
}

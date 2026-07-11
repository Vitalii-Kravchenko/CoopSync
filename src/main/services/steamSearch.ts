import type { SteamSearchResult } from '../../shared/types'

// Публічний, без-авторизаційний пошук по всьому Steam-магазину (не по
// встановлених іграх — для кнопки "Підтримка" → "Хочу, щоб додали гру").
const SEARCH_URL = 'https://store.steampowered.com/api/storesearch/'

interface StoreSearchItem {
  id: number
  name: string
  // Новіші ігри Steam роздає з хеш-версіонованих шляхів (store_item_assets/...),
  // тому дінамічно зібрати URL картинки з самого appId вже не завжди можна —
  // беремо готове посилання прямо з відповіді пошуку.
  tiny_image?: string
}

interface StoreSearchResponse {
  items?: StoreSearchItem[]
}

/** Пошук ігор у Steam-магазині за назвою. Порожній масив, якщо запит закороткий чи нічого не знайдено. */
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

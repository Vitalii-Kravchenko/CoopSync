import { useEffect, useMemo, useState } from 'react'
import { colors } from '../theme'
import GameCard from '../components/GameCard'
import type { DetectedGame, CatalogGame, GameSyncStatus } from '../../../shared/types'

function MainScreen(): React.JSX.Element {
  const [installed, setInstalled] = useState<DetectedGame[]>([])
  const [catalog, setCatalog] = useState<CatalogGame[]>([])
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState<string | null>(null)
  const [banner, setBanner] = useState<{ text: string; kind: 'success' | 'info' | 'error' } | null>(
    null
  )
  const [syncStatuses, setSyncStatuses] = useState<Record<string, GameSyncStatus>>({})

  useEffect(() => {
    Promise.all([window.api.games.list(), window.api.games.catalog()]).then(([list, cat]) => {
      setInstalled(list)
      setCatalog(cat)
      setLoading(false)
    })
    // Статуси тягнемо окремо — вони повільніші (clone/pull сховища).
    void loadStatuses()
  }, [])

  async function loadStatuses(): Promise<void> {
    try {
      const list = await window.api.sync.statuses()
      const map: Record<string, GameSyncStatus> = {}
      for (const s of list) map[s.appId] = s
      setSyncStatuses(map)
    } catch {
      // Статуси не критичні для показу карток — мовчки ігноруємо.
    }
  }

  // Невстановлені = каталог мінус встановлені.
  const notInstalled = useMemo(() => {
    const installedIds = new Set(installed.map((g) => g.appId))
    return catalog.filter((g) => !installedIds.has(g.appId))
  }, [installed, catalog])

  const q = query.trim().toLowerCase()
  const filteredInstalled = installed.filter((g) => g.name.toLowerCase().includes(q))
  const filteredNotInstalled = notInstalled.filter((g) => g.name.toLowerCase().includes(q))

  // Банер сам зникає через 5 секунд.
  useEffect(() => {
    if (!banner) return
    const t = setTimeout(() => setBanner(null), 5000)
    return () => clearTimeout(t)
  }, [banner])

  async function handleSync(appId: string, action: 'upload' | 'download'): Promise<void> {
    const status = syncStatuses[appId]?.status

    // Випадки, коли діяти не треба — лише акуратно повідомляємо (без виклику синку).
    if (status === 'synced') {
      setBanner({ text: 'Версії збігаються — синхронізувати не потрібно', kind: 'info' })
      return
    }
    if (action === 'download' && (status === 'not-uploaded' || status === 'no-saves')) {
      setBanner({ text: 'У сховищі ще немає сейвів цієї гри', kind: 'error' })
      return
    }
    if (action === 'upload' && (status === 'cloud-only' || status === 'no-saves')) {
      setBanner({ text: 'Локально немає сейвів для вивантаження', kind: 'error' })
      return
    }

    setSyncing(appId)
    setBanner(null)
    try {
      const msg =
        action === 'upload'
          ? await window.api.sync.upload(appId)
          : await window.api.sync.download(appId)
      setBanner({ text: msg, kind: 'success' })
      // Сейви могли змінитися — оновлюємо ігри та статуси.
      setInstalled(await window.api.games.list())
      await loadStatuses()
    } catch (e) {
      const raw = e instanceof Error ? e.message : 'Помилка синхронізації'
      // Прибираємо технічний префікс "Error invoking remote method '...': Error:".
      const clean = raw.replace(/^Error invoking remote method '[^']+':\s*(Error:\s*)?/, '')
      setBanner({ text: clean, kind: 'error' })
    } finally {
      setSyncing(null)
    }
  }

  return (
    <div style={styles.screen}>
      <div style={styles.searchWrap}>
        <span style={styles.searchIcon}>🔍</span>
        <input
          style={styles.search}
          placeholder="Пошук гри..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      {loading && <div style={styles.muted}>Шукаю ігри…</div>}

      {!loading && (
        <>
          <div style={styles.sectionTitle}>Встановлені ігри</div>
          {filteredInstalled.length > 0 ? (
            <div style={styles.grid}>
              {filteredInstalled.map((g) => (
                <GameCard
                  key={g.appId}
                  appId={g.appId}
                  name={g.name}
                  installed
                  syncStatus={syncStatuses[g.appId]?.status}
                  localVersion={syncStatuses[g.appId]?.localVersion}
                  remoteVersion={syncStatuses[g.appId]?.remoteVersion}
                  busy={syncing === g.appId}
                  onUpload={() => handleSync(g.appId, 'upload')}
                  onDownload={() => handleSync(g.appId, 'download')}
                />
              ))}
            </div>
          ) : (
            <div style={styles.muted}>Нічого не знайдено</div>
          )}

          <div style={{ ...styles.sectionTitle, marginTop: 34 }}>Усі підтримувані ігри</div>
          {filteredNotInstalled.length > 0 ? (
            <div style={styles.grid}>
              {filteredNotInstalled.map((g) => (
                <GameCard key={g.appId} appId={g.appId} name={g.name} installed={false} />
              ))}
            </div>
          ) : (
            <div style={styles.muted}>Нічого не знайдено</div>
          )}
        </>
      )}

      {banner && (
        <div
          style={{
            ...styles.banner,
            background:
              banner.kind === 'error'
                ? colors.error
                : banner.kind === 'info'
                  ? colors.accent
                  : colors.success
          }}
        >
          {banner.text}
        </div>
      )}
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  screen: { flex: 1, overflowY: 'auto', padding: '24px 32px 40px' },
  searchWrap: { position: 'relative', marginBottom: 28 },
  searchIcon: {
    position: 'absolute',
    left: 18,
    top: '50%',
    transform: 'translateY(-50%)',
    color: colors.muted,
    fontSize: 16
  },
  search: {
    width: '100%',
    height: 52,
    padding: '0 18px 0 50px',
    border: `1px solid ${colors.border}`,
    borderRadius: 11,
    background: colors.bgDark,
    color: colors.text,
    fontSize: 15,
    outline: 'none'
  },
  sectionTitle: { fontSize: 18, fontWeight: 700, color: colors.text, marginBottom: 16 },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(168px, 1fr))',
    gap: 20
  },
  muted: { color: colors.muted, fontSize: 14 },
  banner: {
    position: 'fixed',
    bottom: 22,
    left: '50%',
    transform: 'translateX(-50%)',
    padding: '12px 22px',
    borderRadius: 10,
    color: '#11111b',
    fontWeight: 600,
    fontSize: 14,
    boxShadow: '0 10px 30px rgba(0,0,0,0.5)',
    zIndex: 100
  }
}

export default MainScreen

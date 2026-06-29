import { useEffect, useMemo, useState } from 'react'
import { colors } from '../theme'
import GameCard from '../components/GameCard'
import type { DetectedGame, CatalogGame } from '../../../shared/types'

function MainScreen(): React.JSX.Element {
  const [installed, setInstalled] = useState<DetectedGame[]>([])
  const [catalog, setCatalog] = useState<CatalogGame[]>([])
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([window.api.games.list(), window.api.games.catalog()]).then(([list, cat]) => {
      setInstalled(list)
      setCatalog(cat)
      setLoading(false)
    })
  }, [])

  // Невстановлені = каталог мінус встановлені.
  const notInstalled = useMemo(() => {
    const installedIds = new Set(installed.map((g) => g.appId))
    return catalog.filter((g) => !installedIds.has(g.appId))
  }, [installed, catalog])

  const q = query.trim().toLowerCase()
  const filteredInstalled = installed.filter((g) => g.name.toLowerCase().includes(q))
  const filteredNotInstalled = notInstalled.filter((g) => g.name.toLowerCase().includes(q))

  function handleUpload(name: string): void {
    // Реальна логіка — наступний крок (3a). Поки заглушка.
    console.log('upload', name)
  }
  function handleDownload(name: string): void {
    console.log('download', name)
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
                  saveFound={g.saveFound}
                  onUpload={() => handleUpload(g.name)}
                  onDownload={() => handleDownload(g.name)}
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
  muted: { color: colors.muted, fontSize: 14 }
}

export default MainScreen

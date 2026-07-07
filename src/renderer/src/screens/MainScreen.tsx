import { useEffect, useMemo, useState } from 'react'
import { colors, fonts, radii, shadows } from '../theme'
import { useI18n } from '../i18n'
import GameCard from '../components/GameCard'
import CloudWarningBanner from '../components/CloudWarningBanner'
import { SearchIcon, UploadIcon, DownloadIcon } from '../components/icons'
import type { InstalledGame, CatalogGame, GameSyncStatus } from '../../../shared/types'

interface BannerState {
  text: string
  kind: 'success' | 'info' | 'error'
  /** Іконка синку (свій UploadIcon/DownloadIcon), якщо банер про push/pull. */
  icon?: 'upload' | 'download'
}

function MainScreen(): React.JSX.Element {
  const { t } = useI18n()
  const [installed, setInstalled] = useState<InstalledGame[]>([])
  const [catalog, setCatalog] = useState<CatalogGame[]>([])
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState<string | null>(null)
  const [banner, setBanner] = useState<BannerState | null>(null)
  const [syncStatuses, setSyncStatuses] = useState<Record<string, GameSyncStatus>>({})
  // Попередження про Steam Cloud: показуємо раз на запуск, поки не закриють хрестиком.
  const [showCloudWarning, setShowCloudWarning] = useState(false)

  useEffect(() => {
    Promise.all([window.api.games.allInstalled(), window.api.games.catalog()]).then(
      ([list, cat]) => {
        setInstalled(list)
        setCatalog(cat)
        setLoading(false)
      }
    )
    // Статуси тягнемо окремо — вони повільніші (clone/pull сховища).
    void loadStatuses()
    window.api.settings.getGeneral().then((s) => setShowCloudWarning(s.showCloudWarning))
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

  // Реакція на автосинхронізацію (запуск/вихід гри у фоні).
  useEffect(() => {
    return window.api.watcher.onAutoSync((e) => {
      if (e.ok) {
        // Показуємо реальний результат синку, а не фіксований текст.
        setBanner({
          text: `${e.name}: ${e.message}`,
          kind: 'success',
          icon: e.action === 'pull' ? 'download' : 'upload'
        })
      }
      // Стан міг змінитися — оновлюємо ігри та статуси.
      void loadStatuses()
      window.api.games.allInstalled().then(setInstalled)
    })
  }, [])

  // Множина встановлених appId — щоб картки каталогу нижче показували правильний
  // стан незалежно від того, чи гра вже встановлена (раніше секцію "Усі підтримувані"
  // фільтрували, виключаючи встановлені — через це встановлена (єдина) ready-гра
  // зникала з неї повністю, що бентежило: ніби вона там "не підтримується").
  const installedIds = useMemo(() => new Set(installed.map((g) => g.appId)), [installed])

  const q = query.trim().toLowerCase()
  const filteredInstalled = installed.filter((g) => g.name.toLowerCase().includes(q))
  const filteredCatalog = catalog.filter((g) => g.name.toLowerCase().includes(q))

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
      setBanner({ text: t.main.alreadySynced, kind: 'info' })
      return
    }
    if (action === 'download' && (status === 'not-uploaded' || status === 'no-saves')) {
      setBanner({ text: t.main.noSavesInCloud, kind: 'error' })
      return
    }
    if (action === 'upload' && (status === 'cloud-only' || status === 'no-saves')) {
      setBanner({ text: t.main.noLocalSaves, kind: 'error' })
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
      setInstalled(await window.api.games.allInstalled())
      await loadStatuses()
    } catch (e) {
      const raw = e instanceof Error ? e.message : t.main.syncErrorFallback
      // Прибираємо технічний префікс "Error invoking remote method '...': Error:".
      const clean = raw.replace(/^Error invoking remote method '[^']+':\s*(Error:\s*)?/, '')
      setBanner({ text: clean, kind: 'error' })
    } finally {
      setSyncing(null)
    }
  }

  return (
    <div style={styles.screen}>
      {showCloudWarning && <CloudWarningBanner onDismiss={() => setShowCloudWarning(false)} />}

      <div style={styles.searchWrap}>
        <span style={styles.searchIcon}>
          <SearchIcon size={16} color={colors.text3} />
        </span>
        <input
          className="input-field"
          style={styles.search}
          placeholder={t.main.searchPlaceholder}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      {loading && <div style={styles.muted}>{t.main.loadingGames}</div>}

      {!loading && (
        <>
          <div style={styles.sectionTitle}>{t.main.installedGames}</div>
          {filteredInstalled.length > 0 ? (
            <div style={styles.grid}>
              {filteredInstalled.map((g) => (
                <GameCard
                  key={g.appId}
                  appId={g.appId}
                  name={g.name}
                  installed
                  supported={g.supported}
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
            <div style={styles.muted}>{t.main.nothingFound}</div>
          )}

          <div style={{ ...styles.sectionTitle, marginTop: 34 }}>{t.main.allSupportedGames}</div>
          {filteredCatalog.length > 0 ? (
            <div style={styles.grid}>
              {filteredCatalog.map((g) =>
                installedIds.has(g.appId) ? (
                  <GameCard
                    key={g.appId}
                    appId={g.appId}
                    name={g.name}
                    installed
                    supported
                    syncStatus={syncStatuses[g.appId]?.status}
                    localVersion={syncStatuses[g.appId]?.localVersion}
                    remoteVersion={syncStatuses[g.appId]?.remoteVersion}
                    busy={syncing === g.appId}
                    onUpload={() => handleSync(g.appId, 'upload')}
                    onDownload={() => handleSync(g.appId, 'download')}
                  />
                ) : (
                  <GameCard key={g.appId} appId={g.appId} name={g.name} installed={false} />
                )
              )}
            </div>
          ) : (
            <div style={styles.muted}>{t.main.nothingFound}</div>
          )}
        </>
      )}

      {banner && (
        <div
          style={{
            ...styles.banner,
            borderColor:
              banner.kind === 'error' ? colors.dangerBd : banner.kind === 'info' ? colors.infoBd : colors.successBd
          }}
        >
          {banner.icon ? (
            banner.icon === 'upload' ? (
              <UploadIcon size={14} color={colors.success} />
            ) : (
              <DownloadIcon size={14} color={colors.success} />
            )
          ) : (
            <span
              style={{
                ...styles.bannerDot,
                background:
                  banner.kind === 'error' ? colors.danger : banner.kind === 'info' ? colors.info : colors.success
              }}
            />
          )}
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
    display: 'flex'
  },
  search: {
    width: '100%',
    height: 48,
    padding: '0 18px 0 46px',
    border: `1px solid ${colors.borderDefault}`,
    borderRadius: radii.md,
    background: colors.bgInset,
    color: colors.text1,
    fontFamily: fonts.body,
    fontSize: 14,
    boxShadow: 'inset 0 1px 2px rgba(0,0,0,.3)',
    outline: 'none'
  },
  sectionTitle: {
    fontFamily: fonts.display,
    fontSize: 17,
    fontWeight: 600,
    color: colors.text1,
    marginBottom: 16
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(210px, 1fr))',
    gap: 20
  },
  muted: { color: colors.text3, fontSize: 14 },
  banner: {
    position: 'fixed',
    bottom: 22,
    left: '50%',
    transform: 'translateX(-50%)',
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '12px 20px',
    borderRadius: radii.md,
    border: '1px solid',
    background: colors.bgOverlay,
    color: colors.text1,
    fontFamily: fonts.body,
    fontWeight: 600,
    fontSize: 13.5,
    boxShadow: shadows.sh3,
    zIndex: 100
  },
  bannerDot: { width: 6, height: 6, borderRadius: '50%', flexShrink: 0 }
}

export default MainScreen

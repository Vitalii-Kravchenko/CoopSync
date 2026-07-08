import { useEffect, useMemo, useState } from 'react'
import { colors, fonts, radii, shadows } from '../theme'
import { useI18n } from '../i18n'
import { describeError, describeSyncResult } from '../errors'
import GameCard from '../components/GameCard'
import CloudWarningBanner from '../components/CloudWarningBanner'
import { SearchIcon, UploadIcon, DownloadIcon } from '../components/icons'
import type { InstalledGame, CatalogGame, GameSyncStatus } from '../../../shared/types'

interface BannerState {
  text: string
  kind: 'success' | 'info' | 'error' | 'warning'
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
  // Якщо перевірка статусів впала (мережа, гіт) — показуємо це явно, а не мовчимо
  // вічним "Перевіряю..." на картках без жодного пояснення.
  const [statusesError, setStatusesError] = useState<string | null>(null)

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
      setStatusesError(null)
    } catch (e) {
      setStatusesError(describeError(e, t, t.main.statusesError))
    }
  }

  // Реакція на автосинхронізацію (запуск/вихід гри у фоні).
  useEffect(() => {
    return window.api.watcher.onAutoSync((e) => {
      const text = `${e.name}: ${describeSyncResult(e.code, e.params, t)}`
      if (e.action === 'push-skipped') {
        // Свідомо пропущений автопуш (конфлікт версій) — це не помилка,
        // але й не мовчати можна: тут людина могла б втратити прогрес друга.
        setBanner({ text, kind: 'warning' })
      } else if (e.ok) {
        setBanner({ text, kind: 'success', icon: e.action === 'pull' ? 'download' : 'upload' })
      } else {
        // Раніше помилки автосинку мовчки губились — тепер теж показуємо їх.
        setBanner({ text, kind: 'error' })
      }
      // Стан міг змінитися — оновлюємо ігри та статуси.
      void loadStatuses()
      window.api.games.allInstalled().then(setInstalled)
    })
  }, [t])

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
      const result =
        action === 'upload'
          ? await window.api.sync.upload(appId)
          : await window.api.sync.download(appId)
      const code = action === 'upload' ? 'upload-success' : 'download-success'
      setBanner({ text: describeSyncResult(code, { version: String(result.version) }, t), kind: 'success' })
      // Сейви могли змінитися — оновлюємо ігри та статуси.
      setInstalled(await window.api.games.allInstalled())
      await loadStatuses()
    } catch (e) {
      setBanner({ text: describeError(e, t, t.main.syncErrorFallback), kind: 'error' })
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

      {statusesError && (
        <div style={styles.statusesError}>
          <span>{statusesError}</span>
          <button style={styles.retryLink} onClick={() => void loadStatuses()}>
            {t.main.retry}
          </button>
        </div>
      )}

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
                  lastSyncAt={syncStatuses[g.appId]?.lastSyncAt}
                  sizeBytes={syncStatuses[g.appId]?.sizeBytes}
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
              banner.kind === 'error'
                ? colors.dangerBd
                : banner.kind === 'warning'
                  ? colors.warningBd
                  : banner.kind === 'info'
                    ? colors.infoBd
                    : colors.successBd
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
                  banner.kind === 'error'
                    ? colors.danger
                    : banner.kind === 'warning'
                      ? colors.warning
                      : banner.kind === 'info'
                        ? colors.info
                        : colors.success
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
  statusesError: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    marginBottom: 20,
    padding: '10px 14px',
    borderRadius: radii.md,
    border: `1px solid ${colors.warningBd}`,
    background: colors.warningBg,
    color: colors.text1,
    fontSize: 13
  },
  retryLink: {
    background: 'transparent',
    border: 'none',
    color: colors.cy,
    cursor: 'pointer',
    fontSize: 13,
    fontWeight: 600,
    padding: 0,
    textDecoration: 'underline'
  },
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

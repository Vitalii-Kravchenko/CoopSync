import { useEffect, useMemo, useRef, useState } from 'react'
import { colors, fonts, radii } from '../theme'
import { useI18n } from '../i18n'
import { describeError, describeSyncResult } from '../errors'
import GameCard from '../components/GameCard'
import CloudWarningBanner from '../components/CloudWarningBanner'
import type { BannerState } from '../components/Banner'
import { SearchIcon } from '../components/icons'
import type { InstalledGame, CatalogGame, GameSyncStatus } from '../../../shared/types'

interface Props {
  /** Чи активна зараз ця вкладка (MainScreen лишається змонтованим у фоні,
   *  навіть коли відкрита інша вкладка). */
  active: boolean
  /** Змінюється, коли сховище видалене/створене заново в Settings, або після
   *  реальної синхронізації (push/pull) — сигнал перечитати статуси синку
   *  (MainScreen лишається змонтованим у фоні). */
  syncVersion: number
  /** Викликати після реального push (ручного чи автоматичного) — сигнал для
   *  HistoryScreen (теж лишається змонтованим у фоні) перечитати історію. */
  onSynced: () => void
  /** Показати глобальний банер (рендериться в App — видимий на всіх вкладках). */
  onBanner: (banner: BannerState) => void
}

function MainScreen({ active, syncVersion, onSynced, onBanner }: Props): React.JSX.Element {
  const { t } = useI18n()
  const [installed, setInstalled] = useState<InstalledGame[]>([])
  const [catalog, setCatalog] = useState<CatalogGame[]>([])
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState<string | null>(null)
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

  // syncVersion === 0 на монтуванні — той випадок вже покриває ефект вище.
  useEffect(() => {
    if (syncVersion > 0) {
      void loadStatuses()
      window.api.games.allInstalled().then(setInstalled)
    }
  }, [syncVersion])

  // При поверненні на вкладку "Ігри" перечитуємо статуси — вони могли застаріти,
  // поки вкладка була неактивна (напр. друг запушив свою версію). Перший рендер
  // (active вже true на монтуванні) пропускаємо — його покриває ефект монтування вище.
  const skipFirstActive = useRef(true)
  useEffect(() => {
    if (skipFirstActive.current) {
      skipFirstActive.current = false
      return
    }
    if (active) void loadStatuses()
  }, [active])

  async function loadStatuses(): Promise<void> {
    try {
      const list = await window.api.sync.statuses()
      const map: Record<string, GameSyncStatus> = {}
      for (const s of list) map[s.appId] = s
      setSyncStatuses(map)
      setStatusesError(null)
    } catch (e) {
      // Не лишаємо застарілі статуси (напр. від видаленого репо) поруч із
      // помилкою — картки мають впасти в "Перевіряю...", а не брехати старими даними.
      setSyncStatuses({})
      setStatusesError(describeError(e, t, t.main.statusesError))
    }
  }

  // Множина встановлених appId — щоб картки каталогу нижче показували правильний
  // стан незалежно від того, чи гра вже встановлена (раніше секцію "Усі підтримувані"
  // фільтрували, виключаючи встановлені — через це встановлена (єдина) ready-гра
  // зникала з неї повністю, що бентежило: ніби вона там "не підтримується").
  const installedIds = useMemo(() => new Set(installed.map((g) => g.appId)), [installed])

  const q = query.trim().toLowerCase()
  const filteredInstalled = installed.filter((g) => g.name.toLowerCase().includes(q))
  const filteredCatalog = catalog.filter((g) => g.name.toLowerCase().includes(q))

  async function handleSync(appId: string, action: 'upload' | 'download'): Promise<void> {
    const status = syncStatuses[appId]?.status

    // Випадки, коли діяти не треба — лише акуратно повідомляємо (без виклику синку).
    if (status === 'synced') {
      onBanner({ text: t.main.alreadySynced, kind: 'info' })
      return
    }
    if (action === 'download' && (status === 'not-uploaded' || status === 'no-saves')) {
      onBanner({ text: t.main.noSavesInCloud, kind: 'error' })
      return
    }
    if (action === 'upload' && (status === 'cloud-only' || status === 'no-saves')) {
      onBanner({ text: t.main.noLocalSaves, kind: 'error' })
      return
    }

    setSyncing(appId)
    try {
      const result =
        action === 'upload'
          ? await window.api.sync.upload(appId)
          : await window.api.sync.download(appId)
      if (action === 'upload' && result.pushed === false) {
        // Хеш співпав з хмарою в останній момент (напр. друг щойно запушив те
        // саме) — реального вивантаження не було, кажемо це чесно.
        onBanner({ text: describeSyncResult('push-skipped-nochange', undefined, t), kind: 'info' })
      } else {
        const code = action === 'upload' ? 'upload-success' : 'download-success'
        onBanner({ text: describeSyncResult(code, { version: String(result.version) }, t), kind: 'success' })
        // І push (новий запис), і pull (git pull міг підтягнути чужий новий
        // запис) — вартий того, щоб HistoryScreen перечитав дані.
        onSynced()
      }
      // Сейви могли змінитися — оновлюємо ігри та статуси.
      setInstalled(await window.api.games.allInstalled())
      await loadStatuses()
    } catch (e) {
      onBanner({ text: describeError(e, t, t.main.syncErrorFallback), kind: 'error' })
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
                    lastSyncAt={syncStatuses[g.appId]?.lastSyncAt}
                    sizeBytes={syncStatuses[g.appId]?.sizeBytes}
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
  }
}

export default MainScreen

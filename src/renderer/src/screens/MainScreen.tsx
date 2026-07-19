import { useEffect, useMemo, useRef, useState } from 'react'
import { colors, fonts, radii } from '../theme'
import { useI18n } from '../i18n'
import { describeError, describeSyncResult } from '../errors'
import GameCard from '../components/GameCard'
import CloudWarningBanner from '../components/CloudWarningBanner'
import UpdateAvailableBanner from '../components/UpdateAvailableBanner'
import type { BannerState } from '../components/Banner'
import { SearchIcon } from '../components/icons'
import GameDetailScreen from './GameDetailScreen'
import type {
  AuthUser,
  InstalledGame,
  CatalogGame,
  GameSyncStatus,
  UpdateStatus
} from '../../../shared/types'

interface Props {
  /** Whether this tab is currently active (MainScreen stays mounted in the
   *  background even when another tab is open). */
  active: boolean
  /** Changes when the repo is deleted/recreated in Settings, or after a
   *  real sync (push/pull) — a signal to reread sync statuses
   *  (MainScreen stays mounted in the background). */
  syncVersion: number
  /** Bumped every time the Sidebar's "Games" item is clicked, even if 'main'
   *  is already the active screen — backs out of a game's detail sub-view. */
  resetSignal: number
  /** Call after a real push (manual or automatic) — a signal for
   *  HistoryScreen (also stays mounted in the background) to reread history. */
  onSynced: () => void
  /** Show a global banner (rendered in App — visible on all tabs). */
  onBanner: (banner: BannerState) => void
  /** Called with the game/version pairs just displayed — ONLY while this tab
   *  is actually active (see loadStatuses) — clears their Games nav badge. */
  onGamesSeen: (entries: Array<{ appId: string; version: number }>) => void
  /** Passed through to GameDetailScreen — its history shows player avatars. */
  user: AuthUser
  avatarDataUrl: string | null
  /** appIds with a background autopush currently in flight — passed through
   *  to GameDetailScreen to block "Restore" for the selected game while it's
   *  in this set (see App.tsx's onAutoSync handler). */
  autoPushPending: Set<string>
}

function MainScreen({
  active,
  syncVersion,
  resetSignal,
  onSynced,
  onBanner,
  onGamesSeen,
  user,
  avatarDataUrl,
  autoPushPending
}: Props): React.JSX.Element {
  const { t } = useI18n()
  const [installed, setInstalled] = useState<InstalledGame[]>([])
  const [catalog, setCatalog] = useState<CatalogGame[]>([])
  const [query, setQuery] = useState('')
  // Selected game -> show GameDetailScreen (its own sync history) instead of the grid.
  const [selectedGame, setSelectedGame] = useState<{ appId: string; name: string } | null>(null)
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState<string | null>(null)
  const [syncStatuses, setSyncStatuses] = useState<Record<string, GameSyncStatus>>({})
  // Steam Cloud warning: shown once per launch, until dismissed via the close icon.
  const [showCloudWarning, setShowCloudWarning] = useState(false)
  // Update banner: mirrors the same 'updater:status' events Settings listens to,
  // so it's visible without opening Settings. Dismissible, same as the Cloud warning.
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus>({ state: 'idle' })
  const [updateBannerDismissed, setUpdateBannerDismissed] = useState(false)
  // If the status check fails (network, git) — show it explicitly instead of
  // silently leaving cards stuck on "Checking..." with no explanation.
  const [statusesError, setStatusesError] = useState<string | null>(null)
  // Same for the game list itself — previously a failure here (e.g. no
  // permissions on the Steam library folder) left "Loading games..." forever.
  const [gamesError, setGamesError] = useState<string | null>(null)

  useEffect(() => {
    void loadGames()
    // Statuses are fetched separately — they're slower (repo clone/pull).
    void loadStatuses()
    window.api.settings.getGeneral().then((s) => setShowCloudWarning(s.showCloudWarning))
    return window.api.updater.onStatus(setUpdateStatus)
  }, [])

  async function loadGames(): Promise<void> {
    setLoading(true)
    try {
      const [list, cat] = await Promise.all([window.api.games.allInstalled(), window.api.games.catalog()])
      setInstalled(list)
      setCatalog(cat)
      setGamesError(null)
    } catch (e) {
      setGamesError(describeError(e, t, t.main.statusesError))
    } finally {
      setLoading(false)
    }
  }

  // resetSignal === 0 on mount — nothing to back out of yet.
  useEffect(() => {
    if (resetSignal > 0) setSelectedGame(null)
  }, [resetSignal])

  // syncVersion === 0 on mount — that case is already covered by the effect above.
  useEffect(() => {
    if (syncVersion > 0) {
      void loadStatuses()
      window.api.games.allInstalled().then(setInstalled).catch(() => {})
    }
  }, [syncVersion])

  // On returning to the "Games" tab, reread statuses — they may have gone stale
  // while the tab was inactive (e.g. a friend pushed their version). Skip the
  // first render (active is already true on mount) — covered by the mount effect above.
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
      // Only mark seen while the tab is genuinely visible — this same
      // function also runs in the background (syncVersion bumps regardless
      // of which tab is open), and a badge the user never actually looked
      // at shouldn't clear itself.
      if (active) onGamesSeen(list.map((s) => ({ appId: s.appId, version: s.remoteVersion })))
    } catch (e) {
      // Don't leave stale statuses (e.g. from a deleted repo) alongside the
      // error — cards should fall back to "Checking...", not lie with old data.
      setSyncStatuses({})
      setStatusesError(describeError(e, t, t.main.statusesError))
    }
  }

  // Set of installed appIds — so the catalog cards below show the correct
  // state regardless of whether a game is already installed (previously the
  // "All supported" section was filtered to exclude installed games — this made an
  // installed (only) ready game disappear from it entirely, which was confusing:
  // as if it "wasn't supported" there).
  const installedIds = useMemo(() => new Set(installed.map((g) => g.appId)), [installed])

  const q = query.trim().toLowerCase()
  const filteredInstalled = installed.filter((g) => g.name.toLowerCase().includes(q))
  const filteredCatalog = catalog.filter((g) => g.name.toLowerCase().includes(q))

  async function handleSync(appId: string, action: 'upload' | 'download'): Promise<void> {
    const status = syncStatuses[appId]?.status

    // Cases where no action is needed — just notify politely (without triggering a sync).
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
        // The hash matched the cloud at the last moment (e.g. a friend just
        // pushed the same thing) — there was no real upload, and we say so honestly.
        onBanner({ text: describeSyncResult('push-skipped-nochange', undefined, t), kind: 'info' })
      } else {
        const code = action === 'upload' ? 'upload-success' : 'download-success'
        onBanner({ text: describeSyncResult(code, { version: String(result.version) }, t), kind: 'success' })
        // Both push (a new entry) and pull (git pull may have pulled in
        // someone else's new entry) are worth having HistoryScreen reread its data.
        onSynced()
      }
      // Saves may have changed — refresh games and statuses.
      setInstalled(await window.api.games.allInstalled())
      await loadStatuses()
    } catch (e) {
      onBanner({ text: describeError(e, t, t.main.syncErrorFallback), kind: 'error' })
    } finally {
      setSyncing(null)
    }
  }

  if (selectedGame) {
    return (
      <GameDetailScreen
        appId={selectedGame.appId}
        name={selectedGame.name}
        syncVersion={syncVersion}
        user={user}
        avatarDataUrl={avatarDataUrl}
        onBack={() => setSelectedGame(null)}
        onBanner={onBanner}
        onSynced={onSynced}
        autoPushPending={autoPushPending.has(selectedGame.appId)}
      />
    )
  }

  const showUpdateBanner =
    !updateBannerDismissed &&
    (updateStatus.state === 'available' ||
      updateStatus.state === 'downloading' ||
      updateStatus.state === 'downloaded')

  return (
    <div style={styles.screen}>
      {showUpdateBanner && (
        <UpdateAvailableBanner
          status={
            updateStatus as Extract<
              UpdateStatus,
              { state: 'available' | 'downloading' | 'downloaded' }
            >
          }
          onDismiss={() => setUpdateBannerDismissed(true)}
        />
      )}
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
          <button className="reset-btn" style={styles.retryLink} onClick={() => void loadStatuses()}>
            {t.main.retry}
          </button>
        </div>
      )}

      {gamesError && (
        <div style={styles.statusesError}>
          <span>{gamesError}</span>
          <button className="reset-btn" style={styles.retryLink} onClick={() => void loadGames()}>
            {t.main.retry}
          </button>
        </div>
      )}

      {loading && !gamesError && <div style={styles.muted}>{t.main.loadingGames}</div>}

      {!loading && !gamesError && (
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
                  onOpenDetails={() => setSelectedGame({ appId: g.appId, name: g.name })}
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
                    onOpenDetails={() => setSelectedGame({ appId: g.appId, name: g.name })}
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
    padding: '13px 15px',
    borderRadius: radii.md,
    border: `1px solid ${colors.warningBd}`,
    borderLeft: `3px solid ${colors.warning}`,
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

import { useEffect, useState } from 'react'
import { colors, fonts, radii, steamPoster, transitions } from '../theme'
import { useI18n } from '../i18n'
import { describeError, describeSyncResult } from '../errors'
import type { Translation } from '../i18n'
import { ChevronRightIcon, HistoryIcon, FolderIcon, EditIcon, TrashIcon, AlertTriangleIcon } from '../components/icons'
import Avatar from '../components/Avatar'
import Button from '../components/Button'
import ConfirmModal from '../components/ConfirmModal'
import Pagination from '../components/Pagination'
import type { BannerState } from '../components/Banner'
import { useAvatars } from '../hooks/useAvatars'
import { useRowCapacity } from '../hooks/useRowCapacity'
import type { AuthUser, SyncHistoryEntry, GameSavePathInfo } from '../../../shared/types'
import { formatVersion as fmtVersion } from '../../../shared/format'
import { devHistoryMock } from '../devHistoryMock'

// ISO timestamp -> "2 min ago" / "1 hr ago" / "3 days ago" (localized).
function formatRelativeTime(iso: string, t: Translation): string {
  const diffMin = Math.floor((Date.now() - new Date(iso).getTime()) / 60000)
  if (diffMin < 1) return t.history.justNow
  if (diffMin < 60) return t.history.minutesAgo(diffMin)
  const diffHours = Math.floor(diffMin / 60)
  if (diffHours < 24) return t.history.hoursAgo(diffHours)
  const diffDays = Math.floor(diffHours / 24)
  return t.history.daysAgo(diffDays)
}

interface Props {
  appId: string
  name: string
  /** Added manually, not from CoopSync's built-in catalog — shows a
   *  disclaimer and a "Remove game" action. */
  isCustom?: boolean
  /** Changes after every real push — a signal to reread this game's history. */
  syncVersion: number
  user: AuthUser
  /** Own avatar from local settings — same source as TitleBar/Friends. */
  avatarDataUrl: string | null
  onBack: () => void
  /** Show a global banner (rendered in App — visible on all tabs). */
  onBanner: (banner: BannerState) => void
  /** Call after a real push (a revert is one) — lets History/MainScreen reread. */
  onSynced: () => void
  /** A custom game was just removed — lets MainScreen drop it and go back to
   *  the grid (only relevant when isCustom is true). */
  onCustomGameRemoved: () => void
  /** True while this game's background autopush (post game-exit) is still in
   *  flight — blocks "Restore" so it can't race the same git clone. */
  autoPushPending: boolean
}

// A single game's own sync history — reached from its card on the Games tab.
// Every entry but the newest can be reverted to — see revertToVersion in
// main/services/sync.ts for how that actually works (a new version carrying
// old content forward, not a branch).
function GameDetailScreen({
  appId,
  name,
  isCustom,
  syncVersion,
  user,
  avatarDataUrl,
  onBack,
  onBanner,
  onSynced,
  onCustomGameRemoved,
  autoPushPending
}: Props): React.JSX.Element {
  const { t } = useI18n()
  const [entries, setEntries] = useState<SyncHistoryEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [imgError, setImgError] = useState(false)
  // This screen's header (breadcrumbs + poster/title row, ~140px) is taller
  // than HistoryScreen's (plain title + search, ~100px) — useRowCapacity's
  // tiers assume the shorter one, so without trimming a row, a full page
  // plus the pagination bar doesn't actually fit and forces a scrollbar.
  const pageSize = useRowCapacity(1)
  const [page, setPage] = useState(1)
  const [restoreTarget, setRestoreTarget] = useState<SyncHistoryEntry | null>(null)
  const [restoring, setRestoring] = useState(false)
  const [restoreError, setRestoreError] = useState<string | null>(null)

  // Where this game's saves live — a user override, or the catalog default.
  const [savePathInfo, setSavePathInfo] = useState<GameSavePathInfo | null>(null)
  const [editingPath, setEditingPath] = useState(false)
  const [pathInput, setPathInput] = useState('')
  const [savingPath, setSavingPath] = useState(false)
  const [savePathError, setSavePathError] = useState<string | null>(null)

  useEffect(() => {
    setEditingPath(false)
    setSavePathError(null)
    window.api.games
      .getSavePath(appId)
      .then(setSavePathInfo)
      .catch(() => setSavePathInfo(null))
  }, [appId])

  function startEditPath(): void {
    setPathInput(savePathInfo?.path ?? '')
    setSavePathError(null)
    setEditingPath(true)
  }

  async function handleBrowsePath(): Promise<void> {
    const picked = await window.api.games.pickSaveFolder()
    if (picked) setPathInput(picked)
  }

  async function handleSavePath(): Promise<void> {
    const trimmed = pathInput.trim()
    if (!trimmed) return
    setSavingPath(true)
    setSavePathError(null)
    try {
      const info = await window.api.games.setSavePath(appId, trimmed)
      setSavePathInfo(info)
      setEditingPath(false)
    } catch (e) {
      setSavePathError(describeError(e, t, t.history.savePathSaveError))
    } finally {
      setSavingPath(false)
    }
  }

  async function handleResetPath(): Promise<void> {
    setSavingPath(true)
    try {
      const info = await window.api.games.setSavePath(appId, null)
      setSavePathInfo(info)
    } catch (e) {
      onBanner({ text: describeError(e, t, t.history.savePathSaveError), kind: 'error' })
    } finally {
      setSavingPath(false)
    }
  }

  const [showRemoveConfirm, setShowRemoveConfirm] = useState(false)
  const [removing, setRemoving] = useState(false)
  const [removeError, setRemoveError] = useState<string | null>(null)

  async function handleRemoveGame(): Promise<void> {
    setRemoving(true)
    setRemoveError(null)
    try {
      await window.api.games.removeCustom(appId)
      onCustomGameRemoved()
    } catch (e) {
      setRemoveError(describeError(e, t, t.history.removeCustomGameError))
    } finally {
      setRemoving(false)
    }
  }

  function load(): void {
    setLoading(true)
    window.api.sync
      .history()
      .then((real) => {
        // Same dev fallback as HistoryScreen — always the fixture in dev.
        const list = import.meta.env.DEV ? devHistoryMock(user.login) : real
        setEntries(list.filter((e) => e.appId === appId))
        setLoadError(null)
      })
      .catch((e) => setLoadError(describeError(e, t, t.history.loadError)))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appId])

  useEffect(() => {
    if (syncVersion > 0) load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [syncVersion])

  async function handleRestore(): Promise<void> {
    if (!restoreTarget) return
    setRestoring(true)
    setRestoreError(null)
    try {
      const result = await window.api.sync.revert(appId, restoreTarget.version)
      setRestoreTarget(null)
      onBanner({
        text: describeSyncResult('revert-success', { version: String(result.version) }, t),
        kind: 'success'
      })
      onSynced()
      load()
    } catch (e) {
      setRestoreError(describeError(e, t, t.history.restoreError))
    } finally {
      setRestoring(false)
    }
  }

  const showTable = loading || entries.length > 0
  // The newest entry has nothing to revert to — it's already the current save.
  const latestVersion = entries[0]?.version
  // Clamped rather than reset via effect — see HistoryScreen for the same pattern.
  const totalPages = Math.max(1, Math.ceil(entries.length / pageSize))
  const currentPage = Math.min(page, totalPages)
  const visible = entries.slice((currentPage - 1) * pageSize, currentPage * pageSize)
  const avatars = useAvatars(
    entries.map((e) => e.updatedBy),
    user.login,
    avatarDataUrl
  )

  return (
    <div style={styles.screen}>
      {/* Breadcrumbs — design system 4.12 Navigation: same 3-level drill-down
          pattern (Library / Game / sub-page) shown in docs/design-system.html. */}
      <div style={styles.breadcrumbs}>
        <BreadcrumbLink label={t.sidebar.games} onClick={onBack} />
        <span style={styles.crumbSep}>/</span>
        <span style={styles.crumbMuted}>{name}</span>
        <ChevronRightIcon size={14} color={colors.cy} />
        <span style={styles.crumbCurrent}>{t.history.title}</span>
      </div>

      <div style={styles.header}>
        {!imgError ? (
          <img
            src={steamPoster(appId)}
            alt=""
            style={styles.poster}
            onError={() => setImgError(true)}
          />
        ) : (
          <div style={styles.posterFallback} />
        )}
        <div style={styles.h1}>{name}</div>
      </div>

      {isCustom && (
        <div style={styles.customWarning}>
          <AlertTriangleIcon size={15} color={colors.warning} />
          <span>{t.history.customGameWarning}</span>
        </div>
      )}

      <div style={styles.savePathCard}>
        <div style={styles.savePathTopRow}>
          <div style={styles.savePathLabelRow}>
            <FolderIcon size={14} color={colors.text3} />
            <span style={styles.savePathLabel}>{t.history.savePathTitle}</span>
            {savePathInfo?.isCustom && <span style={styles.customBadge}>{t.history.savePathCustomBadge}</span>}
          </div>
          {!editingPath && (
            <div style={{ display: 'flex', gap: 8 }}>
              {savePathInfo?.isCustom && (
                <Button
                  variant="ghost"
                  style={styles.smallBtn}
                  onClick={handleResetPath}
                  disabled={savingPath}
                >
                  {t.history.savePathReset}
                </Button>
              )}
              <Button variant="ghost" style={styles.smallBtn} onClick={startEditPath}>
                <EditIcon size={13} color={colors.text2} />
                {t.history.savePathEdit}
              </Button>
            </div>
          )}
        </div>

        {!editingPath ? (
          <>
            <div style={styles.savePathValue} title={savePathInfo?.path}>
              {savePathInfo?.path ?? '—'}
            </div>
            {savePathInfo && !savePathInfo.exists && (
              <div style={styles.savePathWarning}>{t.history.savePathNotFound}</div>
            )}
          </>
        ) : (
          <div>
            <div style={styles.editRow}>
              <input
                className="input-field"
                style={styles.pathInput}
                value={pathInput}
                onChange={(e) => setPathInput(e.target.value)}
                placeholder={t.history.savePathPlaceholder}
                autoFocus
              />
              <Button variant="secondary" style={styles.browseBtn} onClick={handleBrowsePath}>
                {t.history.savePathBrowse}
              </Button>
            </div>
            {savePathError && <div style={styles.savePathErrorText}>{savePathError}</div>}
            <div style={styles.editActions}>
              <Button
                variant="primary"
                style={styles.smallBtn}
                onClick={handleSavePath}
                disabled={savingPath || !pathInput.trim()}
              >
                {savingPath && <span className="spinner" />}
                {t.history.savePathSave}
              </Button>
              <Button
                variant="ghost"
                style={styles.smallBtn}
                onClick={() => setEditingPath(false)}
                disabled={savingPath}
              >
                {t.history.savePathCancel}
              </Button>
            </div>
          </div>
        )}
      </div>

      {showTable && (
        <div style={styles.table}>
          <div style={styles.headerRow}>
            <div style={styles.headerCell}>{t.history.columnAction}</div>
            <div style={styles.headerCell}>{t.history.columnPlayer}</div>
            <div style={styles.headerCell}>{t.history.columnVersion}</div>
            <div style={styles.headerCell}>{t.history.columnWhen}</div>
            <div style={styles.headerCell} />
          </div>

          {loading
            ? [0, 1, 2].map((i) => <ShimmerRow key={i} last={i === 2} />)
            : visible.map((e, i) => (
                <HistoryRow
                  key={`${e.appId}-${e.updatedAt}`}
                  entry={e}
                  t={t}
                  avatarSrc={avatars[e.updatedBy]}
                  last={i === visible.length - 1}
                  canRestore={e.version !== latestVersion}
                  restoreDisabled={autoPushPending}
                  onRestoreClick={() => setRestoreTarget(e)}
                />
              ))}
        </div>
      )}

      {!loading && <Pagination page={currentPage} totalPages={totalPages} onChange={setPage} />}

      {!loading && entries.length === 0 && (
        <div style={styles.empty}>
          <div style={styles.emptyIcon}>
            <HistoryIcon size={20} color={colors.text3} />
          </div>
          <div style={styles.emptyTitle}>{loadError ?? t.history.emptyTitle}</div>
          {!loadError && <div style={styles.emptySubtitle}>{t.history.emptySubtitle}</div>}
        </div>
      )}

      {isCustom && (
        <div style={styles.removeRow}>
          <Button variant="danger" style={styles.removeBtn} onClick={() => setShowRemoveConfirm(true)}>
            <TrashIcon size={14} color={colors.danger} />
            {t.history.removeCustomGame}
          </Button>
        </div>
      )}

      {restoreTarget && (
        <ConfirmModal
          title={t.history.restoreConfirmTitle}
          description={t.history.restoreConfirmDesc(
            fmtVersion(restoreTarget.version),
            restoreTarget.updatedBy
          )}
          confirmLabel={t.history.restore}
          cancelLabel={t.settings.cancel}
          busy={restoring || autoPushPending}
          error={restoreError}
          onConfirm={handleRestore}
          onCancel={() => {
            setRestoreTarget(null)
            setRestoreError(null)
          }}
        />
      )}

      {showRemoveConfirm && (
        <ConfirmModal
          title={t.history.removeCustomGameConfirmTitle}
          description={t.history.removeCustomGameConfirmDesc(name)}
          confirmLabel={t.history.removeCustomGame}
          cancelLabel={t.settings.cancel}
          busy={removing}
          error={removeError}
          onConfirm={handleRemoveGame}
          onCancel={() => {
            setShowRemoveConfirm(false)
            setRemoveError(null)
          }}
        />
      )}
    </div>
  )
}

function HistoryRow({
  entry,
  t,
  avatarSrc,
  last,
  canRestore,
  restoreDisabled,
  onRestoreClick
}: {
  entry: SyncHistoryEntry
  t: Translation
  /** Player's avatar (data URL), if we have one — placeholder otherwise. */
  avatarSrc?: string
  last: boolean
  /** false for the newest entry — nothing to revert to. */
  canRestore: boolean
  /** True while this game's background autopush is in flight — greys the
   *  button out instead of hiding it, since it's back to usable in a moment. */
  restoreDisabled: boolean
  onRestoreClick: () => void
}): React.JSX.Element {
  const [hover, setHover] = useState(false)

  return (
    <div
      style={{
        ...styles.row,
        borderBottom: last ? 'none' : `1px solid ${colors.borderSubtle}`,
        background: hover ? colors.bgHover : 'transparent'
      }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <div>
        <span style={styles.actionPill}>
          <span style={styles.actionDot} />
          {t.history.uploaded}
        </span>
      </div>
      <div style={styles.playerCell}>
        <Avatar src={avatarSrc} size={22} />
        <span style={styles.playerName}>{entry.updatedBy}</span>
      </div>
      <div style={styles.mono}>
        {fmtVersion(entry.version)}
        {entry.restoredFrom !== undefined && (
          <span style={styles.restoredBadge}>{t.history.restoredFromBadge(fmtVersion(entry.restoredFrom))}</span>
        )}
      </div>
      <div style={styles.mono}>{formatRelativeTime(entry.updatedAt, t)}</div>
      <div>
        {canRestore && (
          <Button
            variant="ghost"
            style={styles.restoreBtn}
            onClick={onRestoreClick}
            disabled={restoreDisabled}
            title={restoreDisabled ? t.history.restorePendingHint : undefined}
          >
            {t.history.restore}
          </Button>
        )}
      </div>
    </div>
  )
}

function BreadcrumbLink({ label, onClick }: { label: string; onClick: () => void }): React.JSX.Element {
  const [hover, setHover] = useState(false)

  return (
    <span
      style={{ ...styles.crumbLink, color: hover ? colors.cy : colors.text3 }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onClick={onClick}
    >
      {label}
    </span>
  )
}

function ShimmerRow({ last }: { last: boolean }): React.JSX.Element {
  return (
    <div style={{ ...styles.row, borderBottom: last ? 'none' : `1px solid ${colors.borderSubtle}` }}>
      <div style={{ ...styles.shimmer, width: 90, height: 12 }} />
      <div style={styles.playerCell}>
        <div style={{ ...styles.shimmer, width: 22, height: 22, borderRadius: '50%' }} />
        <div style={{ ...styles.shimmer, width: 70, height: 12 }} />
      </div>
      <div style={{ ...styles.shimmer, width: 50, height: 12 }} />
      <div style={{ ...styles.shimmer, width: 60, height: 12 }} />
      <div />
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  screen: { flex: 1, overflowY: 'auto', padding: '28px 36px 40px' },
  breadcrumbs: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    fontSize: 13,
    marginBottom: 20
  },
  crumbLink: { cursor: 'pointer', transition: `color ${transitions.fast}` },
  crumbSep: { color: colors.text3 },
  crumbMuted: { color: colors.text3 },
  crumbCurrent: { color: colors.cy },
  header: { display: 'flex', alignItems: 'center', gap: 16, marginBottom: 24 },
  poster: {
    width: 52,
    height: 78,
    borderRadius: radii.sm,
    objectFit: 'cover',
    border: `1px solid ${colors.borderSubtle}`,
    flexShrink: 0
  },
  posterFallback: {
    width: 52,
    height: 78,
    borderRadius: radii.sm,
    background: `linear-gradient(160deg,${colors.bgRaised},${colors.bgBase})`,
    border: `1px solid ${colors.borderSubtle}`,
    flexShrink: 0
  },
  h1: { fontFamily: fonts.display, fontSize: 22, fontWeight: 700, color: colors.text1 },
  customWarning: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    fontSize: 12.5,
    lineHeight: 1.5,
    color: colors.text2,
    background: colors.warningBg,
    border: `1px solid ${colors.warningBd}`,
    borderRadius: radii.md,
    padding: '10px 14px',
    marginBottom: 20
  },
  removeRow: { marginTop: 24, display: 'flex', justifyContent: 'flex-end' },
  removeBtn: { height: 34, padding: '0 14px', fontSize: 12.5 },
  savePathCard: {
    border: `1px solid ${colors.borderSubtle}`,
    borderRadius: radii.lg,
    padding: '16px 18px',
    marginBottom: 20
  },
  savePathTopRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    marginBottom: 10
  },
  savePathLabelRow: { display: 'flex', alignItems: 'center', gap: 8 },
  savePathLabel: {
    fontFamily: fonts.display,
    fontSize: 13,
    fontWeight: 600,
    color: colors.text2,
    textTransform: 'uppercase',
    letterSpacing: '.04em'
  },
  customBadge: {
    fontSize: 10.5,
    fontWeight: 600,
    color: colors.cy,
    background: 'rgba(54,226,232,.1)',
    border: `1px solid ${colors.borderAccent}`,
    borderRadius: radii.pill,
    padding: '2px 8px'
  },
  savePathValue: {
    fontFamily: fonts.mono,
    fontSize: 12.5,
    color: colors.text2,
    background: colors.bgInset,
    border: `1px solid ${colors.borderDefault}`,
    borderRadius: radii.md,
    padding: '10px 12px',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap'
  },
  savePathWarning: { fontSize: 12, color: colors.warning, marginTop: 8 },
  editRow: { display: 'flex', gap: 8 },
  pathInput: {
    flex: 1,
    height: 38,
    padding: '0 12px',
    border: `1px solid ${colors.borderDefault}`,
    borderRadius: radii.md,
    background: colors.bgInset,
    color: colors.text1,
    fontFamily: fonts.mono,
    fontSize: 12.5,
    outline: 'none'
  },
  browseBtn: { height: 38, padding: '0 14px', fontSize: 12.5, whiteSpace: 'nowrap' },
  savePathErrorText: { fontSize: 12, color: colors.danger, marginTop: 8 },
  editActions: { display: 'flex', gap: 8, marginTop: 10 },
  smallBtn: { height: 32, padding: '0 14px', fontSize: 12.5 },
  table: {
    border: `1px solid ${colors.borderSubtle}`,
    borderRadius: radii.lg,
    overflow: 'hidden'
  },
  headerRow: {
    display: 'grid',
    gridTemplateColumns: '1fr 1.3fr .8fr 1fr .9fr',
    padding: '12px 16px',
    background: colors.bgRaised,
    borderBottom: `1px solid ${colors.borderSubtle}`
  },
  headerCell: {
    fontFamily: fonts.mono,
    fontSize: 10.5,
    letterSpacing: '.1em',
    textTransform: 'uppercase',
    color: colors.text3
  },
  row: {
    display: 'grid',
    gridTemplateColumns: '1fr 1.3fr .8fr 1fr .9fr',
    alignItems: 'center',
    padding: '13px 16px',
    transition: `background ${transitions.fast}`
  },
  actionPill: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    height: 24,
    padding: '0 10px',
    fontSize: 11.5,
    fontWeight: 600,
    color: colors.success,
    background: colors.successBg,
    border: `1px solid ${colors.successBd}`,
    borderRadius: radii.pill
  },
  actionDot: { width: 6, height: 6, borderRadius: '50%', background: colors.success, flexShrink: 0 },
  restoreBtn: { height: 30, padding: '0 12px', fontSize: 12, justifySelf: 'end' },
  restoredBadge: { display: 'block', fontSize: 10, color: colors.cy, marginTop: 2 },
  playerCell: { display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, paddingRight: 10 },
  playerName: {
    fontSize: 12.5,
    fontWeight: 600,
    color: colors.text2,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap'
  },
  mono: { fontFamily: fonts.mono, fontSize: 12, color: colors.text3 },
  shimmer: {
    borderRadius: 6,
    background: 'linear-gradient(90deg,#161b27 25%,#222a3a 37%,#161b27 63%)',
    backgroundSize: '460px 100%',
    animation: 'shimmer 1.4s linear infinite'
  },
  empty: {
    border: `1px dashed ${colors.borderDefault}`,
    borderRadius: radii.lg,
    textAlign: 'center',
    padding: '36px 16px'
  },
  emptyIcon: {
    width: 44,
    height: 44,
    margin: '0 auto 12px',
    borderRadius: radii.md,
    background: colors.bgRaised,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center'
  },
  emptyTitle: { fontSize: 13.5, fontWeight: 600, color: colors.text1 },
  emptySubtitle: { fontSize: 12, color: colors.text3, marginTop: 3 }
}

export default GameDetailScreen

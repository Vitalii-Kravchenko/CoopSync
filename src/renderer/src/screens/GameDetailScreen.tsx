import { useEffect, useState } from 'react'
import { colors, fonts, radii, steamPoster, transitions } from '../theme'
import { useI18n } from '../i18n'
import { describeError } from '../errors'
import type { Translation } from '../i18n'
import { ChevronRightIcon, HistoryIcon } from '../components/icons'
import Button from '../components/Button'
import Avatar from '../components/Avatar'
import { useAvatars } from '../hooks/useAvatars'
import { useRowCapacity } from '../hooks/useRowCapacity'
import type { AuthUser, SyncHistoryEntry } from '../../../shared/types'
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
  /** Changes after every real push — a signal to reread this game's history. */
  syncVersion: number
  user: AuthUser
  /** Own avatar from local settings — same source as TitleBar/Friends. */
  avatarDataUrl: string | null
  onBack: () => void
}

// A single game's own sync history — reached from its card on the Games tab.
// Just a read-only list for now; rolling back to an older version is future work.
function GameDetailScreen({
  appId,
  name,
  syncVersion,
  user,
  avatarDataUrl,
  onBack
}: Props): React.JSX.Element {
  const { t } = useI18n()
  const [entries, setEntries] = useState<SyncHistoryEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [imgError, setImgError] = useState(false)
  const pageSize = useRowCapacity()
  const [visibleCount, setVisibleCount] = useState(pageSize)
  // Grow with the available space (bigger window/monitor), never shrink —
  // same reasoning as HistoryScreen.
  useEffect(() => {
    setVisibleCount((c) => Math.max(c, pageSize))
  }, [pageSize])

  function load(): void {
    setLoading(true)
    window.api.sync
      .history()
      .then((real) => {
        // Same dev fallback as HistoryScreen — the dev build's clean userData
        // has no history, and this screen is unstylable against an empty list.
        const list = import.meta.env.DEV && real.length === 0 ? devHistoryMock(user.login) : real
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

  const showTable = loading || entries.length > 0
  const visible = entries.slice(0, visibleCount)
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

      {showTable && (
        <div style={styles.table}>
          <div style={styles.headerRow}>
            <div style={styles.headerCell}>{t.history.columnAction}</div>
            <div style={styles.headerCell}>{t.history.columnPlayer}</div>
            <div style={styles.headerCell}>{t.history.columnVersion}</div>
            <div style={styles.headerCell}>{t.history.columnWhen}</div>
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
                />
              ))}
        </div>
      )}

      {!loading && entries.length > visibleCount && (
        <div style={styles.showMoreWrap}>
          <Button variant="secondary" onClick={() => setVisibleCount((c) => c + pageSize)}>
            {t.history.showMore}
          </Button>
        </div>
      )}

      {!loading && entries.length > 0 && entries.length <= visibleCount && entries.length > pageSize && (
        <div style={styles.endOfList}>{t.history.endOfList}</div>
      )}

      {!loading && entries.length === 0 && (
        <div style={styles.empty}>
          <div style={styles.emptyIcon}>
            <HistoryIcon size={20} color={colors.text3} />
          </div>
          <div style={styles.emptyTitle}>{loadError ?? t.history.emptyTitle}</div>
          {!loadError && <div style={styles.emptySubtitle}>{t.history.emptySubtitle}</div>}
        </div>
      )}
    </div>
  )
}

function HistoryRow({
  entry,
  t,
  avatarSrc,
  last
}: {
  entry: SyncHistoryEntry
  t: Translation
  /** Player's avatar (data URL), if we have one — placeholder otherwise. */
  avatarSrc?: string
  last: boolean
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
      <div style={styles.mono}>{fmtVersion(entry.version)}</div>
      <div style={styles.mono}>{formatRelativeTime(entry.updatedAt, t)}</div>
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
  table: {
    border: `1px solid ${colors.borderSubtle}`,
    borderRadius: radii.lg,
    overflow: 'hidden'
  },
  headerRow: {
    display: 'grid',
    gridTemplateColumns: '1fr 1.3fr .8fr 1fr',
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
    gridTemplateColumns: '1fr 1.3fr .8fr 1fr',
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
  showMoreWrap: { display: 'flex', justifyContent: 'center', marginTop: 16 },
  endOfList: {
    textAlign: 'center',
    marginTop: 16,
    fontSize: 12,
    color: colors.text3
  },
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

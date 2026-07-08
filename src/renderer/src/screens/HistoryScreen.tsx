import { useEffect, useState } from 'react'
import { colors, fonts, radii, steamPoster } from '../theme'
import { useI18n } from '../i18n'
import type { Translation } from '../i18n'
import { HistoryIcon } from '../components/icons'
import type { SyncHistoryEntry } from '../../../shared/types'

// ISO timestamp → "2 хв тому" / "1 год тому" / "3 дн тому" (локалізовано).
function formatRelativeTime(iso: string, t: Translation): string {
  const diffMin = Math.floor((Date.now() - new Date(iso).getTime()) / 60000)
  if (diffMin < 1) return t.history.justNow
  if (diffMin < 60) return t.history.minutesAgo(diffMin)
  const diffHours = Math.floor(diffMin / 60)
  if (diffHours < 24) return t.history.hoursAgo(diffHours)
  const diffDays = Math.floor(diffHours / 24)
  return t.history.daysAgo(diffDays)
}

// "4" → "v1.004".
function fmtVersion(n: number): string {
  return `v1.${String(n).padStart(3, '0')}`
}

function HistoryScreen(): React.JSX.Element {
  const { t } = useI18n()
  const [entries, setEntries] = useState<SyncHistoryEntry[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    window.api.sync
      .history()
      .then(setEntries)
      .finally(() => setLoading(false))
  }, [])

  const showTable = loading || entries.length > 0

  return (
    <div style={styles.screen}>
      <div style={styles.h1}>{t.history.title}</div>

      {showTable && (
        <div style={styles.table}>
          <div style={styles.headerRow}>
            <div style={styles.headerCell}>{t.history.columnGame}</div>
            <div style={styles.headerCell}>{t.history.columnAction}</div>
            <div style={styles.headerCell}>{t.history.columnVersion}</div>
            <div style={styles.headerCell}>{t.history.columnWhen}</div>
          </div>

          {loading
            ? [0, 1, 2].map((i) => <ShimmerRow key={i} last={i === 2} />)
            : entries.map((e, i) => (
                <HistoryRow
                  key={`${e.appId}-${e.updatedAt}`}
                  entry={e}
                  t={t}
                  last={i === entries.length - 1}
                />
              ))}
        </div>
      )}

      {!loading && entries.length === 0 && (
        <div style={styles.empty}>
          <div style={styles.emptyIcon}>
            <HistoryIcon size={20} color={colors.text3} />
          </div>
          <div style={styles.emptyTitle}>{t.history.emptyTitle}</div>
          <div style={styles.emptySubtitle}>{t.history.emptySubtitle}</div>
        </div>
      )}
    </div>
  )
}

function HistoryRow({
  entry,
  t,
  last
}: {
  entry: SyncHistoryEntry
  t: Translation
  last: boolean
}): React.JSX.Element {
  const [hover, setHover] = useState(false)
  const [imgError, setImgError] = useState(false)

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
      <div style={styles.gameCell}>
        {!imgError ? (
          <img
            src={steamPoster(entry.appId)}
            alt=""
            style={styles.thumb}
            onError={() => setImgError(true)}
          />
        ) : (
          <div style={styles.thumbFallback} />
        )}
        {entry.gameName}
      </div>
      <div>
        <span style={styles.actionPill}>
          <span style={styles.actionDot} />
          {t.history.uploaded} · {entry.updatedBy}
        </span>
      </div>
      <div style={styles.mono}>{fmtVersion(entry.version)}</div>
      <div style={styles.mono}>{formatRelativeTime(entry.updatedAt, t)}</div>
    </div>
  )
}

function ShimmerRow({ last }: { last: boolean }): React.JSX.Element {
  return (
    <div style={{ ...styles.row, borderBottom: last ? 'none' : `1px solid ${colors.borderSubtle}` }}>
      <div style={styles.gameCell}>
        <div style={{ ...styles.shimmer, width: 26, height: 26, borderRadius: 6 }} />
        <div style={{ ...styles.shimmer, width: 120, height: 12 }} />
      </div>
      <div style={{ ...styles.shimmer, width: 90, height: 12 }} />
      <div style={{ ...styles.shimmer, width: 50, height: 12 }} />
      <div style={{ ...styles.shimmer, width: 60, height: 12 }} />
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  screen: { flex: 1, overflowY: 'auto', padding: '28px 36px 40px' },
  h1: { fontFamily: fonts.display, fontSize: 22, fontWeight: 700, color: colors.text1, marginBottom: 18 },
  table: {
    border: `1px solid ${colors.borderSubtle}`,
    borderRadius: radii.lg,
    overflow: 'hidden'
  },
  headerRow: {
    display: 'grid',
    gridTemplateColumns: '2.2fr 1.2fr 1fr 1fr',
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
    gridTemplateColumns: '2.2fr 1.2fr 1fr 1fr',
    alignItems: 'center',
    padding: '13px 16px',
    transition: 'background .12s'
  },
  gameCell: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    fontSize: 13.5,
    color: colors.text1,
    minWidth: 0
  },
  thumb: { width: 26, height: 26, borderRadius: 6, objectFit: 'cover', flexShrink: 0 },
  thumbFallback: {
    width: 26,
    height: 26,
    borderRadius: 6,
    flexShrink: 0,
    background: `linear-gradient(140deg,${colors.bgRaised},${colors.bgBase})`
  },
  actionPill: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    fontSize: 12,
    color: colors.success
  },
  actionDot: { width: 6, height: 6, borderRadius: '50%', background: colors.success, flexShrink: 0 },
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

export default HistoryScreen

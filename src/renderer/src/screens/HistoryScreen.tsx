import { useEffect, useRef, useState } from 'react'
import { colors, fonts, radii, steamPoster, transitions } from '../theme'
import { useI18n } from '../i18n'
import { describeError } from '../errors'
import type { Translation } from '../i18n'
import { HistoryIcon, SearchIcon } from '../components/icons'
import Avatar from '../components/Avatar'
import Pagination from '../components/Pagination'
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
  /** Whether this tab is currently active (HistoryScreen stays mounted in the
   *  background even when another tab is open). */
  active: boolean
  /** Changes when a repo is deleted/created and after every real push —
   *  a signal to reread the history (HistoryScreen stays mounted in the
   *  background and doesn't find out about such events on its own). */
  syncVersion: number
  /** Called whenever this tab becomes active — clears the "History" nav
   *  badge (a friend's save this device hasn't looked at yet on this tab). */
  onSeen: () => void
  user: AuthUser
  /** Own avatar from local settings — same source as TitleBar/Friends. */
  avatarDataUrl: string | null
}

function historyKey(e: SyncHistoryEntry): string {
  return `${e.appId}-${e.updatedAt}`
}

function HistoryScreen({ active, syncVersion, onSeen, user, avatarDataUrl }: Props): React.JSX.Element {
  const { t } = useI18n()
  const [entries, setEntries] = useState<SyncHistoryEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  // Client-side filter over game name / player login — the whole (uncapped)
  // history is fetched once, filtering and paging both happen locally.
  const [query, setQuery] = useState('')
  const pageSize = useRowCapacity()
  const [page, setPage] = useState(1)
  // What's actually rendering with the "new" animation right now.
  const [newKeys, setNewKeys] = useState<Set<string>>(new Set())
  // Mirror of entries for reading inside async callbacks without waiting
  // a render cycle (setEntries is async — we update the ref synchronously right away).
  // Custom games' cover art, keyed by appId — catalog games have none here
  // and fall back to steamPoster in HistoryRow. Fetched alongside history so
  // a custom game's cover (own pick, or one just adopted from a co-op
  // partner) actually shows up in this cross-game table, not just on its own
  // detail screen.
  const [customCovers, setCustomCovers] = useState<Record<string, string>>({})
  const entriesRef = useRef<SyncHistoryEntry[]>([])
  // The freshest list from the last fetch — even if the tab is inactive
  // and entries/newKeys haven't been updated yet (waiting for the moment it becomes visible).
  const latestListRef = useRef<SyncHistoryEntry[]>([])
  const fetchInFlightRef = useRef(false)
  const clearNewTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Current value of active inside async callbacks (where a closure would
  // otherwise see whatever active was at the moment loadHistory was called).
  const activeRef = useRef(active)
  useEffect(() => {
    activeRef.current = active
  }, [active])

  // Clears the nav badge whenever this tab becomes (or starts) active —
  // deliberately keyed on `active` alone, not `onSeen` (a fresh function
  // reference every App render), so this only fires on real transitions.
  useEffect(() => {
    if (active) onSeen()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active])

  // Show the list and "new" in ONE atomic action — otherwise, if the content
  // appears separately from the animation (e.g. the list updated silently in the
  // background while the tab was inactive, and the animation arrived later with
  // the fetch itself), you'd get either "showed everything, then something
  // highlighted again" or the reverse.
  // "New" is simply a diff against what the user has ALREADY seen on screen
  // (entriesRef), not some separate state tracker.
  function reveal(list: SyncHistoryEntry[]): void {
    const shownKeys = new Set(entriesRef.current.map(historyKey))
    const fresh = new Set(list.map(historyKey).filter((k) => !shownKeys.has(k)))
    entriesRef.current = list
    setEntries(list)
    setNewKeys(fresh)
    if (clearNewTimerRef.current) clearTimeout(clearNewTimerRef.current)
    if (fresh.size > 0) {
      clearNewTimerRef.current = setTimeout(() => setNewKeys(new Set()), 700)
    }
  }

  function loadCustomCovers(): void {
    window.api.games
      .allInstalled()
      .then((list) => {
        const map: Record<string, string> = {}
        for (const g of list) if (g.coverDataUrl) map[g.appId] = g.coverDataUrl
        setCustomCovers(map)
      })
      .catch(() => {
        // Not critical — rows just fall back to steamPoster (which itself
        // falls back to the placeholder on a real custom appId's 404).
      })
  }

  function loadHistory(): void {
    if (fetchInFlightRef.current) return
    fetchInFlightRef.current = true
    // Skeleton — only if there's really nothing on screen yet.
    if (entriesRef.current.length === 0) setLoading(true)
    window.api.sync
      .history()
      .then((real) => {
        // Always the fixture in dev — real history (whatever's actually in
        // this machine's coopsync-saves from earlier testing) is too small
        // and unpredictable to design/verify pagination against.
        const list = import.meta.env.DEV ? devHistoryMock(user.login) : real
        latestListRef.current = list
        setLoadError(null)
        // Tab inactive — don't touch the visible list/animation at all,
        // they'll update together as soon as the tab becomes visible (see below).
        if (activeRef.current) reveal(list)
      })
      .catch((e) => {
        // There's something to show — silently keep the old list instead of an error.
        if (entriesRef.current.length === 0) {
          setLoadError(describeError(e, t, t.history.loadError))
        }
      })
      .finally(() => {
        fetchInFlightRef.current = false
        setLoading(false)
      })
  }

  useEffect(() => {
    loadHistory()
    loadCustomCovers()
    return () => {
      if (clearNewTimerRef.current) clearTimeout(clearNewTimerRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // syncVersion > 0 — not a mount (the effect above already covers that), but a
  // signal that "something actually synced" — reread.
  useEffect(() => {
    if (syncVersion > 0) {
      loadHistory()
      loadCustomCovers()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [syncVersion])

  // On returning to the "History" tab: immediately show what we already know
  // from the last fetch (may have arrived while the tab was inactive) — no
  // delay, while also silently checking for anything even newer.
  // Skip the first render (active is already true on mount) — covered by
  // the mount effect above.
  const skipFirstActive = useRef(true)
  useEffect(() => {
    if (skipFirstActive.current) {
      skipFirstActive.current = false
      return
    }
    if (active) {
      if (latestListRef.current.length > 0) reveal(latestListRef.current)
      loadHistory()
      loadCustomCovers()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active])

  const avatars = useAvatars(
    entries.map((e) => e.updatedBy),
    user.login,
    avatarDataUrl
  )

  const q = query.trim().toLowerCase()
  const filtered = q
    ? entries.filter(
        (e) => e.gameName.toLowerCase().includes(q) || e.updatedBy.toLowerCase().includes(q)
      )
    : entries
  // Clamped rather than reset via effect — filtering down to fewer pages (or
  // a resize changing how many rows fit) just settles on the nearest valid
  // page instead of needing a separate "reset to 1" effect for each cause.
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize))
  const currentPage = Math.min(page, totalPages)
  const visible = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize)
  const showTable = loading || filtered.length > 0

  return (
    <div style={styles.screen}>
      <div style={styles.h1}>{t.history.title}</div>

      {entries.length > 0 && (
        <div style={styles.searchWrap}>
          <span style={styles.searchIcon}>
            <SearchIcon size={15} color={colors.text3} />
          </span>
          <input
            className="input-field"
            style={styles.search}
            placeholder={t.history.filterPlaceholder}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      )}

      {showTable && (
        <div style={styles.table}>
          <div style={styles.headerRow}>
            <div style={styles.headerCell}>{t.history.columnGame}</div>
            <div style={styles.headerCell}>{t.history.columnAction}</div>
            <div style={styles.headerCell}>{t.history.columnPlayer}</div>
            <div style={styles.headerCell}>{t.history.columnVersion}</div>
            <div style={styles.headerCell}>{t.history.columnWhen}</div>
          </div>

          {loading
            ? [0, 1, 2].map((i) => <ShimmerRow key={i} last={i === 2} />)
            : visible.map((e, i) => (
                <HistoryRow
                  key={historyKey(e)}
                  entry={e}
                  t={t}
                  avatarSrc={avatars[e.updatedBy]}
                  coverSrc={customCovers[e.appId]}
                  last={i === visible.length - 1}
                  isNew={newKeys.has(historyKey(e))}
                />
              ))}
        </div>
      )}

      {!loading && <Pagination page={currentPage} totalPages={totalPages} onChange={setPage} />}

      {!loading && entries.length > 0 && filtered.length === 0 && (
        <div style={styles.noMatches}>{t.main.nothingFound}</div>
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
  coverSrc,
  last,
  isNew
}: {
  entry: SyncHistoryEntry
  t: Translation
  /** Player's avatar (data URL), if we have one — placeholder otherwise. */
  avatarSrc?: string
  /** Custom game's own cover art, if it has one — steamPoster otherwise
   *  (which is meaningless for a synthetic custom:<uuid> appId and just
   *  falls through to the placeholder). */
  coverSrc?: string
  last: boolean
  /** true — just appeared in this fetch, play the entrance animation.
   *  false — already seen before; no animation, even if the DOM just became visible
   *  (the tab was display:none — the browser would otherwise replay the animation). */
  isNew: boolean
}): React.JSX.Element {
  const [hover, setHover] = useState(false)
  const [imgError, setImgError] = useState(false)

  return (
    <div
      style={{
        ...styles.row,
        borderBottom: last ? 'none' : `1px solid ${colors.borderSubtle}`,
        background: hover ? colors.bgHover : 'transparent',
        animation: isNew ? 'historyRowIn .4s ease' : 'none'
      }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <div style={styles.gameCell}>
        {!imgError ? (
          <img
            src={coverSrc ?? steamPoster(entry.appId)}
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
  h1: { fontFamily: fonts.display, fontSize: 22, fontWeight: 700, color: colors.text1, marginBottom: 18 },
  // Same look as the MainScreen search, just more compact — a filter over an
  // already-loaded table, not the screen's main action.
  searchWrap: { position: 'relative', marginBottom: 14 },
  searchIcon: {
    position: 'absolute',
    left: 14,
    top: '50%',
    transform: 'translateY(-50%)',
    display: 'flex'
  },
  search: {
    width: '100%',
    height: 40,
    padding: '0 14px 0 40px',
    border: `1px solid ${colors.borderDefault}`,
    borderRadius: radii.md,
    background: colors.bgInset,
    color: colors.text1,
    fontFamily: fonts.body,
    fontSize: 13.5,
    boxShadow: 'inset 0 1px 2px rgba(0,0,0,.3)',
    outline: 'none'
  },
  noMatches: { textAlign: 'center', padding: '28px 16px', fontSize: 13, color: colors.text3 },
  table: {
    border: `1px solid ${colors.borderSubtle}`,
    borderRadius: radii.lg,
    overflow: 'hidden'
  },
  headerRow: {
    display: 'grid',
    gridTemplateColumns: '1.9fr 1fr 1.2fr .7fr .9fr',
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
    gridTemplateColumns: '1.9fr 1fr 1.2fr .7fr .9fr',
    alignItems: 'center',
    padding: '13px 16px',
    transition: `background ${transitions.fast}`
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
  restoredBadge: { display: 'block', fontSize: 10, color: colors.cy, marginTop: 2 },
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

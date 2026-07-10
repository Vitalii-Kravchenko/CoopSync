import { useEffect, useRef, useState } from 'react'
import { colors, fonts, radii, steamPoster, transitions } from '../theme'
import { useI18n } from '../i18n'
import { describeError } from '../errors'
import type { Translation } from '../i18n'
import { HistoryIcon } from '../components/icons'
import type { SyncHistoryEntry } from '../../../shared/types'
import { formatVersion as fmtVersion } from '../../../shared/format'

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

interface Props {
  /** Чи активна зараз ця вкладка (HistoryScreen лишається змонтованим у фоні,
   *  навіть коли відкрита інша вкладка). */
  active: boolean
  /** Змінюється при видаленні/створенні сховища й після кожного реального push —
   *  сигнал перечитати історію (HistoryScreen лишається змонтованим у фоні,
   *  сам по собі про такі події не дізнається). */
  syncVersion: number
}

function historyKey(e: SyncHistoryEntry): string {
  return `${e.appId}-${e.updatedAt}`
}

function HistoryScreen({ active, syncVersion }: Props): React.JSX.Element {
  const { t } = useI18n()
  const [entries, setEntries] = useState<SyncHistoryEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  // Що реально рендериться з анімацією зараз.
  const [newKeys, setNewKeys] = useState<Set<string>>(new Set())
  // Дзеркало entries для читання всередині асинхронних колбеків без затримки
  // на цикл рендеру (setEntries асинхронний — ref оновлюємо синхронно одразу).
  const entriesRef = useRef<SyncHistoryEntry[]>([])
  // Найсвіжіший список з останнього фетчу — навіть якщо вкладка неактивна
  // і entries/newKeys ще не оновлені (чекають моменту, коли стане видимою).
  const latestListRef = useRef<SyncHistoryEntry[]>([])
  const fetchInFlightRef = useRef(false)
  const clearNewTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Актуальне значення active всередині асинхронних колбеків (де замикання
  // інакше бачило б те, яким active було в момент виклику loadHistory).
  const activeRef = useRef(active)
  useEffect(() => {
    activeRef.current = active
  }, [active])

  // Показати список і "нове" ОДНІЄЮ атомарною дією — інакше, якщо контент
  // з'являється окремо від анімації (напр. список оновився тихо у фоні, поки
  // вкладка була неактивна, а анімація прилетіла пізніше самим фетчем), вийде
  // або "показало все, а потім ще раз щось підсвітилось", або навпаки.
  // "Нове" — це просто діф проти того, що користувач УЖЕ бачив на екрані
  // (entriesRef), а не якийсь окремий трекер стану.
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

  function loadHistory(): void {
    if (fetchInFlightRef.current) return
    fetchInFlightRef.current = true
    // Скелетон — тільки якщо на екрані ще справді нічого немає.
    if (entriesRef.current.length === 0) setLoading(true)
    window.api.sync
      .history()
      .then((list) => {
        latestListRef.current = list
        setLoadError(null)
        // Вкладка неактивна — не чіпаємо видимий список/анімацію взагалі,
        // вони оновляться разом, щойно вкладка стане видимою (див. нижче).
        if (activeRef.current) reveal(list)
      })
      .catch((e) => {
        // Є що показати — мовчки лишаємо старий список замість помилки.
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
    return () => {
      if (clearNewTimerRef.current) clearTimeout(clearNewTimerRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // syncVersion > 0 — це не монтування (те вже покрив ефект вище), а сигнал
  // "щось реально засинхронізувалось" — перечитуємо.
  useEffect(() => {
    if (syncVersion > 0) loadHistory()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [syncVersion])

  // При поверненні на вкладку "Історія": одразу показуємо те, що вже знаємо
  // з останнього фетчу (могло прийти, поки вкладка була неактивна) — без
  // затримки, і заразом тихо перевіряємо, чи нема чогось ще новішого.
  // Перший рендер (active вже true на монтуванні) пропускаємо — покриває
  // ефект монтування вище.
  const skipFirstActive = useRef(true)
  useEffect(() => {
    if (skipFirstActive.current) {
      skipFirstActive.current = false
      return
    }
    if (active) {
      if (latestListRef.current.length > 0) reveal(latestListRef.current)
      loadHistory()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active])

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
                  key={historyKey(e)}
                  entry={e}
                  t={t}
                  last={i === entries.length - 1}
                  isNew={newKeys.has(historyKey(e))}
                />
              ))}
        </div>
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
  last,
  isNew
}: {
  entry: SyncHistoryEntry
  t: Translation
  last: boolean
  /** true — щойно з'явився в цьому фетчі, треба програти анімацію появи.
   *  false — вже бачили раніше; без анімації, навіть якщо DOM щойно став видимим
   *  (вкладка була display:none — браузер інакше переграв би анімацію знову). */
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

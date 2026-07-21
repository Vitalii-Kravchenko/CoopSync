import { useEffect, useRef, useState } from 'react'
import { colors, fonts, radii, shadows } from '../theme'
import { useI18n } from '../i18n'
import type { Translation } from '../i18n'
import {
  BellIcon,
  CheckIcon,
  TrashIcon,
  InfoIcon,
  LibraryIcon,
  CloseIcon,
  AlertTriangleIcon,
  AlertCircleIcon
} from './icons'
import type { AppNotification, AppNotificationKind } from '../../../shared/types'

// ISO timestamp -> "2 min ago" / "1 hr ago" / "3 days ago" (localized).
// Same helper (and the same t.history.* keys) as History/GameDetail/Friends —
// see the comment there; not worth a shared module for four lines.
function formatRelativeTime(iso: string, t: Translation): string {
  const diffMin = Math.floor((Date.now() - new Date(iso).getTime()) / 60000)
  if (diffMin < 1) return t.history.justNow
  if (diffMin < 60) return t.history.minutesAgo(diffMin)
  const diffHours = Math.floor(diffMin / 60)
  if (diffHours < 24) return t.history.hoursAgo(diffHours)
  const diffDays = Math.floor(diffHours / 24)
  return t.history.daysAgo(diffDays)
}

function describe(n: AppNotification, t: Translation): { title: string; body: string } {
  switch (n.kind) {
    case 'update-available':
      return { title: t.updateBanner.title, body: t.updateBanner.message(n.params.version) }
    case 'new-games':
      return { title: t.notifications.newGamesTitle, body: t.notifications.newGamesBody(n.params.names) }
    case 'friend-accepted':
      return {
        title: t.notifications.friendAcceptedTitle,
        body: t.notifications.friendAcceptedBody(n.params.login)
      }
    case 'friend-declined':
      return {
        title: t.notifications.friendDeclinedTitle,
        body: t.notifications.friendDeclinedBody(n.params.login)
      }
    case 'sync-conflict-skipped':
      return { title: t.notifications.syncConflictTitle, body: `${n.params.game}: ${t.main.pushSkipped}` }
    case 'access-revoked':
      return {
        title: t.notifications.accessRevokedTitle,
        body: t.notifications.accessRevokedBody(n.params.host)
      }
    case 'game-removed':
      return {
        title: t.notifications.gameRemovedTitle,
        body: t.notifications.gameRemovedBody(n.params.game)
      }
  }
}

// Same icon/severity language as docs/design-system.html 4.10 "Сповіщення" —
// Toast: a colored circle (success/warning/danger/info) + icon, so a bell
// entry reads as the same component, just in a compact list row.
const KIND_STYLE: Record<
  AppNotificationKind,
  { Icon: (p: { size?: number; color?: string }) => React.JSX.Element; color: string; bg: string }
> = {
  'update-available': { Icon: InfoIcon, color: colors.info, bg: colors.infoBg },
  'new-games': { Icon: LibraryIcon, color: colors.success, bg: colors.successBg },
  'friend-accepted': { Icon: CheckIcon, color: colors.success, bg: colors.successBg },
  'friend-declined': { Icon: CloseIcon, color: colors.warning, bg: colors.warningBg },
  'sync-conflict-skipped': { Icon: AlertTriangleIcon, color: colors.warning, bg: colors.warningBg },
  'access-revoked': { Icon: AlertCircleIcon, color: colors.danger, bg: colors.dangerBg },
  'game-removed': { Icon: TrashIcon, color: colors.warning, bg: colors.warningBg }
}

// Bell icon + dropdown panel (titlebar, next to Support) — the persisted
// history of "significant" events (app updates, friend requests, a sync
// conflict that got skipped), as opposed to the transient toast/banner that
// vanishes in 5s. Unread count is user-controlled (mark all read / clear
// all), not auto-cleared just by opening the panel — reading the list
// shouldn't silently discard it before the user chose to.
function NotificationBell(): React.JSX.Element {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  const [list, setList] = useState<AppNotification[]>([])
  const ref = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    window.api.notifications.list().then(setList)
    return window.api.notifications.onChanged(setList)
  }, [])

  useEffect(() => {
    if (!open) return
    function handleOutside(e: MouseEvent): void {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleOutside)
    return () => document.removeEventListener('mousedown', handleOutside)
  }, [open])

  // Mark items read as they actually scroll into view — not the whole list
  // at once just for opening the panel. Whatever never scrolls past the
  // viewport (e.g. the panel gets closed early) stays unread, same as any
  // "read on view" list (Slack, Discord, ...).
  useEffect(() => {
    const root = listRef.current
    if (!open || !root) return
    const observer = new IntersectionObserver(
      (entries) => {
        const ids = entries
          .filter((e) => e.isIntersecting)
          .map((e) => (e.target as HTMLElement).dataset.notifId)
          .filter((id): id is string => !!id)
        if (ids.length > 0) void window.api.notifications.markRead(ids)
      },
      { root, threshold: 0.6 }
    )
    root.querySelectorAll<HTMLElement>('[data-notif-id]').forEach((el) => observer.observe(el))
    return () => observer.disconnect()
  }, [open, list])

  const unreadCount = list.filter((n) => !n.read).length

  return (
    <div className="no-drag" style={{ position: 'relative' }} ref={ref}>
      <button
        type="button"
        className="icon-btn"
        // Own size, not the shared 41x40 — matches the rest of the titlebar
        // (Support button/user pill are 34px tall too), requested explicitly.
        style={{ width: 35, height: 34 }}
        onClick={() => setOpen((o) => !o)}
        title={t.notifications.bellTooltip}
        aria-label={t.notifications.bellTooltip}
      >
        {/* Badge is positioned against THIS small icon-sized wrapper, not the
            40x41 button box — the standard bell-badge convention (Gmail/Slack/
            GitHub) overlaps the badge onto the glyph's own corner, not floating
            near the button's padding edge, which is what looked disconnected before. */}
        <span style={{ position: 'relative', display: 'flex', transform: 'translateY(1px)' }}>
          <BellIcon size={17} />
          {unreadCount > 0 && (
            <span style={styles.badge}>
              <span style={{ transform: 'translateY(1px)' }}>{unreadCount > 9 ? '9+' : unreadCount}</span>
            </span>
          )}
        </span>
      </button>

      {open && (
        <div style={styles.panel}>
          <div style={styles.header}>
            <span style={styles.headerTitle}>{t.notifications.panelTitle}</span>
            <div style={styles.headerActions}>
              {unreadCount > 0 && (
                <button
                  type="button"
                  className="icon-btn-plain"
                  onClick={() => void window.api.notifications.markAllRead()}
                  title={t.notifications.markAllRead}
                  aria-label={t.notifications.markAllRead}
                >
                  <CheckIcon size={15} />
                </button>
              )}
              {list.length > 0 && (
                <button
                  type="button"
                  className="icon-btn-plain"
                  onClick={() => void window.api.notifications.clearAll()}
                  title={t.notifications.clearAll}
                  aria-label={t.notifications.clearAll}
                >
                  <TrashIcon size={15} />
                </button>
              )}
            </div>
          </div>

          <div style={styles.list} ref={listRef}>
            {list.length === 0 && <div style={styles.empty}>{t.notifications.empty}</div>}
            {list.map((n) => (
              <NotificationItem key={n.id} n={n} t={t} />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// Same row-hover convention as HistoryScreen's table rows — a plain local
// hover state, background switches between transparent and bgHover.
function NotificationItem({ n, t }: { n: AppNotification; t: Translation }): React.JSX.Element {
  const [hover, setHover] = useState(false)
  const { title, body } = describe(n, t)
  const { Icon, color, bg } = KIND_STYLE[n.kind]

  return (
    <div
      data-notif-id={n.id}
      // colors.bgHover reads fine against bgBase/bgRaised elsewhere, but this
      // panel sits on bgOverlay — too close in value to actually show up, per
      // direct feedback ("зливається з фоном"). A white overlay always reads
      // as "lighter than the surface underneath", regardless of the exact hex.
      style={{ ...styles.item, background: hover ? 'rgba(255,255,255,.07)' : 'transparent' }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <div style={{ ...styles.itemIcon, background: bg, color }}>
        <Icon size={16} />
      </div>
      <div style={styles.itemBody}>
        <div style={styles.itemTitle}>
          {title}
          {!n.read && <span style={styles.unreadDot} />}
        </div>
        <div style={styles.itemText}>{body}</div>
        <div style={styles.itemTime}>{formatRelativeTime(n.createdAt, t)}</div>
      </div>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  badge: {
    position: 'absolute',
    top: -5,
    right: -7,
    minWidth: 17,
    height: 17,
    padding: '0 4px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.pill,
    background: colors.cy,
    color: colors.textOnAccent,
    fontFamily: fonts.display,
    fontSize: 9.5,
    fontWeight: 700,
    lineHeight: 1,
    // Matches .icon-btn's own background (index.css) — the border "cuts" the
    // badge out of the icon underneath instead of just overlapping it, the
    // standard look for a bell/button badge (Gmail, Slack, GitHub, iOS/Android).
    border: `2px solid #171b27`
  },
  panel: {
    position: 'absolute',
    top: 'calc(100% + 10px)',
    right: 0,
    width: 420,
    maxHeight: 460,
    display: 'flex',
    flexDirection: 'column',
    border: `1px solid ${colors.borderStrong}`,
    borderRadius: radii.lg,
    background: colors.bgOverlay,
    boxShadow: shadows.sh4,
    // Clips the list's full-width hover rows to the panel's own rounded
    // corners (the list itself only scrolls vertically, so this is safe).
    overflow: 'hidden',
    zIndex: 20
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    padding: '12px 10px 12px 16px',
    borderBottom: `1px solid ${colors.borderSubtle}`
  },
  headerTitle: { fontFamily: fonts.display, fontSize: 14.5, fontWeight: 600, color: colors.text1 },
  headerActions: { display: 'flex', gap: 2 },
  // No horizontal padding — each row provides its own (matching the header's
  // 16px) so the hover background can span the panel's full width.
  list: { overflowY: 'auto', padding: '6px 0' },
  empty: {
    padding: '32px 16px',
    textAlign: 'center',
    color: colors.text3,
    fontSize: 13
  },
  item: {
    display: 'flex',
    gap: 12,
    padding: '11px 16px'
  },
  itemIcon: {
    flexShrink: 0,
    width: 32,
    height: 32,
    borderRadius: '50%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center'
  },
  itemBody: { flex: 1, minWidth: 0 },
  itemTitle: {
    display: 'flex',
    alignItems: 'center',
    gap: 7,
    fontFamily: fonts.display,
    fontSize: 13,
    fontWeight: 600,
    color: colors.text1,
    marginBottom: 3
  },
  unreadDot: { width: 6, height: 6, borderRadius: '50%', background: colors.cy, flexShrink: 0 },
  itemText: { fontFamily: fonts.body, fontSize: 12.5, color: colors.text2, lineHeight: 1.45 },
  itemTime: { fontFamily: fonts.mono, fontSize: 11, color: colors.text3, marginTop: 5 }
}

export default NotificationBell

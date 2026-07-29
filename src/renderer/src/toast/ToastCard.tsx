import { useEffect, useRef, useState } from 'react'
import { colors, fonts, radii, shadows } from '../theme'
import { translations } from '../i18n/registry'
import { isLanguageCode } from '../i18n/types'
import { describeNotification, KIND_STYLE, toastAction } from '../notificationCopy'
import { CloseIcon } from '../components/icons'
import type { ToastShowPayload } from '../../../shared/types'

// Every toast auto-dismisses now, counted down by the bottom line — even
// the ones with an action button (update available, restore). They used to
// stay forever until acted on, but this overlay sits ABOVE every other
// window on the whole screen (not just the app) — in practice that meant
// one could sit there indefinitely over whatever else Vitalii was doing,
// with no way to wave it off besides the action itself. Simpler fix: they
// still get noticeably more time (ACTION_DURATION_MS) than a routine toast,
// but everything eventually goes away on its own.
const DURATION_MS = 8000
const ACTION_DURATION_MS = 20000

interface Props {
  toast: ToastShowPayload
  onDismiss: (id: string) => void
  onAction: (toast: ToastShowPayload) => void
  onOpenMain: (id: string) => void
}

// One toast card — anatomy fixed by docs/design-system.html §4.10 (extended
// per the reviewed "Toast Notification System" mockup): 420px, 32px icon
// circle, bg-overlay, sh3+sheen shadow. Hover ONLY brightens the border
// (toast.css's :hover rules) and pauses the countdown below — no lift/
// transform anywhere (Vitalii's explicit call: the toast already has its
// own entrance animation, movement on hover on top of that reads as
// jittery).
function ToastCard({ toast, onDismiss, onAction, onOpenMain }: Props): React.JSX.Element {
  const t = translations[isLanguageCode(toast.language) ? toast.language : 'en']
  const { title, body } = describeNotification(toast.kind, toast.params, t)
  const kindStyle = KIND_STYLE[toast.kind]
  const action = toastAction(toast.kind, t)
  const { Icon } = kindStyle
  const duration = action ? ACTION_DURATION_MS : DURATION_MS

  const [paused, setPaused] = useState(false)
  const [remaining, setRemaining] = useState(duration)
  const rafRef = useRef<number | null>(null)

  // JS-driven (not a CSS transition) so pausing on hover is just "stop
  // updating state" — resuming continues from the exact remaining value
  // instead of re-deriving it from a frozen CSS width.
  useEffect(() => {
    if (paused) return
    let last = Date.now()
    function tick(): void {
      const now = Date.now()
      const elapsed = now - last
      last = now
      setRemaining((r) => r - elapsed)
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
    }
  }, [paused])

  useEffect(() => {
    if (remaining <= 0) onDismiss(toast.id)
  }, [remaining, toast.id, onDismiss])

  const percent = Math.max(0, Math.min(100, (remaining / duration) * 100))

  return (
    <div
      className={`toast-card toast-card-${kindStyle.tone}`}
      style={{ ...styles.card, borderColor: kindStyle.bd }}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onClick={() => onOpenMain(toast.id)}
    >
      <div style={styles.row}>
        <div style={{ ...styles.iconCircle, background: kindStyle.bg, color: kindStyle.color }}>
          <Icon size={16} />
        </div>
        <div style={styles.textBlock}>
          <div style={styles.title}>{title}</div>
          <div style={styles.body}>{body}</div>
        </div>
        {action ? (
          <button
            className={`toast-action toast-action-${kindStyle.tone}`}
            style={{ ...styles.actionBtn, background: kindStyle.color, color: kindStyle.textOnTone }}
            onClick={(e) => {
              e.stopPropagation()
              onAction(toast)
            }}
          >
            {action.label}
          </button>
        ) : (
          <button
            className={`toast-dismiss toast-dismiss-${kindStyle.tone}`}
            style={styles.dismissBtn}
            aria-label="dismiss"
            onClick={(e) => {
              e.stopPropagation()
              onDismiss(toast.id)
            }}
          >
            <CloseIcon size={15} />
          </button>
        )}
      </div>
      <div style={{ ...styles.line, width: `${percent}%`, background: kindStyle.color }} />
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  card: {
    position: 'relative',
    width: 420,
    borderRadius: radii.md,
    border: '1px solid',
    background: colors.bgOverlay,
    boxShadow: `${shadows.sh3}, ${shadows.sheen}`,
    overflow: 'hidden',
    cursor: 'pointer'
  },
  row: { display: 'flex', alignItems: 'center', gap: 12, padding: '14px 16px' },
  iconCircle: {
    width: 32,
    height: 32,
    borderRadius: '50%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0
  },
  textBlock: { flex: 1, minWidth: 0 },
  title: {
    fontFamily: fonts.display,
    fontSize: 13.5,
    fontWeight: 600,
    color: colors.text1,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap'
  },
  body: {
    fontFamily: fonts.body,
    fontSize: 12,
    color: colors.text3,
    marginTop: 2,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap'
  },
  dismissBtn: {
    flexShrink: 0,
    padding: 4,
    color: colors.text3,
    background: 'none',
    border: 'none',
    borderRadius: 6,
    cursor: 'pointer',
    display: 'flex'
  },
  actionBtn: {
    flexShrink: 0,
    height: 28,
    padding: '0 12px',
    fontFamily: fonts.display,
    fontWeight: 600,
    fontSize: 12,
    border: 'none',
    borderRadius: radii.sm,
    cursor: 'pointer',
    whiteSpace: 'nowrap'
  },
  line: { position: 'absolute', left: 0, bottom: 0, height: 2 }
}

export default ToastCard

import { useEffect, useRef, useState } from 'react'
import { colors, fonts, radii, shadows } from '../theme'
import { useFocusTrap } from '../hooks/useFocusTrap'
import Button from './Button'

interface Props {
  title: string
  description: string
  confirmLabel: string
  cancelLabel: string
  /** If set, the confirm button is locked for this many seconds. */
  countdownSeconds?: number
  busy?: boolean
  error?: string | null
  onConfirm: () => void
  onCancel: () => void
}

// Confirmation modal for an irreversible action ("The Cut" — a thin gradient stripe
// at the top, as in design system 4.11 Overlays). Danger variant: red border and
// stripe instead of the brand teal-purple.
function ConfirmModal({
  title,
  description,
  confirmLabel,
  cancelLabel,
  countdownSeconds,
  busy,
  error,
  onConfirm,
  onCancel
}: Props): React.JSX.Element {
  const [remaining, setRemaining] = useState(countdownSeconds ?? 0)
  // Only close on a backdrop click if the mousedown itself was also on the
  // backdrop, not inside the card. Otherwise selecting text (mousedown inside
  // -> drag outside the modal -> mouseup on the backdrop) is treated by the
  // browser as a backdrop click (common ancestor of the mousedown/mouseup targets),
  // and the modal would close on its own.
  const mouseDownOnBackdrop = useRef(false)
  const cardRef = useRef<HTMLDivElement>(null)
  useFocusTrap(cardRef)

  useEffect(() => {
    if (!countdownSeconds) return
    const interval = setInterval(() => setRemaining((r) => Math.max(0, r - 1)), 1000)
    return () => clearInterval(interval)
  }, [countdownSeconds])

  const locked = remaining > 0

  return (
    <div
      style={styles.backdrop}
      onMouseDown={(e) => {
        mouseDownOnBackdrop.current = e.target === e.currentTarget
      }}
      onClick={(e) => {
        // Same reason the buttons disable on busy — a backdrop click was
        // still closing the modal (and freeing the user to reopen it and
        // fire a second, overlapping request) while the first one was
        // still in flight.
        if (!busy && mouseDownOnBackdrop.current && e.target === e.currentTarget) onCancel()
      }}
    >
      <div ref={cardRef} style={styles.card} onClick={(e) => e.stopPropagation()}>
        <div style={styles.topBar} />
        <div style={styles.body}>
          <div style={styles.titleRow}>
            <WarningIcon />
            <div style={styles.title}>{title}</div>
          </div>
          <div style={styles.description}>{description}</div>
          {error && <div style={styles.error}>{error}</div>}
          <div style={styles.actions}>
            <Button variant="ghost" style={styles.actionBtn} onClick={onCancel} disabled={busy}>
              {cancelLabel}
            </Button>
            <Button variant="danger" style={styles.actionBtn} onClick={onConfirm} disabled={locked || busy}>
              {busy && <span className="spinner" />}
              {locked ? `${confirmLabel} (${remaining})` : confirmLabel}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

function WarningIcon(): React.JSX.Element {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={colors.danger} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 9v4M12 17h.01" />
      <path d="m21.7 16.5-8.2-14a2 2 0 0 0-3.4 0l-8.2 14A2 2 0 0 0 3.6 20h16.8a2 2 0 0 0 1.7-3.5Z" />
    </svg>
  )
}

const styles: Record<string, React.CSSProperties> = {
  backdrop: {
    position: 'fixed',
    inset: 0,
    background: 'radial-gradient(circle at 20% -10%, rgba(60,20,26,.4), rgba(0,0,0,.6) 60%)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 200
  },
  card: {
    width: 440,
    border: `1px solid ${colors.dangerBd}`,
    borderRadius: radii.lg,
    background: colors.bgOverlay,
    boxShadow: `${shadows.sh5}, 0 0 30px rgba(255,107,124,.12)`,
    overflow: 'hidden',
    outline: 'none'
  },
  topBar: { height: 2, background: `linear-gradient(90deg, ${colors.danger}, #ff9aa6)` },
  body: { padding: 22 },
  titleRow: { display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 },
  title: { fontFamily: fonts.display, fontWeight: 600, fontSize: 17, color: colors.text1 },
  description: { fontSize: 13, color: colors.text3, lineHeight: 1.55, marginBottom: 20 },
  error: {
    fontSize: 12.5,
    color: colors.danger,
    background: colors.dangerBg,
    border: `1px solid ${colors.dangerBd}`,
    borderRadius: radii.sm,
    padding: '8px 10px',
    marginBottom: 16
  },
  actions: { display: 'flex', gap: 10, justifyContent: 'flex-end' },
  actionBtn: { whiteSpace: 'nowrap', flexShrink: 0 }
}

export default ConfirmModal

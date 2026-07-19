import { useRef } from 'react'
import { colors, fonts, gradients, radii, shadows } from '../theme'
import { useFocusTrap } from '../hooks/useFocusTrap'
import Button from './Button'

interface Props {
  title: string
  description: string
  adoptLabel: string
  leaveAnywayLabel: string
  cancelLabel: string
  /** Which of the two real actions is currently in flight, if any — only
   *  that button shows a spinner, but both (plus Cancel) are disabled while
   *  either is running. */
  busy?: 'adopt' | 'leave' | null
  error?: string | null
  onAdopt: () => void
  onLeaveAnyway: () => void
  onCancel: () => void
}

// A three-way choice, not a plain confirm/cancel (see ConfirmModal) — offered
// after the user already confirmed they want to leave a shared repo: keep
// the local history as a new, self-owned repo, or just leave as before.
// Backdrop click/Escape-equivalent (Cancel) backs out of the WHOLE thing
// (stays in the repo), never accidentally triggers either real action.
function AdoptStorageModal({
  title,
  description,
  adoptLabel,
  leaveAnywayLabel,
  cancelLabel,
  busy,
  error,
  onAdopt,
  onLeaveAnyway,
  onCancel
}: Props): React.JSX.Element {
  const mouseDownOnBackdrop = useRef(false)
  const cardRef = useRef<HTMLDivElement>(null)
  useFocusTrap(cardRef)

  return (
    <div
      style={styles.backdrop}
      onMouseDown={(e) => {
        mouseDownOnBackdrop.current = e.target === e.currentTarget
      }}
      onClick={(e) => {
        if (!busy && mouseDownOnBackdrop.current && e.target === e.currentTarget) onCancel()
      }}
    >
      <div ref={cardRef} style={styles.card} onClick={(e) => e.stopPropagation()}>
        <div style={styles.topBar} />
        <div style={styles.body}>
          <div style={styles.title}>{title}</div>
          <div style={styles.description}>{description}</div>
          {error && <div style={styles.error}>{error}</div>}
          <div style={styles.actions}>
            <Button variant="ghost" style={styles.actionBtn} onClick={onCancel} disabled={!!busy}>
              {cancelLabel}
            </Button>
            <Button variant="ghost" style={styles.actionBtn} onClick={onLeaveAnyway} disabled={!!busy}>
              {busy === 'leave' && <span className="spinner" />}
              {leaveAnywayLabel}
            </Button>
            <Button variant="primary" style={styles.actionBtn} onClick={onAdopt} disabled={!!busy}>
              {busy === 'adopt' && <span className="spinner" />}
              {adoptLabel}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  backdrop: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(6,8,13,.72)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 200
  },
  card: {
    width: 640,
    maxWidth: 'calc(100vw - 48px)',
    border: `1px solid ${colors.borderStrong}`,
    borderRadius: radii.lg,
    background: colors.bgOverlay,
    boxShadow: shadows.sh5,
    overflow: 'hidden',
    outline: 'none'
  },
  topBar: { height: 2, background: gradients.energy },
  body: { padding: 22 },
  title: { fontFamily: fonts.display, fontWeight: 600, fontSize: 17, color: colors.text1, marginBottom: 8 },
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
  actions: { display: 'flex', gap: 10, justifyContent: 'flex-end', flexWrap: 'wrap' },
  actionBtn: { whiteSpace: 'nowrap', flexShrink: 0 }
}

export default AdoptStorageModal

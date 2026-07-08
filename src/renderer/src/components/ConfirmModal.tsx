import { useEffect, useState } from 'react'
import { colors, fonts, radii, shadows } from '../theme'
import Button from './Button'

interface Props {
  title: string
  description: string
  confirmLabel: string
  cancelLabel: string
  /** Якщо задано — кнопка підтвердження заблокована цю кількість секунд. */
  countdownSeconds?: number
  busy?: boolean
  error?: string | null
  onConfirm: () => void
  onCancel: () => void
}

// Модалка підтвердження незворотної дії ("The Cut" — тонка градієнтна смужка
// зверху, як у дизайн-системі 4.11 Оверлеї). Danger-варіант: червона рамка й
// смужка замість фірмової бірюзово-фіолетової.
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

  useEffect(() => {
    if (!countdownSeconds) return
    const interval = setInterval(() => setRemaining((r) => Math.max(0, r - 1)), 1000)
    return () => clearInterval(interval)
  }, [countdownSeconds])

  const locked = remaining > 0

  return (
    <div style={styles.backdrop} onClick={onCancel}>
      <div style={styles.card} onClick={(e) => e.stopPropagation()}>
        <div style={styles.topBar} />
        <div style={styles.body}>
          <div style={styles.titleRow}>
            <WarningIcon />
            <div style={styles.title}>{title}</div>
          </div>
          <div style={styles.description}>{description}</div>
          {error && <div style={styles.error}>{error}</div>}
          <div style={styles.actions}>
            <Button variant="ghost" onClick={onCancel} disabled={busy}>
              {cancelLabel}
            </Button>
            <Button variant="danger" onClick={onConfirm} disabled={locked || busy}>
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
    width: 360,
    border: `1px solid ${colors.dangerBd}`,
    borderRadius: radii.lg,
    background: colors.bgOverlay,
    boxShadow: `${shadows.sh5}, 0 0 30px rgba(255,107,124,.12)`,
    overflow: 'hidden'
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
  actions: { display: 'flex', gap: 10, justifyContent: 'flex-end' }
}

export default ConfirmModal

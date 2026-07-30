import { useEffect, useRef, useState } from 'react'
import { colors, fonts, radii, shadows } from '../theme'
import { translations } from '../i18n/registry'
import { isLanguageCode } from '../i18n/types'
import { describeNotification, KIND_STYLE, toastAction } from '../notificationCopy'
import { CloseIcon } from '../components/icons'
import type { ToastShowPayload, UpdateStatus } from '../../../shared/types'

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
// Once the update this toast is tracking finishes downloading, it's worth
// noticeably more time than even ACTION_DURATION_MS before it gives up on
// its own — Vitalii's call (2026-07-30): a stray click restarting CoopSync
// mid-something is more annoying than this sitting around a bit longer.
const READY_DURATION_MS = 60000

interface Props {
  toast: ToastShowPayload
  /** Live auto-update state — only actually consulted for an
   *  update-available toast (see the phase logic below), which needs to
   *  reflect a download in progress instead of staying frozen with whatever
   *  it showed when it first appeared. */
  updateStatus: UpdateStatus
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
function ToastCard({ toast, updateStatus, onDismiss, onAction, onOpenMain }: Props): React.JSX.Element {
  const t = translations[isLanguageCode(toast.language) ? toast.language : 'en']
  const kindStyle = KIND_STYLE[toast.kind]
  const { Icon } = kindStyle

  // update-available is the one kind that can change shape AFTER it's shown
  // — a download it tracks live can start (from its own button) or finish
  // (from any surface) while it's still sitting on screen, instead of
  // staying frozen with whatever it displayed the instant it appeared
  // (Vitalii's report, 2026-07-30: a stale "Download update" button next to
  // an already-downloaded update elsewhere in the app). Every other kind
  // ignores updateStatus entirely and behaves exactly as before.
  const updatePhase: 'available' | 'downloading' | 'downloaded' =
    toast.kind === 'update-available' && (updateStatus.state === 'downloading' || updateStatus.state === 'downloaded')
      ? updateStatus.state
      : 'available'

  const { title, body } =
    updatePhase === 'downloading'
      ? {
          title: t.updateBanner.title,
          body: t.settings.updateDownloading(updateStatus.state === 'downloading' ? updateStatus.percent : 0)
        }
      : updatePhase === 'downloaded'
        ? { title: t.updateBanner.readyTitle, body: t.updateBanner.readyMessage }
        : describeNotification(toast.kind, toast.params, t)

  const action =
    updatePhase === 'downloading'
      ? undefined // no button while it's actively downloading, just the dismiss ×
      : updatePhase === 'downloaded'
        ? { label: t.settings.restartToInstall }
        : toastAction(toast.kind, t)

  const duration = updatePhase === 'downloaded' ? READY_DURATION_MS : action ? ACTION_DURATION_MS : DURATION_MS

  const [paused, setPaused] = useState(false)
  const [remaining, setRemaining] = useState(duration)
  const rafRef = useRef<number | null>(null)
  // Guards the 'downloaded' branch of handleActionClick below against firing
  // installUpdate() twice — onDismiss() only starts the fade-out (see
  // ToastStack's EXIT_MS), the card (and its button) stays clickable for
  // another 150ms, same double-click window as updater.ts's own
  // installTriggered guard covers for the other 2 surfaces.
  const installClickedRef = useRef(false)

  // A phase change carries its own fresh duration (available -> downloading
  // has none at all; downloading -> downloaded gets the long READY_DURATION_MS)
  // — restart the countdown from it rather than continuing to count down
  // whatever was left from the PREVIOUS phase.
  useEffect(() => {
    setRemaining(duration)
    // duration is a pure function of updatePhase — no need to list it too.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [updatePhase])

  // JS-driven (not a CSS transition) so pausing on hover is just "stop
  // updating state" — resuming continues from the exact remaining value
  // instead of re-deriving it from a frozen CSS width. Never runs at all
  // while actively downloading — Vitalii's explicit call: it must not
  // disappear out from under an in-progress download just because a timer
  // ran out.
  useEffect(() => {
    if (paused || updatePhase === 'downloading') return
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
  }, [paused, updatePhase])

  useEffect(() => {
    if (updatePhase !== 'downloading' && remaining <= 0) onDismiss(toast.id)
  }, [remaining, updatePhase, toast.id, onDismiss])

  // While downloading, the bottom line reports DOWNLOAD progress (grows
  // left-to-right as it nears done) instead of the countdown (which shrinks
  // as time runs out) — same bar, different meaning, and there's no
  // countdown running in this phase anyway.
  const percent =
    updatePhase === 'downloading'
      ? updateStatus.state === 'downloading'
        ? updateStatus.percent
        : 0
      : Math.max(0, Math.min(100, (remaining / duration) * 100))

  function handleActionClick(e: React.MouseEvent): void {
    e.stopPropagation()
    if (updatePhase === 'downloaded') {
      if (installClickedRef.current) return
      installClickedRef.current = true
      // Not routed through onAction/'toast:action' — this button's meaning
      // (install, not download) only exists because of the live phase, not
      // the toast's own fixed kind (see toastWindow.ts's setInstallHandler).
      window.toastApi.installUpdate()
      onDismiss(toast.id)
    } else {
      onAction(toast)
    }
  }

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
            onClick={handleActionClick}
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
  // color/background deliberately NOT set inline — toast.css's .toast-dismiss
  // rule owns the resting color, so its :hover rule (color+background) can
  // actually win instead of being shadowed by an inline style (inline always
  // beats a stylesheet regardless of specificity, cursor:pointer was firing
  // fine, the color/background hover just never visibly applied).
  dismissBtn: {
    flexShrink: 0,
    padding: 4,
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

import { useCallback, useEffect, useRef, useState } from 'react'
import ToastCard from './ToastCard'
import type { ToastShowPayload, UpdateStatus } from '../../../shared/types'

// Matches toast.css's toast-fade-out animation-duration — the array removal
// (which actually shrinks the stack) only happens once the fade has
// actually played, not before.
const EXIT_MS = 150

// Room around the card for its own drop shadow (theme.ts's sh3, a 28px blur)
// to fully fade before hitting the window's edge instead of getting
// hard-clipped by it — a blur radius needs roughly 1.5x its own value to
// fade to nothing, not 1x. sh3's y-offset is +10 (shifted down), so the
// shadow reaches further below the card than above it — V_PAD_BOTTOM is
// larger to match. Added on both sides of the MEASURED content width/height
// before reporting to main (see the ResizeObserver below) — matches
// toastWindow.ts's own window-sizing math.
const V_PAD_X = 40
const V_PAD_TOP = 30
const V_PAD_BOTTOM = 45

// Root of the toast overlay window (see main/services/toastWindow.ts).
// Owns the list of currently-visible toasts, reports its own rendered
// height to main (so the otherwise-invisible transparent window can be
// resized+repositioned to exactly hug its content, bottom-center anchored),
// and tells main when it's empty (hide the window — nothing left to show).
function ToastStack(): React.JSX.Element {
  const [toasts, setToasts] = useState<ToastShowPayload[]>([])
  const [removing, setRemoving] = useState<Set<string>>(new Set())
  const containerRef = useRef<HTMLDivElement>(null)
  // Live auto-update state — lets an update-available toast track a download
  // in progress instead of staying frozen with whatever it showed when it
  // first appeared (see ToastCard's update-available special-case).
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus>({ state: 'idle' })

  // Two toasts arriving within the same instant (e.g. two events genuinely
  // coincide) used to both slide in at once — visually abrupt/jarring
  // (Vitalii's direct feedback). nextSlotRef reserves each arrival's own
  // moment SYNCHRONOUSLY, right when it's received, so a burst of several
  // gets spaced STAGGER_MS apart in a real queue rather than racing each
  // other — a naive "wait since the last one APPEARED" (updated only
  // inside the timeout) would let a third arrival in the same burst read a
  // stale timestamp and collide with the second.
  const nextSlotRef = useRef(0)
  const STAGGER_MS = 350

  // Tells main this window's React tree has actually mounted — see
  // preload/toast.ts's signalReady doc comment for why main waits for this
  // before ever sending a toast payload.
  useEffect(() => window.toastApi.signalReady(), [])

  useEffect(
    () =>
      window.toastApi.onShow((toast) => {
        const now = Date.now()
        const slot = Math.max(now, nextSlotRef.current)
        nextSlotRef.current = slot + STAGGER_MS
        setTimeout(() => setToasts((list) => [...list, toast]), slot - now)
      }),
    []
  )

  useEffect(() => window.toastApi.onUpdateStatus(setUpdateStatus), [])

  // useCallback (not plain functions) is load-bearing here, not just style:
  // these are passed down as ToastCard props, and ToastCard's own "did the
  // countdown hit zero" effect lists onDismiss in its dependency array. A
  // fresh function identity on every ToastStack render (which dismiss()
  // itself triggers, via setRemoving) made that effect re-run continuously
  // for the whole EXIT_MS window while remaining stayed <=0 — a genuine
  // React "Maximum update depth exceeded" render loop, confirmed in
  // testing. Stable identities break the cycle.
  const dismiss = useCallback((id: string): void => {
    setRemoving((prev) => new Set(prev).add(id))
    setTimeout(() => {
      setToasts((list) => list.filter((x) => x.id !== id))
      setRemoving((prev) => {
        const next = new Set(prev)
        next.delete(id)
        return next
      })
    }, EXIT_MS)
  }, [])

  const action = useCallback(
    (toast: ToastShowPayload): void => {
      window.toastApi.action(toast.kind, toast.params)
      // update-available is the one exception — it stays open and tracks
      // the download live instead of dismissing right away (see ToastCard's
      // update-available special-case).
      if (toast.kind !== 'update-available') dismiss(toast.id)
    },
    [dismiss]
  )

  const openMain = useCallback((): void => {
    window.toastApi.openMain()
  }, [])

  // experimental-confirm's two equal-weight buttons — deliberately NOT
  // routed through the generic `action` above (which also brings the main
  // window forward and is keyed only by kind+params): "є проблеми" needs to
  // open the main window AND the Support modal pre-filled — see
  // toastWindow.ts's setConfirmHandler and ipc.ts's wiring — so it dismisses
  // right away same as any other action click. "так" does NOT dismiss here
  // — ToastCard switches the SAME card to a short thank-you message
  // (Vitalii's request, 2026-07-30) and calls onDismiss itself once that's
  // done, so dismissing it immediately here would cut the thank-you off
  // before it ever showed.
  const dualAnswer = useCallback(
    (toast: ToastShowPayload, answer: 'yes' | 'no'): void => {
      window.toastApi.confirmExperimental(toast.params.gameId ?? '', toast.params.game ?? '', answer)
      if (answer === 'no') dismiss(toast.id)
    },
    [dismiss]
  )

  // Main says the download started from a different surface (Settings/the
  // Games-tab banner) — drop any toast of that kind, it's stale now (see
  // toastWindow.ts's dismissToastsOfKind doc comment).
  useEffect(
    () =>
      window.toastApi.onDismissKind((kind) => {
        setToasts((list) => {
          for (const t of list) if (t.kind === kind) dismiss(t.id)
          return list
        })
      }),
    [dismiss]
  )

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const ro = new ResizeObserver((entries) => {
      // ResizeObserver's contentRect is the CONTENT box — it excludes this
      // element's own padding, so the card's shadow room (V_PAD_*) has to be
      // added back in by hand here for both axes, or it gets hard-clipped by
      // the window bounds (Vitalii's report, 2026-07-30). Width, not just
      // height, is now reported too — styles.stack below is fit-content (not
      // 100%), so its measured contentRect.width IS the widest current
      // toast's own natural width, exactly what the window needs to resize
      // (and recenter) to (see toastWindow.ts's reposition) — cards no
      // longer wrap or truncate their text, they just grow instead
      // (Vitalii's request, 2026-07-30).
      const width = (entries[0]?.contentRect.width ?? 0) + V_PAD_X * 2
      const height = (entries[0]?.contentRect.height ?? 0) + V_PAD_TOP + V_PAD_BOTTOM
      window.toastApi.reportSize(width, height)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    if (toasts.length === 0) window.toastApi.reportEmpty()
  }, [toasts.length])

  return (
    <div style={styles.anchor}>
      <div ref={containerRef} style={styles.stack}>
        {toasts.map((toast) => (
          <div key={toast.id} className={removing.has(toast.id) ? 'toast-exit' : 'toast-enter'}>
            <ToastCard
              toast={toast}
              updateStatus={updateStatus}
              onDismiss={dismiss}
              onAction={action}
              onOpenMain={openMain}
              onDualAnswer={dualAnswer}
            />
          </div>
        ))}
      </div>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  // Fills the whole window (see toast.html/toast.css's height:100% chain),
  // pins its one child to the BOTTOM (the window only ever GROWS immediately
  // and shrinks back down later — toastWindow.ts's grow-only resize, to
  // avoid flicker — so its actual height/width often exceed what the
  // current toasts need; leftover space should show as a gap ABOVE/beside
  // the toasts, not push them off their bottom-center anchor), and centers
  // it horizontally — stack below is fit-content width now (not 100%), so
  // this alignItems is what actually keeps it centered in the window.
  anchor: {
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'flex-end',
    alignItems: 'center',
    width: '100%',
    height: '100%'
  },
  // The measured element (containerRef/ResizeObserver) — deliberately NOT
  // 100%/height:100% like its parent above: its natural, content-driven
  // size (the widest current toast's own width, and the stack's total
  // height) is exactly what main needs reported to size+recenter the window
  // correctly. A stretched size here would just report back the window's
  // own current (possibly stale/oversized) size instead of the toasts' real
  // size — see this file's ResizeObserver.
  stack: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 10,
    // Room for the shadow on all four sides (see V_PAD_* above) — ALSO
    // added by hand to the width/height reported to main in the
    // ResizeObserver callback above, since contentRect excludes this
    // element's own padding and the window is sized to exactly that number
    // with none of its own.
    padding: `${V_PAD_TOP}px ${V_PAD_X}px ${V_PAD_BOTTOM}px`,
    width: 'fit-content'
  }
}

export default ToastStack

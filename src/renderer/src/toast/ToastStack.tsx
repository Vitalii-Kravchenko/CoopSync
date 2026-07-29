import { useCallback, useEffect, useRef, useState } from 'react'
import ToastCard from './ToastCard'
import type { ToastShowPayload } from '../../../shared/types'

// Matches toast.css's toast-fade-out animation-duration — the array removal
// (which actually shrinks the stack) only happens once the fade has
// actually played, not before.
const EXIT_MS = 150

// Root of the toast overlay window (see main/services/toastWindow.ts).
// Owns the list of currently-visible toasts, reports its own rendered
// height to main (so the otherwise-invisible transparent window can be
// resized+repositioned to exactly hug its content, bottom-center anchored),
// and tells main when it's empty (hide the window — nothing left to show).
function ToastStack(): React.JSX.Element {
  const [toasts, setToasts] = useState<ToastShowPayload[]>([])
  const [removing, setRemoving] = useState<Set<string>>(new Set())
  const containerRef = useRef<HTMLDivElement>(null)

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
      dismiss(toast.id)
    },
    [dismiss]
  )

  const openMain = useCallback((): void => {
    window.toastApi.openMain()
  }, [])

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const ro = new ResizeObserver((entries) => {
      const height = entries[0]?.contentRect.height ?? 0
      window.toastApi.reportHeight(height)
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
            <ToastCard toast={toast} onDismiss={dismiss} onAction={action} onOpenMain={openMain} />
          </div>
        ))}
      </div>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  // Fills the whole window (see toast.html/toast.css's height:100% chain)
  // and pins its one child to the BOTTOM — the window only ever GROWS
  // immediately and shrinks back down later (toastWindow.ts's grow-only
  // resize, to avoid flicker), so its actual height often exceeds what the
  // current toasts need. Any leftover space this creates should show up as
  // a gap ABOVE the toasts, not push them away from the bottom edge
  // they're meant to stay anchored to.
  anchor: {
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'flex-end',
    width: '100%',
    height: '100%'
  },
  // The measured element (containerRef/ResizeObserver) — deliberately NOT
  // height:100% like its parent above: its natural, content-driven height
  // is exactly what main needs reported to size the window correctly. A
  // stretched height here would just report back the window's own current
  // (possibly stale/oversized) height instead of the toasts' real size.
  stack: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 10,
    // Horizontal only — matches toastWindow.ts's WIDTH (420 card + 16 each
    // side). No vertical padding: ResizeObserver's contentRect excludes an
    // element's own padding, and this container's measured height is what
    // main uses to size the window — vertical padding here would get
    // silently clipped rather than reported.
    padding: '0 16px',
    width: '100%'
  }
}

export default ToastStack

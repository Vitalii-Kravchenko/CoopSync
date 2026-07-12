import { useEffect, type RefObject } from 'react'

const FOCUSABLE_SELECTOR =
  'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])'

/**
 * Keeps keyboard focus (Tab/Shift+Tab) inside a modal — without this, Tab
 * continues along the normal DOM order and lands on app elements beneath
 * the overlay (titlebar, sidebar, etc.) before reaching the modal itself.
 *
 * On mount, focuses the CONTAINER ITSELF (not a specific element inside it) —
 * if we programmatically focus the FIRST form field, the user's first real
 * Tab press moves focus to the SECOND field (since the first is already
 * "occupied"), and it looks like Tab "skipped" the first one. Focusing the
 * container (tabindex="-1", which isn't part of the page's normal Tab order)
 * means the first Tab naturally lands on the first focusable element inside.
 */
export function useFocusTrap(containerRef: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const hadTabIndex = container.hasAttribute('tabindex')
    if (!hadTabIndex) container.setAttribute('tabindex', '-1')
    container.focus({ preventScroll: true })

    const focusables = (): HTMLElement[] =>
      Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
        (el) => el.offsetParent !== null
      )

    function handleKeyDown(e: KeyboardEvent): void {
      if (e.key !== 'Tab') return
      const items = focusables()
      if (items.length === 0) return
      const first = items[0]
      const last = items[items.length - 1]
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    }

    container.addEventListener('keydown', handleKeyDown)
    return () => {
      container.removeEventListener('keydown', handleKeyDown)
      if (!hadTabIndex) container.removeAttribute('tabindex')
    }
  }, [containerRef])
}

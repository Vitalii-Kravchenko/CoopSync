import { useEffect, type RefObject } from 'react'

const FOCUSABLE_SELECTOR =
  'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])'

/**
 * Тримає фокус клавіатурою (Tab/Shift+Tab) усередині модалки — без цього Tab
 * веде далі по звичайному DOM-порядку й потрапляє на елементи застосунку під
 * оверлеєм (титлбар, сайдбар тощо), перш ніж дійти до самої модалки.
 *
 * При монтуванні фокусує САМ КОНТЕЙНЕР (не конкретний елемент усередині) —
 * якщо програмно сфокусувати ПЕРШЕ поле форми, то перший реальний Tab від
 * користувача переміщує фокус на ДРУГЕ поле (бо перше вже "зайняте"), і
 * виглядає так, ніби Tab "перестрибнув" через перше. Фокус на контейнері
 * (tabindex="-1", у звичайний Tab-порядок сторінки не потрапляє) — тоді
 * перший Tab природно веде саме на перший фокусований елемент усередині.
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

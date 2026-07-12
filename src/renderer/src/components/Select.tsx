import { useEffect, useRef, useState } from 'react'
import { colors, fonts, radii, shadows } from '../theme'
import { CheckIcon, ChevronDownIcon } from './icons'

interface Option<T extends string> {
  value: T
  label: string
}

interface Props<T extends string> {
  value: T
  options: Option<T>[]
  onChange: (v: T) => void
  disabled?: boolean
  style?: React.CSSProperties
}

// Custom dropdown (design system 4.3 "Selects") — replaces the native
// <select>, whose focus/hover/option list the browser draws itself and won't let
// us restyle. The same pattern that used to live only in SupportModal (category
// selection) — now shared, so the two places don't drift visually apart.
function Select<T extends string>({ value, options, onChange, disabled, style }: Props<T>): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [hovered, setHovered] = useState<T | null>(null)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function handleOutside(e: MouseEvent): void {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleOutside)
    return () => document.removeEventListener('mousedown', handleOutside)
  }, [open])

  const current = options.find((o) => o.value === value)

  return (
    <div style={{ position: 'relative', ...style }} ref={ref}>
      <button
        type="button"
        className="input-field"
        style={styles.trigger}
        onClick={() => !disabled && setOpen((o) => !o)}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span>{current?.label ?? ''}</span>
        <span
          style={{
            display: 'flex',
            transform: open ? 'rotate(180deg)' : undefined,
            transition: 'transform var(--t-hover)'
          }}
        >
          <ChevronDownIcon size={16} color={colors.text3} />
        </span>
      </button>

      {open && (
        <div style={styles.dropdown} role="listbox">
          {options.map((o) => {
            const active = o.value === value
            const hover = o.value === hovered
            return (
              <button
                key={o.value}
                type="button"
                role="option"
                aria-selected={active}
                style={{ ...styles.option, ...(active ? styles.optionActive : hover ? styles.optionHover : {}) }}
                onMouseEnter={() => setHovered(o.value)}
                onMouseLeave={() => setHovered(null)}
                onClick={() => {
                  onChange(o.value)
                  setOpen(false)
                }}
              >
                {active && <CheckIcon size={13} color={colors.cy} />}
                {o.label}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  trigger: {
    width: '100%',
    height: 42,
    padding: '0 14px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    fontSize: 14,
    fontFamily: fonts.body,
    color: colors.text1,
    background: colors.bgInset,
    border: `1px solid ${colors.borderDefault}`,
    borderRadius: radii.md,
    boxShadow: 'inset 0 1px 2px rgba(0,0,0,.3)',
    boxSizing: 'border-box',
    appearance: 'none',
    WebkitAppearance: 'none',
    outline: 'none',
    cursor: 'pointer'
  },
  dropdown: {
    position: 'absolute',
    top: 'calc(100% + 6px)',
    left: 0,
    right: 0,
    border: `1px solid ${colors.borderStrong}`,
    borderRadius: radii.md,
    background: colors.bgOverlay,
    boxShadow: shadows.sh4,
    padding: '7px 6px',
    zIndex: 10
  },
  option: {
    width: '100%',
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '9px 10px',
    fontSize: 14,
    fontFamily: fonts.body,
    color: colors.text2,
    background: 'transparent',
    border: 'none',
    borderRadius: radii.sm,
    cursor: 'pointer',
    textAlign: 'left',
    appearance: 'none',
    WebkitAppearance: 'none',
    outline: 'none',
    // role="option"+aria-selected forces Chromium on Windows to repaint the
    // background with the system Highlight color (forced-colors for ARIA listbox
    // patterns), ignoring any inline style — which is why our active gradient
    // wasn't visible. forced-color-adjust:none tells the engine to leave our look as is.
    forcedColorAdjust: 'none'
  } as React.CSSProperties,
  optionHover: { background: colors.bgHover, color: colors.text1 },
  optionActive: {
    color: colors.text1,
    background: 'linear-gradient(90deg, rgba(54,226,232,.14), rgba(54,226,232,.04))'
  }
}

export default Select

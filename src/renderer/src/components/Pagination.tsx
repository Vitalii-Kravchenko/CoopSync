import { useState } from 'react'
import { colors, fonts, gradients, radii, shadows, transitions } from '../theme'
import { useI18n } from '../i18n'
import { ChevronLeftIcon, ChevronRightIcon } from './icons'

interface Props {
  /** 1-indexed. */
  page: number
  totalPages: number
  onChange: (page: number) => void
}

function range(start: number, end: number): number[] {
  const out: number[] = []
  for (let i = start; i <= end; i++) out.push(i)
  return out
}

const SIBLINGS = 1

// "1 2 3 … 12" — full range when it's short enough to just show, otherwise
// first/last page pinned with a sliding window around the current page and
// an ellipsis filling whatever gap is left. Matches design-system 4.12.
function pageList(current: number, total: number): (number | 'dots')[] {
  const totalNumbers = SIBLINGS * 2 + 5
  if (total <= totalNumbers) return range(1, total)

  const leftSibling = Math.max(current - SIBLINGS, 1)
  const rightSibling = Math.min(current + SIBLINGS, total)
  const showLeftDots = leftSibling > 2
  const showRightDots = rightSibling < total - 1

  if (!showLeftDots && showRightDots) return [...range(1, 3 + SIBLINGS * 2), 'dots', total]
  if (showLeftDots && !showRightDots) {
    return [1, 'dots', ...range(total - (3 + SIBLINGS * 2) + 1, total)]
  }
  return [1, 'dots', ...range(leftSibling, rightSibling), 'dots', total]
}

function Pagination({ page, totalPages, onChange }: Props): React.JSX.Element | null {
  const { t } = useI18n()
  if (totalPages <= 1) return null

  return (
    <div style={styles.wrap}>
      <ArrowButton disabled={page === 1} label={t.history.pagePrev} onClick={() => onChange(page - 1)}>
        <ChevronLeftIcon size={14} />
      </ArrowButton>
      {pageList(page, totalPages).map((item, i) =>
        item === 'dots' ? (
          <span key={`dots-${i}`} style={styles.dots}>
            …
          </span>
        ) : (
          <PageButton key={item} active={item === page} onClick={() => onChange(item)}>
            {item}
          </PageButton>
        )
      )}
      <ArrowButton
        disabled={page === totalPages}
        label={t.history.pageNext}
        onClick={() => onChange(page + 1)}
      >
        <ChevronRightIcon size={14} />
      </ArrowButton>
    </div>
  )
}

function PageButton({
  active,
  onClick,
  children
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}): React.JSX.Element {
  const [hover, setHover] = useState(false)
  return (
    <button
      style={{
        ...styles.btn,
        background: active ? gradients.energy : hover ? colors.bgHover : colors.bgRaised,
        border: active ? 'none' : `1px solid ${colors.borderDefault}`,
        color: active ? colors.textOnAccent : colors.text2,
        boxShadow: active ? shadows.glowCy : 'none'
      }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onClick={onClick}
    >
      {children}
    </button>
  )
}

function ArrowButton({
  disabled,
  label,
  onClick,
  children
}: {
  disabled: boolean
  label: string
  onClick: () => void
  children: React.ReactNode
}): React.JSX.Element {
  const [hover, setHover] = useState(false)
  return (
    <button
      disabled={disabled}
      aria-label={label}
      title={label}
      style={{
        ...styles.btn,
        color: disabled ? colors.text3 : colors.text2,
        background: !disabled && hover ? colors.bgHover : colors.bgRaised,
        border: `1px solid ${colors.borderDefault}`,
        cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.5 : 1
      }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onClick={onClick}
    >
      {children}
    </button>
  )
}

const styles: Record<string, React.CSSProperties> = {
  wrap: { display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 16 },
  btn: {
    width: 32,
    height: 32,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontFamily: fonts.mono,
    fontSize: 12.5,
    borderRadius: radii.sm,
    cursor: 'pointer',
    transition: `background ${transitions.fast}, color ${transitions.fast}`
  },
  dots: {
    width: 32,
    textAlign: 'center',
    color: colors.text3,
    fontFamily: fonts.mono,
    fontSize: 12.5
  }
}

export default Pagination

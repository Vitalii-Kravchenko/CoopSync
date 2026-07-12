import { useState } from 'react'
import { colors, fonts, gradients, radii, shadows, transitions } from '../theme'
import { useI18n } from '../i18n'
import { LibraryIcon, FriendsIcon, HistoryIcon, SettingsIcon } from './icons'

export type Screen = 'main' | 'friends' | 'history' | 'settings'

// Фон активного пункту навігації — той самий, що й у дизайн-системі
// (docs/design-system.html, 4.12 Навігація): одноколірний ціановий фейд
// зліва направо, а не двоколірний grad-energy (той — лише для CTA/акцентних смужок).
const ACTIVE_BG = 'linear-gradient(90deg, rgba(54,226,232,.14), transparent)'

interface Props {
  active: Screen
  onNavigate: (screen: Screen) => void
}

// Ліва панель: зверху розділи, "Налаштування" — внизу.
// Активний пункт має фірмову акцентну смужку зліва + м'який градієнтний фон.
function Sidebar({ active, onNavigate }: Props): React.JSX.Element {
  const { t } = useI18n()
  return (
    <div style={styles.rail}>
      <div style={styles.top}>
        <NavItem
          icon={<LibraryIcon size={16} />}
          label={t.sidebar.games}
          active={active === 'main'}
          onClick={() => onNavigate('main')}
        />
        <NavItem
          icon={<FriendsIcon size={16} />}
          label={t.sidebar.friends}
          active={active === 'friends'}
          onClick={() => onNavigate('friends')}
        />
        <NavItem
          icon={<HistoryIcon size={16} />}
          label={t.sidebar.history}
          active={active === 'history'}
          onClick={() => onNavigate('history')}
        />
      </div>

      <NavItem
        icon={<SettingsIcon size={16} />}
        label={t.sidebar.settings}
        active={active === 'settings'}
        onClick={() => onNavigate('settings')}
      />
    </div>
  )
}

function NavItem({
  icon,
  label,
  active,
  onClick
}: {
  icon: React.ReactNode
  label: string
  active: boolean
  onClick: () => void
}): React.JSX.Element {
  const [hover, setHover] = useState(false)

  return (
    <button
      className="nav-item"
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        ...styles.item,
        background: active ? ACTIVE_BG : hover ? colors.bgHover : 'transparent',
        color: active ? colors.text1 : hover ? colors.text1 : colors.text3
      }}
    >
      {active && <span style={styles.accentBar} />}
      <span style={{ display: 'flex' }}>{icon}</span>
      {label}
    </button>
  )
}

const styles: Record<string, React.CSSProperties> = {
  rail: {
    // gridArea — App.tsx монтує <Sidebar> останнім серед дітей appBody (щоб
    // Tab доходив до нав-пунктів тільки після контенту поточної вкладки),
    // тож зліва його ставить лише ця grid-область, не DOM-порядок.
    gridArea: 'sidebar',
    background: colors.bgBase,
    borderRight: `1px solid ${colors.borderSubtle}`,
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'space-between',
    padding: 10,
    minHeight: 0
  },
  top: { display: 'flex', flexDirection: 'column', gap: 2 },
  item: {
    position: 'relative',
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    height: 38,
    padding: '0 12px',
    border: 'none',
    borderRadius: radii.sm,
    fontFamily: fonts.body,
    fontSize: 13.5,
    fontWeight: 500,
    cursor: 'pointer',
    textAlign: 'left',
    transition: `background ${transitions.fast}, color ${transitions.fast}`
  },
  accentBar: {
    position: 'absolute',
    left: 0,
    top: 7,
    bottom: 7,
    width: 3,
    borderRadius: 2,
    background: gradients.energy,
    boxShadow: shadows.glowCy
  }
}

export default Sidebar

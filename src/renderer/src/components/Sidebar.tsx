import { useState } from 'react'
import { colors, fonts, gradients, radii, shadows } from '../theme'
import { useI18n } from '../i18n'
import { LibraryIcon, FriendsIcon, HistoryIcon, SettingsIcon } from './icons'

export type Screen = 'main' | 'friends' | 'history' | 'settings'

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
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        ...styles.item,
        background: active ? gradients.energySoft : hover ? colors.bgHover : 'transparent',
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
    width: 196,
    background: colors.bgBase,
    borderRight: `1px solid ${colors.borderSubtle}`,
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'space-between',
    padding: 10,
    flexShrink: 0
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
    transition: 'background .12s, color .12s'
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

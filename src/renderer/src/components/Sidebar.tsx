import { useEffect, useState } from 'react'
import { colors, fonts, gradients, radii, shadows, transitions } from '../theme'
import { useI18n } from '../i18n'
import { LibraryIcon, FriendsIcon, HistoryIcon, SettingsIcon } from './icons'

export type Screen = 'main' | 'friends' | 'history' | 'settings'

// Active nav item background — the same one used in the design system
// (docs/design-system.html, 4.12 Navigation): a single-color cyan fade
// left to right, not the two-color grad-energy (that one is only for CTA/accent stripes).
const ACTIVE_BG = 'linear-gradient(90deg, rgba(54,226,232,.14), transparent)'

interface Props {
  active: Screen
  onNavigate: (screen: Screen) => void
}

// Left panel: sections at the top, "Settings" at the bottom.
// The active item has the brand accent stripe on the left + a soft gradient background.
function Sidebar({ active, onNavigate }: Props): React.JSX.Element {
  const { t } = useI18n()
  // Small dot on "Settings" when an update is ready — the only hint outside
  // the Settings screen itself, since the auto-update check runs silently in
  // the background (no popups) shortly after launch.
  const [updateAvailable, setUpdateAvailable] = useState(false)

  useEffect(() => {
    return window.api.updater.onStatus((status) => {
      setUpdateAvailable(status.state === 'available' || status.state === 'downloaded')
    })
  }, [])

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
        dot={updateAvailable}
      />
    </div>
  )
}

function NavItem({
  icon,
  label,
  active,
  onClick,
  dot
}: {
  icon: React.ReactNode
  label: string
  active: boolean
  onClick: () => void
  dot?: boolean
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
      <span style={{ display: 'flex', position: 'relative' }}>
        {icon}
        {dot && <span style={styles.updateDot} />}
      </span>
      {label}
    </button>
  )
}

const styles: Record<string, React.CSSProperties> = {
  rail: {
    // gridArea — App.tsx mounts <Sidebar> last among appBody's children (so
    // Tab reaches the nav items only after the current tab's content),
    // so it's placed on the left only by this grid area, not by DOM order.
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
  },
  updateDot: {
    position: 'absolute',
    top: -2,
    right: -3,
    width: 7,
    height: 7,
    borderRadius: '50%',
    background: colors.cy,
    boxShadow: shadows.glowCy
  }
}

export default Sidebar

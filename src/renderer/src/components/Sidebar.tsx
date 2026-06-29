import { colors } from '../theme'

export type Screen = 'main' | 'settings'

interface Props {
  active: Screen
  onNavigate: (screen: Screen) => void
}

// Ліва панель (Варіант Б): зверху розділи, кнопка "Налаштування" — внизу.
function Sidebar({ active, onNavigate }: Props): React.JSX.Element {
  return (
    <div style={styles.rail}>
      <div style={styles.top}>
        <RailButton icon="🎮" label="Ігри" active={active === 'main'} onClick={() => onNavigate('main')} />
      </div>

      <RailButton
        icon="⚙️"
        label="Налаштування"
        active={active === 'settings'}
        onClick={() => onNavigate('settings')}
      />
    </div>
  )
}

function RailButton({
  icon,
  label,
  active,
  onClick
}: {
  icon: string
  label: string
  active: boolean
  onClick: () => void
}): React.JSX.Element {
  return (
    <button
      title={label}
      onClick={onClick}
      style={{ ...styles.railBtn, ...(active ? styles.railBtnActive : {}) }}
    >
      {icon}
    </button>
  )
}

const styles: Record<string, React.CSSProperties> = {
  rail: {
    width: 64,
    background: colors.bgDark,
    borderRight: `1px solid ${colors.surface}`,
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '16px 0',
    flexShrink: 0
  },
  top: { display: 'flex', flexDirection: 'column', gap: 6 },
  railBtn: {
    width: 46,
    height: 46,
    borderRadius: 12,
    border: 'none',
    background: 'transparent',
    color: colors.muted,
    fontSize: 20,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center'
  },
  railBtnActive: { background: colors.surface, color: colors.accent }
}

export default Sidebar

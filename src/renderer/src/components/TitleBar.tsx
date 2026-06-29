import { colors } from '../theme'
import { GitHubIcon } from './icons'
import WindowControls from './WindowControls'
import type { AuthUser } from '../../../shared/types'

interface Props {
  user: AuthUser | null
}

// Власний titlebar (вікно frameless). Уся смуга — зона перетягування,
// інтерактивні елементи позначені класом no-drag.
function TitleBar({ user }: Props): React.JSX.Element {
  return (
    <div className="drag" style={styles.bar}>
      <div style={styles.left}>
        <div style={styles.logo}>🎮</div>
        <span style={styles.brand}>CoopSync</span>
      </div>

      <div style={styles.right}>
        {user && (
          <div className="no-drag" style={styles.userPill}>
            <div style={styles.avatar}>
              <GitHubIcon size={16} />
            </div>
            <span style={styles.userName}>{user.login}</span>
          </div>
        )}

        <div className="no-drag">
          <WindowControls />
        </div>
      </div>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  bar: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    height: 56,
    padding: '0 8px 0 18px',
    background: colors.bgDark,
    borderBottom: `1px solid ${colors.surface}`,
    flexShrink: 0
  },
  left: { display: 'flex', alignItems: 'center', gap: 11 },
  logo: {
    width: 28,
    height: 28,
    borderRadius: 8,
    background: 'linear-gradient(135deg,#89b4fa,#cba6f7)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 16
  },
  brand: { fontWeight: 700, fontSize: 16, color: colors.text },
  right: { display: 'flex', alignItems: 'center', gap: 12 },
  userPill: {
    display: 'flex',
    alignItems: 'center',
    gap: 9,
    height: 38,
    padding: '0 16px 0 5px',
    background: colors.surface,
    border: `1px solid ${colors.border}`,
    borderRadius: 19
  },
  avatar: {
    width: 28,
    height: 28,
    borderRadius: '50%',
    background: colors.bgDarker,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center'
  },
  userName: { fontSize: 13, color: colors.text, fontWeight: 500 }
}

export default TitleBar

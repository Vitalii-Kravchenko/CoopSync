import { colors, fonts, radii, shadows } from '../theme'
import { GitHubIcon, Logo } from './icons'
import WindowControls from './WindowControls'
import type { AuthUser } from '../../../shared/types'

interface Props {
  user: AuthUser | null
  /** Кастомний аватар (data URL) — той самий, що обраний у Settings. */
  avatarDataUrl?: string | null
}

// Власний titlebar (вікно frameless). Уся смуга — зона перетягування,
// інтерактивні елементи позначені класом no-drag.
function TitleBar({ user, avatarDataUrl }: Props): React.JSX.Element {
  return (
    <div className="drag" style={styles.bar}>
      <div style={styles.left}>
        <Logo size={22} />
        <span style={styles.brand}>CoopSync</span>
      </div>

      <div style={styles.right}>
        {user && (
          <div className="no-drag" style={styles.userPill}>
            <div style={styles.onlineDot} />
            <div style={styles.avatar}>
              {avatarDataUrl ? (
                <img src={avatarDataUrl} alt="" style={styles.avatarImg} />
              ) : (
                <GitHubIcon size={16} />
              )}
            </div>
            <span style={styles.userName}>{user.login}</span>
          </div>
        )}

        <div className="no-drag" style={{ display: 'flex', height: '100%' }}>
          <WindowControls />
        </div>
      </div>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  bar: {
    display: 'flex',
    alignItems: 'stretch',
    justifyContent: 'space-between',
    height: 52,
    padding: '0 0 0 18px',
    background: colors.bgBase,
    borderBottom: `1px solid ${colors.borderSubtle}`,
    flexShrink: 0
  },
  left: { display: 'flex', alignItems: 'center', gap: 11 },
  brand: {
    fontFamily: fonts.display,
    fontWeight: 700,
    fontSize: 15,
    letterSpacing: '.02em',
    color: colors.text1
  },
  right: { display: 'flex', alignItems: 'center', gap: 12 },
  userPill: {
    display: 'flex',
    alignItems: 'center',
    gap: 9,
    height: 34,
    padding: '0 14px 0 5px',
    background: colors.bgRaised,
    border: `1px solid ${colors.borderDefault}`,
    borderRadius: radii.pill,
    boxShadow: shadows.sheen
  },
  onlineDot: {
    width: 6,
    height: 6,
    borderRadius: '50%',
    background: colors.success,
    boxShadow: `0 0 8px ${colors.success}`,
    marginLeft: 6
  },
  avatar: {
    width: 24,
    height: 24,
    borderRadius: '50%',
    background: colors.bgInset,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden'
  },
  avatarImg: { width: '100%', height: '100%', objectFit: 'cover' },
  userName: { fontSize: 12.5, color: colors.text1, fontWeight: 500 }
}

export default TitleBar

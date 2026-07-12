import { useState } from 'react'
import { colors, fonts, radii, shadows } from '../theme'
import { useI18n } from '../i18n'
import { Logo, SupportIcon } from './icons'
import Avatar from './Avatar'
import WindowControls from './WindowControls'
import SupportModal from './SupportModal'
import type { AuthUser } from '../../../shared/types'

interface Props {
  user: AuthUser | null
  /** Custom avatar (data URL) — the same one selected in Settings. */
  avatarDataUrl?: string | null
}

// Custom titlebar (frameless window). The whole bar is a drag region,
// interactive elements are marked with the no-drag class.
function TitleBar({ user, avatarDataUrl }: Props): React.JSX.Element {
  const { t } = useI18n()
  const [supportOpen, setSupportOpen] = useState(false)

  return (
    <>
      <div className="drag" style={styles.bar}>
        <div style={styles.left}>
          <Logo size={22} />
          <span style={styles.brand}>CoopSync</span>
        </div>

        <div style={styles.right}>
          {user && (
            <button
              className="icon-btn no-drag"
              style={styles.supportBtn}
              onClick={() => setSupportOpen(true)}
              title={t.support.tooltip}
              aria-label={t.support.tooltip}
            >
              <SupportIcon size={16} />
              <span style={styles.supportBtnLabel}>{t.support.tooltip}</span>
            </button>
          )}
          {user && (
            <div className="no-drag" style={styles.userPill}>
              <div style={styles.onlineDot} />
              <Avatar src={avatarDataUrl} size={24} />
              <span style={styles.userName}>{user.login}</span>
            </div>
          )}

          <div className="no-drag" style={{ display: 'flex', height: '100%' }}>
            <WindowControls />
          </div>
        </div>
      </div>

      {supportOpen && <SupportModal onClose={() => setSupportOpen(false)} />}
    </>
  )
}

const styles: Record<string, React.CSSProperties> = {
  bar: {
    // gridArea — App.tsx mounts <TitleBar> last in the DOM (so Tab reaches
    // Support/window buttons only after the content and Sidebar), so
    // the visual "top" position is held only by this grid area, not DOM order.
    gridArea: 'titlebar',
    display: 'flex',
    alignItems: 'stretch',
    justifyContent: 'space-between',
    height: 52,
    padding: '0 0 0 18px',
    background: colors.bgBase,
    borderBottom: `1px solid ${colors.borderSubtle}`
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
  // Height 34px — to align with userPill (also 34px) in the compact 52px
  // titlebar; the .icon-btn class itself (design system 4.1) defaults to a 40x40
  // square for regular toolbar contexts, but here it has text, hence width auto.
  supportBtn: { width: 'auto', height: 34, padding: '0 14px 0 12px', gap: 8 },
  supportBtnLabel: { fontFamily: fonts.display, fontWeight: 600, fontSize: 12.5 },
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
  userName: { fontSize: 12.5, color: colors.text1, fontWeight: 500 }
}

export default TitleBar

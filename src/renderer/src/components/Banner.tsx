import { colors, fonts, radii, shadows } from '../theme'
import { UploadIcon, DownloadIcon, CheckIcon } from './icons'

export interface BannerState {
  text: string
  kind: 'success' | 'info' | 'error' | 'warning'
  /** Sync icon (own UploadIcon/DownloadIcon) if the banner is about push/pull. */
  icon?: 'upload' | 'download'
}

interface Props {
  banner: BannerState | null
}

const TONE: Record<BannerState['kind'], { color: string; bg: string; bd: string }> = {
  success: { color: colors.success, bg: colors.successBg, bd: colors.successBd },
  info: { color: colors.info, bg: colors.infoBg, bd: colors.infoBd },
  warning: { color: colors.warning, bg: colors.warningBg, bd: colors.warningBd },
  error: { color: colors.danger, bg: colors.dangerBg, bd: colors.dangerBd }
}

// Global sync toast — rendered at the App level, outside the tabs,
// so it stays visible regardless of which tab is currently open.
function Banner({ banner }: Props): React.JSX.Element | null {
  if (!banner) return null

  const tone = TONE[banner.kind]

  return (
    <div style={{ ...styles.banner, borderColor: tone.bd }}>
      <span style={{ ...styles.iconChip, background: tone.bg }}>
        {banner.icon === 'upload' ? (
          <UploadIcon size={14} color={tone.color} />
        ) : banner.icon === 'download' ? (
          <DownloadIcon size={14} color={tone.color} />
        ) : banner.kind === 'success' ? (
          <CheckIcon size={14} color={tone.color} />
        ) : (
          <span style={{ ...styles.bannerDot, background: tone.color }} />
        )}
      </span>
      <span style={styles.text}>{banner.text}</span>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  banner: {
    position: 'fixed',
    bottom: 22,
    left: '50%',
    transform: 'translateX(-50%)',
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    padding: '10px 14px 10px 16px',
    borderRadius: radii.md,
    border: '1px solid',
    background: colors.bgOverlay,
    color: colors.text1,
    boxShadow: `${shadows.sh3}, ${shadows.sheen}`,
    zIndex: 100
  },
  iconChip: {
    width: 32,
    height: 32,
    borderRadius: '50%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0
  },
  text: { fontFamily: fonts.body, fontWeight: 600, fontSize: 13.5 },
  bannerDot: { width: 6, height: 6, borderRadius: '50%' }
}

export default Banner

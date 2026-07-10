import { colors, fonts, radii, shadows } from '../theme'
import { UploadIcon, DownloadIcon } from './icons'

export interface BannerState {
  text: string
  kind: 'success' | 'info' | 'error' | 'warning'
  /** Іконка синку (свій UploadIcon/DownloadIcon), якщо банер про push/pull. */
  icon?: 'upload' | 'download'
}

interface Props {
  banner: BannerState | null
}

// Глобальний тост про синхронізацію — рендериться на рівні App, поза табами,
// щоб бути видимим незалежно від того, яка вкладка зараз відкрита.
function Banner({ banner }: Props): React.JSX.Element | null {
  if (!banner) return null

  return (
    <div
      style={{
        ...styles.banner,
        borderColor:
          banner.kind === 'error'
            ? colors.dangerBd
            : banner.kind === 'warning'
              ? colors.warningBd
              : banner.kind === 'info'
                ? colors.infoBd
                : colors.successBd
      }}
    >
      {banner.icon ? (
        banner.icon === 'upload' ? (
          <UploadIcon size={14} color={colors.success} />
        ) : (
          <DownloadIcon size={14} color={colors.success} />
        )
      ) : (
        <span
          style={{
            ...styles.bannerDot,
            background:
              banner.kind === 'error'
                ? colors.danger
                : banner.kind === 'warning'
                  ? colors.warning
                  : banner.kind === 'info'
                    ? colors.info
                    : colors.success
          }}
        />
      )}
      {banner.text}
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
    gap: 10,
    padding: '12px 20px',
    borderRadius: radii.md,
    border: '1px solid',
    background: colors.bgOverlay,
    color: colors.text1,
    fontFamily: fonts.body,
    fontWeight: 600,
    fontSize: 13.5,
    boxShadow: shadows.sh3,
    zIndex: 100
  },
  bannerDot: { width: 6, height: 6, borderRadius: '50%', flexShrink: 0 }
}

export default Banner

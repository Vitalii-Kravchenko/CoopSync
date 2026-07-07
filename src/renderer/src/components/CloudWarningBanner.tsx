import { colors, fonts, radii, shadows } from '../theme'
import { CloseIcon } from './icons'
import { useI18n } from '../i18n'

interface Props {
  onDismiss: () => void
}

function CloudWarningBanner({ onDismiss }: Props): React.JSX.Element {
  const { t } = useI18n()

  return (
    <div style={styles.wrap}>
      <div style={styles.textBlock}>
        <div style={styles.title}>⚠️ {t.cloudWarning.title}</div>
        <div style={styles.message}>{t.cloudWarning.message}</div>
        <div style={styles.instructions}>{t.cloudWarning.instructions}</div>
        <div style={styles.settingsHint}>{t.cloudWarning.settingsHint}</div>
      </div>
      <button
        style={styles.closeBtn}
        onClick={onDismiss}
        aria-label={t.cloudWarning.dismiss}
        title={t.cloudWarning.dismiss}
      >
        <CloseIcon size={16} color={colors.text2} />
      </button>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  wrap: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 16,
    padding: '14px 18px',
    marginBottom: 24,
    borderRadius: radii.lg,
    border: `1px solid ${colors.warningBd}`,
    background: colors.warningBg,
    boxShadow: shadows.sheen
  },
  textBlock: { flex: 1 },
  title: {
    fontFamily: fonts.display,
    fontSize: 14.5,
    fontWeight: 600,
    color: colors.text1,
    marginBottom: 4
  },
  message: {
    fontFamily: fonts.body,
    fontSize: 13,
    color: colors.text2,
    lineHeight: 1.5,
    marginBottom: 4
  },
  instructions: {
    fontFamily: fonts.mono,
    fontSize: 12,
    color: colors.text2,
    lineHeight: 1.5,
    marginBottom: 6
  },
  settingsHint: {
    fontFamily: fonts.body,
    fontSize: 11.5,
    color: colors.text3
  },
  closeBtn: {
    background: 'transparent',
    border: 'none',
    cursor: 'pointer',
    padding: 4,
    borderRadius: radii.sm,
    display: 'flex',
    flexShrink: 0
  }
}

export default CloudWarningBanner

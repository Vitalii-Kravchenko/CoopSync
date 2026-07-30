import { colors, fonts, radii, shadows } from '../theme'
import { CloseIcon } from './icons'
import { useI18n } from '../i18n'

interface Props {
  /** Names of the affected games, already resolved from CloudSyncConflict[]. */
  gameNames: string[]
  onDismiss: () => void
}

function OneDriveWarningBanner({ gameNames, onDismiss }: Props): React.JSX.Element {
  const { t } = useI18n()

  return (
    <div style={styles.wrap}>
      <div style={styles.textBlock}>
        <div style={styles.title}>⚠️ {t.oneDriveWarning.title}</div>
        <div style={styles.message}>{t.oneDriveWarning.message}</div>
        <div style={styles.games}>{t.oneDriveWarning.gamesLabel(gameNames.join(', '))}</div>
        <div style={styles.instructions}>{t.oneDriveWarning.instructions}</div>
        <div style={styles.settingsHint}>{t.oneDriveWarning.settingsHint}</div>
      </div>
      <button
        className="icon-btn-plain"
        style={styles.closeBtn}
        onClick={onDismiss}
        aria-label={t.oneDriveWarning.dismiss}
        title={t.oneDriveWarning.dismiss}
      >
        <CloseIcon size={15} />
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
    borderRadius: radii.md,
    border: `1px solid ${colors.warningBd}`,
    borderLeft: `3px solid ${colors.warning}`,
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
  games: {
    fontFamily: fonts.body,
    fontSize: 13,
    fontWeight: 600,
    color: colors.text1,
    marginBottom: 4
  },
  instructions: {
    fontFamily: fonts.body,
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
  closeBtn: { flexShrink: 0 }
}

export default OneDriveWarningBanner

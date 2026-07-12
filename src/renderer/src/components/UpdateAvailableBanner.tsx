import { colors, fonts, radii, shadows } from '../theme'
import { CloseIcon } from './icons'
import { useI18n } from '../i18n'
import Button from './Button'
import type { UpdateStatus } from '../../../shared/types'

interface Props {
  /** Only 'available' | 'downloading' | 'downloaded' ever get here — MainScreen
   *  gates rendering on that, so this component doesn't need an 'idle' case. */
  status: Extract<UpdateStatus, { state: 'available' | 'downloading' | 'downloaded' }>
  onDismiss: () => void
}

function UpdateAvailableBanner({ status, onDismiss }: Props): React.JSX.Element {
  const { t } = useI18n()

  return (
    <div style={styles.wrap}>
      <div style={styles.textBlock}>
        <div style={styles.title}>
          🔔 {status.state === 'downloaded' ? t.updateBanner.readyTitle : t.updateBanner.title}
        </div>
        <div style={styles.message}>
          {status.state === 'available' && t.updateBanner.message(status.version)}
          {status.state === 'downloading' && t.settings.updateDownloading(status.percent)}
          {status.state === 'downloaded' && t.updateBanner.readyMessage}
        </div>
      </div>
      {status.state === 'available' && (
        <Button variant="primary" style={styles.actionBtn} onClick={() => window.api.updater.download()}>
          {t.settings.downloadUpdate}
        </Button>
      )}
      {status.state === 'downloaded' && (
        <Button variant="primary" style={styles.actionBtn} onClick={() => window.api.updater.install()}>
          {t.settings.restartToInstall}
        </Button>
      )}
      <button
        className="icon-btn-plain"
        style={styles.closeBtn}
        onClick={onDismiss}
        aria-label={t.cloudWarning.dismiss}
        title={t.cloudWarning.dismiss}
      >
        <CloseIcon size={15} />
      </button>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  wrap: {
    display: 'flex',
    alignItems: 'center',
    gap: 16,
    padding: '14px 18px',
    marginBottom: 24,
    borderRadius: radii.md,
    border: `1px solid ${colors.infoBd}`,
    borderLeft: `3px solid ${colors.info}`,
    background: colors.infoBg,
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
    lineHeight: 1.5
  },
  actionBtn: { flexShrink: 0, height: 34, padding: '0 16px', fontSize: 13 },
  closeBtn: { flexShrink: 0 }
}

export default UpdateAvailableBanner

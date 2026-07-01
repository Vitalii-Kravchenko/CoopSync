import { useState } from 'react'
import { colors, fonts, gradients, radii, shadows, steamPoster } from '../theme'
import { useI18n } from '../i18n'
import type { Translation } from '../i18n'
import { UploadIcon, DownloadIcon } from './icons'
import type { SyncStatus } from '../../../shared/types'

interface Props {
  appId: string
  name: string
  installed: boolean
  /** Чи підтримує CoopSync цю гру (default true). */
  supported?: boolean
  /** Статус синку (тільки для встановлених). undefined = ще перевіряємо. */
  syncStatus?: SyncStatus
  /** Версія локальних сейвів. */
  localVersion?: number
  /** Версія сейвів на GitHub. */
  remoteVersion?: number
  /** Триває синхронізація саме цієї гри. */
  busy?: boolean
  onUpload?: () => void
  onDownload?: () => void
}

// "1" → "v1.001", 0/undefined → "—".
function fmtVersion(n: number | undefined): string {
  return n && n > 0 ? `v1.${String(n).padStart(3, '0')}` : '—'
}

// Як показати статус синку: колір, крапка, текст (бейдж-пілюля).
function syncDisplay(
  s: SyncStatus | undefined,
  t: Translation
): { color: string; bg: string; bd: string; text: string } {
  switch (s) {
    case 'synced':
      return { color: colors.success, bg: colors.successBg, bd: colors.successBd, text: t.gameCard.statusSynced }
    case 'local-newer':
      return { color: colors.warning, bg: colors.warningBg, bd: colors.warningBd, text: t.gameCard.statusLocalNewer }
    case 'remote-newer':
      return { color: colors.info, bg: colors.infoBg, bd: colors.infoBd, text: t.gameCard.statusRemoteNewer }
    case 'not-uploaded':
      return {
        color: colors.text3,
        bg: 'rgba(255,255,255,.04)',
        bd: colors.borderDefault,
        text: t.gameCard.statusNotUploaded
      }
    case 'cloud-only':
      return { color: colors.info, bg: colors.infoBg, bd: colors.infoBd, text: t.gameCard.statusCloudOnly }
    case 'no-saves':
      return {
        color: colors.text3,
        bg: 'rgba(255,255,255,.04)',
        bd: colors.borderDefault,
        text: t.gameCard.statusNoSaves
      }
    default:
      return {
        color: colors.text3,
        bg: 'rgba(255,255,255,.04)',
        bd: colors.borderDefault,
        text: t.gameCard.statusChecking
      }
  }
}

function GameCard({
  appId,
  name,
  installed,
  supported = true,
  syncStatus,
  localVersion,
  remoteVersion,
  busy,
  onUpload,
  onDownload
}: Props): React.JSX.Element {
  const { t } = useI18n()
  const [hover, setHover] = useState(false)
  const [imgError, setImgError] = useState(false)

  // Грати/синхронізувати можна лише встановлену + підтримувану гру.
  const playable = installed && supported
  const showOverlay = (hover || busy) && playable
  const status = playable ? syncDisplay(syncStatus, t) : null

  return (
    <div
      style={styles.wrap}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <div
        style={{
          ...styles.poster,
          filter: playable ? 'none' : 'grayscale(0.6) brightness(0.5)',
          borderColor: showOverlay ? colors.borderAccent : colors.borderSubtle,
          boxShadow: showOverlay ? `${shadows.sh4}, ${shadows.glowCy}` : shadows.sh2
        }}
      >
        {!imgError ? (
          <img
            src={steamPoster(appId)}
            alt={name}
            style={styles.img}
            onError={() => setImgError(true)}
          />
        ) : (
          <div style={styles.fallback}>{name}</div>
        )}

        {installed && !supported && <div style={styles.unsupported}>{t.gameCard.unsupported}</div>}

        {showOverlay && (
          <div style={styles.overlay}>
            {busy ? (
              <div style={styles.syncing}>{t.gameCard.syncing}</div>
            ) : (
              <>
                <button title={t.gameCard.upload} style={styles.circleBtnPrimary} onClick={onUpload}>
                  <UploadIcon size={16} color={colors.textOnAccent} />
                </button>
                <button title={t.gameCard.download} style={styles.circleBtnSecondary} onClick={onDownload}>
                  <DownloadIcon size={16} color={colors.text1} />
                </button>
              </>
            )}
          </div>
        )}
      </div>

      <div style={styles.caption}>
        <div style={styles.name}>{name}</div>
        {status && (
          <span style={{ ...styles.badge, color: status.color, background: status.bg, borderColor: status.bd }}>
            <span style={{ ...styles.badgeDot, background: status.color }} />
            {status.text}
          </span>
        )}
        {playable && (
          <div style={styles.versions}>
            {t.gameCard.versions(fmtVersion(localVersion), fmtVersion(remoteVersion))}
          </div>
        )}
        {installed && !supported && <div style={styles.notInstalled}>{t.gameCard.gameNotSupported}</div>}
        {!installed && <div style={styles.notInstalled}>{t.gameCard.notInstalled}</div>}
      </div>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  wrap: { display: 'flex', flexDirection: 'column', gap: 10 },
  poster: {
    position: 'relative',
    aspectRatio: '2 / 3',
    borderRadius: radii.lg,
    overflow: 'hidden',
    background: `linear-gradient(160deg,${colors.bgRaised},${colors.bgBase})`,
    border: '1px solid',
    transition: 'box-shadow .18s ease, border-color .18s ease'
  },
  img: { width: '100%', height: '100%', objectFit: 'cover', display: 'block' },
  fallback: {
    width: '100%',
    height: '100%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    textAlign: 'center',
    padding: 12,
    fontFamily: fonts.display,
    fontWeight: 700,
    fontSize: 17,
    textTransform: 'uppercase',
    color: colors.text1
  },
  overlay: {
    position: 'absolute',
    inset: 0,
    background: 'linear-gradient(180deg,rgba(6,8,13,.35),rgba(6,8,13,.92))',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12
  },
  circleBtnPrimary: {
    width: 42,
    height: 42,
    borderRadius: '50%',
    border: 'none',
    background: gradients.energy,
    boxShadow: shadows.glowCy,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer'
  },
  circleBtnSecondary: {
    width: 42,
    height: 42,
    borderRadius: '50%',
    border: `1px solid ${colors.borderStrong}`,
    background: 'rgba(255,255,255,.08)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer'
  },
  caption: { minWidth: 0 },
  name: {
    fontFamily: fonts.display,
    fontWeight: 600,
    fontSize: 14,
    color: colors.text1,
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis'
  },
  badge: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    height: 22,
    padding: '0 9px',
    marginTop: 6,
    fontFamily: fonts.display,
    fontWeight: 600,
    fontSize: 10.5,
    letterSpacing: '.03em',
    borderRadius: radii.pill,
    border: '1px solid'
  },
  badgeDot: { width: 5, height: 5, borderRadius: '50%', flexShrink: 0 },
  notInstalled: { marginTop: 6, fontSize: 12.5, color: colors.text3 },
  versions: {
    marginTop: 5,
    fontFamily: fonts.mono,
    fontSize: 10.5,
    color: colors.text3
  },
  syncing: { color: colors.text1, fontFamily: fonts.display, fontWeight: 600, fontSize: 13, textAlign: 'center' },
  unsupported: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    transform: 'translate(-50%, -50%) rotate(-8deg)',
    background: colors.warning,
    color: colors.bgVoid,
    fontFamily: fonts.display,
    fontSize: 12.5,
    fontWeight: 700,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    padding: '7px 16px',
    borderRadius: radii.sm,
    boxShadow: shadows.sh4,
    whiteSpace: 'nowrap'
  }
}

export default GameCard

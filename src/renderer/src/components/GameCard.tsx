import { useState } from 'react'
import { colors, fonts, radii, shadows, steamPoster, transitions } from '../theme'
import { useI18n } from '../i18n'
import type { Translation } from '../i18n'
import { UploadIcon, DownloadIcon, HistoryIcon, DiskIcon } from './icons'
import Button from './Button'
import type { SyncStatus } from '../../../shared/types'
import { formatVersion } from '../../../shared/format'

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
  /** ISO timestamp останнього push у хмару (спільний для обох гравців). */
  lastSyncAt?: string
  /** Розмір сейвів у байтах. */
  sizeBytes?: number
  /** Триває синхронізація саме цієї гри. */
  busy?: boolean
  onUpload?: () => void
  onDownload?: () => void
}

// 0/undefined → "—", інакше formatVersion.
function fmtVersion(n: number | undefined): string {
  return n && n > 0 ? formatVersion(n) : '—'
}

function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
}

// ISO timestamp → "Сьогодні, 14:32" / "Учора, 14:32" / "8 лип, 14:32" (локалізовано,
// день через Intl.RelativeTimeFormat — та сама фраза, що й у нативному календарі мови).
function formatLastSync(iso: string, locale: string): string {
  const date = new Date(iso)
  const dayDiff = Math.round((startOfDay(date) - startOfDay(new Date())) / 86_400_000)
  const time = new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' }).format(date)

  const dayPart =
    dayDiff >= -1 && dayDiff <= 1
      ? new Intl.RelativeTimeFormat(locale, { numeric: 'auto' }).format(dayDiff, 'day')
      : new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short' }).format(date)

  return `${dayPart.charAt(0).toUpperCase()}${dayPart.slice(1)}, ${time}`
}

// Байти → "482 KB" / "1.3 GB".
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB']
  let value = bytes / 1024
  let unitIndex = 0
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex++
  }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[unitIndex]}`
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
    case 'local-stale':
      return { color: colors.warning, bg: colors.warningBg, bd: colors.warningBd, text: t.gameCard.statusLocalStale }
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
    case 'no-repo':
      return {
        color: colors.text3,
        bg: 'rgba(255,255,255,.04)',
        bd: colors.borderDefault,
        text: t.gameCard.statusNoRepo
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
  lastSyncAt,
  sizeBytes,
  busy,
  onUpload,
  onDownload
}: Props): React.JSX.Element {
  const { t, language } = useI18n()
  const [hover, setHover] = useState(false)
  const [imgError, setImgError] = useState(false)

  // Грати/синхронізувати можна лише встановлену + підтримувану гру.
  const playable = installed && supported
  const showOverlay = (hover || busy) && playable
  const status = playable ? syncDisplay(syncStatus, t) : null

  return (
    <div style={styles.wrap}>
      <div
        style={{
          ...styles.poster,
          filter: playable ? 'none' : 'grayscale(0.6) brightness(0.5)',
          borderColor: showOverlay ? colors.borderAccent : colors.borderSubtle,
          boxShadow: showOverlay ? `${shadows.sh4}, ${shadows.glowCy}` : shadows.sh2
        }}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
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

        {playable && (
          <div
            style={{
              ...styles.overlay,
              opacity: showOverlay ? 1 : 0,
              pointerEvents: showOverlay ? 'auto' : 'none'
            }}
          >
            {busy ? (
              <div style={styles.syncing}>{t.gameCard.syncing}</div>
            ) : (
              <div style={styles.overlayContent}>
                <Button variant="primary" style={styles.overlayBtn} onClick={onUpload}>
                  <UploadIcon size={15} color={colors.textOnAccent} />
                  {t.gameCard.upload}
                </Button>
                <Button variant="secondary" style={styles.overlayBtn} onClick={onDownload}>
                  <DownloadIcon size={15} color={colors.text1} />
                  {t.gameCard.download}
                </Button>
                {(lastSyncAt || sizeBytes != null) && (
                  <div style={styles.overlayMeta}>
                    {lastSyncAt && (
                      <span
                        style={styles.overlayMetaItem}
                        title={`${t.gameCard.lastSyncLabel} ${formatLastSync(lastSyncAt, language)}`}
                      >
                        <HistoryIcon size={12} color={colors.text3} />
                        {formatLastSync(lastSyncAt, language)}
                      </span>
                    )}
                    {lastSyncAt && sizeBytes != null && <span style={styles.overlayMetaDot}>·</span>}
                    {sizeBytes != null && (
                      <span
                        style={styles.overlayMetaItem}
                        title={`${t.gameCard.savesSizeLabel} ${formatBytes(sizeBytes)}`}
                      >
                        <DiskIcon size={12} color={colors.text3} />
                        {formatBytes(sizeBytes)}
                      </span>
                    )}
                  </div>
                )}
              </div>
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
    transition: `box-shadow ${transitions.hover}, border-color ${transitions.hover}`
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
    padding: '0 16px',
    transition: `opacity ${transitions.fade}`
  },
  overlayContent: { display: 'flex', flexDirection: 'column', alignItems: 'stretch', gap: 8, width: '100%' },
  overlayBtn: { width: '100%', height: 36, fontSize: 12.5, padding: '0 10px' },
  overlayMeta: {
    marginTop: 4,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexWrap: 'wrap',
    gap: 6,
    fontFamily: fonts.mono,
    fontSize: 10.5,
    color: colors.text2,
    filter: 'drop-shadow(0 1px 2px rgba(0,0,0,.85))',
    lineHeight: 1.4
  },
  overlayMetaItem: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
    whiteSpace: 'nowrap'
  },
  overlayMetaDot: { color: colors.text3, opacity: 0.6 },
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
    minHeight: 22,
    padding: '4px 9px',
    marginTop: 6,
    fontFamily: fonts.display,
    fontWeight: 600,
    fontSize: 10.5,
    lineHeight: 1.3,
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

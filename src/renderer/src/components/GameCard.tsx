import { useState } from 'react'
import { colors, steamPoster } from '../theme'
import Button from './Button'
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

// Як показати статус синку: колір, іконка, текст.
function syncDisplay(s: SyncStatus | undefined): { color: string; icon: string; text: string } {
  switch (s) {
    case 'synced':
      return { color: colors.success, icon: '✓', text: 'Синхронізовано' }
    case 'local-newer':
      return { color: colors.warning, icon: '⬆️', text: 'Локальна новіша' }
    case 'remote-newer':
      return { color: colors.accent, icon: '⬇️', text: 'Є новіша в хмарі' }
    case 'not-uploaded':
      return { color: colors.muted, icon: '☁️', text: 'Не вивантажено' }
    case 'cloud-only':
      return { color: colors.accent, icon: '⬇️', text: 'Тільки в хмарі' }
    case 'no-saves':
      return { color: colors.muted, icon: '—', text: 'Сейвів нема' }
    default:
      return { color: colors.muted, icon: '…', text: 'Перевіряю…' }
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
  const [hover, setHover] = useState(false)
  const [imgError, setImgError] = useState(false)

  // Грати/синхронізувати можна лише встановлену + підтримувану гру.
  const playable = installed && supported
  const showOverlay = (hover || busy) && playable
  const status = playable ? syncDisplay(syncStatus) : null

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
          boxShadow: showOverlay ? '0 14px 34px rgba(0,0,0,0.6)' : '0 2px 6px rgba(0,0,0,0.35)'
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

        {installed && !supported && <div style={styles.unsupported}>Не підтримується</div>}

        {showOverlay && (
          <div style={styles.overlay}>
            {busy ? (
              <div style={styles.syncing}>⏳ Синхронізую…</div>
            ) : (
              <>
                <Button variant="primary" style={{ width: '100%' }} onClick={onUpload}>
                  ⬆️ Вивантажити
                </Button>
                <Button variant="secondary" style={{ width: '100%' }} onClick={onDownload}>
                  ⬇️ Завантажити
                </Button>
              </>
            )}
          </div>
        )}
      </div>

      <div style={styles.caption}>
        <div style={styles.name}>{name}</div>
        {status && (
          <div style={{ ...styles.status, color: status.color }}>
            <span>{status.icon}</span>
            <span>{status.text}</span>
          </div>
        )}
        {playable && (
          <div style={styles.versions}>
            Локально {fmtVersion(localVersion)} · Хмара {fmtVersion(remoteVersion)}
          </div>
        )}
        {installed && !supported && <div style={styles.notInstalled}>гра не підтримується</div>}
        {!installed && <div style={styles.notInstalled}>не встановлено</div>}
      </div>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  wrap: { display: 'flex', flexDirection: 'column', gap: 10 },
  poster: {
    position: 'relative',
    aspectRatio: '2 / 3',
    borderRadius: 10,
    overflow: 'hidden',
    background: 'linear-gradient(160deg,#313244,#1e1e2e)',
    border: `1px solid ${colors.border}`,
    transition: 'box-shadow .18s ease'
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
    fontWeight: 800,
    fontSize: 18,
    textTransform: 'uppercase',
    color: '#fff'
  },
  overlay: {
    position: 'absolute',
    inset: 0,
    background: 'rgba(17,17,27,0.88)',
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'center',
    gap: 11,
    padding: 16
  },
  btnPrimary: {
    height: 40,
    border: 'none',
    borderRadius: 8,
    background: colors.accent,
    color: colors.bgDarker,
    fontWeight: 700,
    fontSize: 14,
    cursor: 'pointer'
  },
  btnSecondary: {
    height: 40,
    border: `1px solid ${colors.border}`,
    borderRadius: 8,
    background: 'transparent',
    color: colors.text,
    fontWeight: 600,
    fontSize: 14,
    cursor: 'pointer'
  },
  caption: { minWidth: 0 },
  name: {
    fontWeight: 600,
    fontSize: 14.5,
    color: colors.text,
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis'
  },
  status: { display: 'flex', alignItems: 'center', gap: 6, marginTop: 4, fontSize: 12.5 },
  notInstalled: { marginTop: 4, fontSize: 12.5, color: colors.muted },
  versions: { marginTop: 3, fontSize: 11, color: colors.muted },
  syncing: { color: colors.text, fontWeight: 600, fontSize: 14, textAlign: 'center' },
  unsupported: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    transform: 'translate(-50%, -50%) rotate(-8deg)',
    background: colors.warning,
    color: '#1e1e2e',
    fontSize: 13,
    fontWeight: 800,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    padding: '7px 16px',
    borderRadius: 8,
    boxShadow: '0 6px 18px rgba(0,0,0,0.55)',
    whiteSpace: 'nowrap'
  }
}

export default GameCard

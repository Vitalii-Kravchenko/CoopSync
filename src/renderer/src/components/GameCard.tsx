import { useState } from 'react'
import { colors, steamPoster } from '../theme'
import Button from './Button'

interface Props {
  appId: string
  name: string
  installed: boolean
  /** Чи знайдено папку сейвів (тільки для встановлених). */
  saveFound?: boolean
  onUpload?: () => void
  onDownload?: () => void
}

function GameCard({ appId, name, installed, saveFound, onUpload, onDownload }: Props): React.JSX.Element {
  const [hover, setHover] = useState(false)
  const [imgError, setImgError] = useState(false)

  const showOverlay = hover && installed

  // Статус під карткою.
  let status: { color: string; icon: string; text: string } | null = null
  if (installed) {
    status = saveFound
      ? { color: colors.success, icon: '✓', text: 'Сейви знайдено' }
      : { color: colors.warning, icon: '⚠️', text: 'Сейви не знайдено' }
  }

  return (
    <div
      style={styles.wrap}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <div
        style={{
          ...styles.poster,
          filter: installed ? 'none' : 'grayscale(0.6) brightness(0.5)',
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

        {showOverlay && (
          <div style={styles.overlay}>
            <Button variant="primary" style={{ width: '100%' }} onClick={onUpload}>
              ⬆️ Вивантажити
            </Button>
            <Button variant="secondary" style={{ width: '100%' }} onClick={onDownload}>
              ⬇️ Завантажити
            </Button>
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
  notInstalled: { marginTop: 4, fontSize: 12.5, color: colors.muted }
}

export default GameCard

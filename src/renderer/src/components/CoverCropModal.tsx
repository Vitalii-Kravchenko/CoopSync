import { useRef, useState } from 'react'
import { colors, fonts, gradients, radii, shadows } from '../theme'
import { useFocusTrap } from '../hooks/useFocusTrap'
import { useI18n } from '../i18n'
import Button from './Button'

interface Props {
  /** Raw picked image (any aspect ratio), before cropping. */
  src: string
  onCancel: () => void
  /** Cropped, 2:3 JPEG data URL. */
  onConfirm: (dataUrl: string) => void
  /** True while the parent is saving the cropped result. */
  busy?: boolean
}

// Same drag/zoom/crop mechanics as AvatarCropModal, but a 2:3 portrait
// rectangle instead of a square/circle — matching GameCard's poster
// aspect ratio, since this becomes a custom game's cover art.
const VIEWPORT_W = 300
const VIEWPORT_H = 380
const CROP_W = 220
const CROP_H = 330
const OUTPUT_W = 440
const OUTPUT_H = 660
const MIN_ZOOM = 1
const MAX_ZOOM = 3

function CoverCropModal({ src, onCancel, onConfirm, busy }: Props): React.JSX.Element {
  const { t } = useI18n()
  const cardRef = useRef<HTMLDivElement>(null)
  useFocusTrap(cardRef)

  const imgRef = useRef<HTMLImageElement>(null)
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null)
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [dragging, setDragging] = useState(false)
  const dragStart = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null)

  // Scale at which the image just covers the crop rectangle (zoom === 1).
  function baseScale(w: number, h: number): number {
    return Math.max(CROP_W / w, CROP_H / h)
  }

  // Keeps the image fully covering the crop rectangle regardless of pan/zoom.
  function clampPan(x: number, y: number, w: number, h: number, z: number): { x: number; y: number } {
    const scale = baseScale(w, h) * z
    const maxX = Math.max(0, (w * scale - CROP_W) / 2)
    const maxY = Math.max(0, (h * scale - CROP_H) / 2)
    return { x: Math.min(maxX, Math.max(-maxX, x)), y: Math.min(maxY, Math.max(-maxY, y)) }
  }

  function handleImgLoad(): void {
    const img = imgRef.current
    if (!img) return
    setNatural({ w: img.naturalWidth, h: img.naturalHeight })
    setZoom(1)
    setPan({ x: 0, y: 0 })
  }

  function handlePointerDown(e: React.PointerEvent<HTMLDivElement>): void {
    e.currentTarget.setPointerCapture(e.pointerId)
    setDragging(true)
    dragStart.current = { x: e.clientX, y: e.clientY, panX: pan.x, panY: pan.y }
  }

  function handlePointerMove(e: React.PointerEvent<HTMLDivElement>): void {
    if (!dragStart.current || !natural) return
    const dx = e.clientX - dragStart.current.x
    const dy = e.clientY - dragStart.current.y
    setPan(clampPan(dragStart.current.panX + dx, dragStart.current.panY + dy, natural.w, natural.h, zoom))
  }

  function handlePointerUp(): void {
    dragStart.current = null
    setDragging(false)
  }

  function handleZoomChange(z: number): void {
    setZoom(z)
    if (natural) setPan((p) => clampPan(p.x, p.y, natural.w, natural.h, z))
  }

  function handleConfirm(): void {
    const img = imgRef.current
    if (!img || !natural) return
    const scale = baseScale(natural.w, natural.h) * zoom
    const sW = CROP_W / scale
    const sH = CROP_H / scale
    const sx = natural.w / 2 - (CROP_W / 2 + pan.x) / scale
    const sy = natural.h / 2 - (CROP_H / 2 + pan.y) / scale

    const canvas = document.createElement('canvas')
    canvas.width = OUTPUT_W
    canvas.height = OUTPUT_H
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.drawImage(img, sx, sy, sW, sH, 0, 0, OUTPUT_W, OUTPUT_H)
    onConfirm(canvas.toDataURL('image/jpeg', 0.92))
  }

  const scale = natural ? baseScale(natural.w, natural.h) * zoom : 1
  const dispW = natural ? natural.w * scale : 0
  const dispH = natural ? natural.h * scale : 0

  return (
    <div style={styles.backdrop}>
      <div ref={cardRef} style={styles.card}>
        <div style={styles.topBar} />
        <div style={styles.body}>
          <div style={styles.title}>{t.settings.cropTitle}</div>

          <div
            style={{ ...styles.viewport, cursor: dragging ? 'grabbing' : 'grab' }}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerLeave={handlePointerUp}
          >
            <img
              ref={imgRef}
              src={src}
              alt=""
              draggable={false}
              onLoad={handleImgLoad}
              style={{
                position: 'absolute',
                left: '50%',
                top: '50%',
                width: dispW,
                height: dispH,
                maxWidth: 'none',
                transform: `translate(-50%, -50%) translate(${pan.x}px, ${pan.y}px)`,
                pointerEvents: 'none'
              }}
            />
            <div style={styles.vignette} />
          </div>

          <div style={styles.hint}>{t.settings.cropHint}</div>

          <div style={styles.zoomRow}>
            <ZoomIcon size={14} />
            <input
              type="range"
              min={MIN_ZOOM}
              max={MAX_ZOOM}
              step={0.01}
              value={zoom}
              onChange={(e) => handleZoomChange(Number(e.target.value))}
              style={styles.slider}
            />
            <ZoomIcon size={20} />
          </div>

          <div style={styles.actions}>
            <Button variant="ghost" style={styles.actionBtn} onClick={onCancel} disabled={busy}>
              {t.settings.cancel}
            </Button>
            <Button
              variant="primary"
              style={styles.actionBtn}
              onClick={handleConfirm}
              disabled={!natural || busy}
            >
              {busy && <span className="spinner" />}
              {t.settings.cropConfirm}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

function ZoomIcon({ size }: { size: number }): React.JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={colors.text3}
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="11" cy="11" r="7" />
      <path d="m21 21-4.3-4.3M8 11h6" />
    </svg>
  )
}

const styles: Record<string, React.CSSProperties> = {
  backdrop: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(6,8,13,.72)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 200
  },
  card: {
    width: 380,
    border: `1px solid ${colors.borderStrong}`,
    borderRadius: radii.lg,
    background: colors.bgOverlay,
    boxShadow: shadows.sh5,
    overflow: 'hidden',
    outline: 'none'
  },
  topBar: { height: 2, background: gradients.energy },
  body: { padding: 22, display: 'flex', flexDirection: 'column', alignItems: 'center' },
  title: {
    alignSelf: 'flex-start',
    fontFamily: fonts.display,
    fontWeight: 600,
    fontSize: 17,
    color: colors.text1,
    marginBottom: 16
  },
  viewport: {
    position: 'relative',
    width: VIEWPORT_W,
    height: VIEWPORT_H,
    borderRadius: radii.md,
    overflow: 'hidden',
    background: colors.bgInset,
    touchAction: 'none'
  },
  // A rectangular "hole" in an oversized shadow — everything outside the
  // crop rectangle darkens, the rectangle itself stays clear.
  vignette: {
    position: 'absolute',
    left: '50%',
    top: '50%',
    width: CROP_W,
    height: CROP_H,
    transform: 'translate(-50%, -50%)',
    borderRadius: radii.sm,
    boxShadow: '0 0 0 9999px rgba(6,8,13,.62)',
    border: `1.5px solid ${colors.text1}`,
    pointerEvents: 'none'
  },
  hint: { fontSize: 11.5, color: colors.text3, marginTop: 12 },
  zoomRow: { display: 'flex', alignItems: 'center', gap: 10, width: '100%', marginTop: 14 },
  slider: { flex: 1, accentColor: colors.cy },
  actions: { display: 'flex', gap: 10, justifyContent: 'flex-end', width: '100%', marginTop: 22 },
  actionBtn: { whiteSpace: 'nowrap', flexShrink: 0 }
}

export default CoverCropModal

import { useRef, useState } from 'react'
import { colors, fonts, gradients, radii, shadows } from '../theme'
import { useFocusTrap } from '../hooks/useFocusTrap'
import { useI18n } from '../i18n'
import { describeError } from '../errors'
import Button from './Button'
import type { BannerState } from './Banner'
import CoverCropModal from './CoverCropModal'
import ExcludeFilesCard from './ExcludeFilesCard'
import ExePicker from './ExePicker'
import { CloseIcon } from './icons'

interface Props {
  onAdded: () => void
  onCancel: () => void
  /** Show a global banner (rendered in App — visible on all tabs) — used for
   *  an immediate warning if the cover fails to push to the shared repo. */
  onBanner: (banner: BannerState) => void
}

// Adds a game outside CoopSync's built-in catalog — see games:add-custom
// (main/ipc.ts) and customGames.ts. Manual sync only (no launch/exit
// auto-sync, no saveFilePattern) — the description below spells that out
// up front, before the user commits to adding it.
function AddCustomGameModal({ onAdded, onCancel, onBanner }: Props): React.JSX.Element {
  const { t } = useI18n()
  const [name, setName] = useState('')
  const [path, setPath] = useState('')
  const [selectedExes, setSelectedExes] = useState<string[]>([])
  const [coverSrc, setCoverSrc] = useState<string | null>(null)
  const [cover, setCover] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Set once the game's actually been created — appId only exists from this
  // point on, so the exclusion step (which needs it) can't show any earlier.
  // Switches the modal to a second, final step instead of closing right away.
  const [createdAppId, setCreatedAppId] = useState<string | null>(null)
  const [coverSyncFailed, setCoverSyncFailed] = useState(false)
  const [retryingCoverSync, setRetryingCoverSync] = useState(false)
  const mouseDownOnBackdrop = useRef(false)
  const cardRef = useRef<HTMLDivElement>(null)
  useFocusTrap(cardRef)

  async function handleBrowse(): Promise<void> {
    const picked = await window.api.games.pickSaveFolder()
    if (picked) setPath(picked)
  }

  async function handlePickCover(): Promise<void> {
    const raw = await window.api.games.pickCoverFile()
    if (raw) setCoverSrc(raw)
  }

  function handleCoverCropped(dataUrl: string): void {
    setCover(dataUrl)
    setCoverSrc(null)
  }

  async function handleSubmit(): Promise<void> {
    if (!name.trim() || !path.trim()) return
    setBusy(true)
    setError(null)
    try {
      const game = await window.api.games.addCustom(name.trim(), path.trim(), selectedExes, cover)
      setCreatedAppId(game.appId)
      if (game.coverSyncFailed) {
        setCoverSyncFailed(true)
        onBanner({ text: t.history.coverSyncFailedBanner, kind: 'error' })
      }
    } catch (e) {
      setError(describeError(e, t, t.errors.CUSTOM_GAME_INVALID({})))
    } finally {
      setBusy(false)
    }
  }

  async function handleRetryCoverSync(): Promise<void> {
    if (!createdAppId) return
    setRetryingCoverSync(true)
    try {
      const result = await window.api.games.retryCoverPush(createdAppId)
      setCoverSyncFailed(result.coverSyncFailed)
      if (!result.coverSyncFailed) onBanner({ text: t.history.coverSyncRetrySuccess, kind: 'success' })
    } catch (e) {
      onBanner({ text: describeError(e, t, t.history.coverError), kind: 'error' })
    } finally {
      setRetryingCoverSync(false)
    }
  }

  return (
    <div
      style={styles.backdrop}
      onMouseDown={(e) => {
        mouseDownOnBackdrop.current = e.target === e.currentTarget
      }}
      onClick={(e) => {
        if (busy || !mouseDownOnBackdrop.current || e.target !== e.currentTarget) return
        // Once the game's been created, closing any other way is the same as
        // pressing Done — the addition already happened, only the parent's
        // list needs a refresh so it actually shows up.
        if (createdAppId) onAdded()
        else onCancel()
      }}
    >
      <div ref={cardRef} style={styles.card} onClick={(e) => e.stopPropagation()}>
        <div style={styles.topBar} />
        <div style={styles.body}>
          {createdAppId ? (
            <>
              <div style={styles.title}>{t.addGame.excludeStepTitle}</div>
              <div style={styles.description}>{t.addGame.excludeStepDescription}</div>

              {coverSyncFailed && (
                <div style={styles.coverWarning}>
                  <span style={styles.coverWarningText}>{t.history.coverSyncFailedBanner}</span>
                  <Button
                    variant="ghost"
                    style={styles.coverWarningBtn}
                    onClick={handleRetryCoverSync}
                    disabled={retryingCoverSync}
                  >
                    {retryingCoverSync && <span className="spinner" />}
                    {t.main.retry}
                  </Button>
                </div>
              )}

              <ExcludeFilesCard appId={createdAppId} onError={setError} />

              {error && <div style={styles.error}>{error}</div>}

              <div style={styles.actions}>
                <Button variant="primary" style={styles.actionBtn} onClick={onAdded}>
                  {t.addGame.done}
                </Button>
              </div>
            </>
          ) : (
            <>
              <div style={styles.title}>{t.addGame.title}</div>
              <div style={styles.description}>{t.addGame.description}</div>

              <label style={styles.label} htmlFor="add-game-name">
                {t.addGame.nameLabel}
              </label>
              <input
                id="add-game-name"
                className="input-field"
                style={styles.input}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t.addGame.namePlaceholder}
                autoFocus
              />

              <label style={styles.label} htmlFor="add-game-path">
                {t.addGame.pathLabel}
              </label>
              <div style={styles.pathRow}>
                <input
                  id="add-game-path"
                  className="input-field"
                  style={{ ...styles.input, flex: 1, minWidth: 0 }}
                  value={path}
                  onChange={(e) => setPath(e.target.value)}
                  placeholder={t.history.savePathPlaceholder}
                />
                <Button variant="secondary" style={styles.browseBtn} onClick={handleBrowse}>
                  {t.history.savePathBrowse}
                </Button>
              </div>

              <ExePicker selected={selectedExes} onSelectedChange={setSelectedExes} />

              <div style={styles.label}>{t.addGame.coverLabel}</div>
              <div style={styles.coverRow}>
                <Button variant="ghost" style={styles.manualExeBtn} onClick={handlePickCover}>
                  {cover ? t.history.changeCover : t.addGame.addCover}
                </Button>
                {cover && (
                  <div style={styles.coverPreviewWrap}>
                    <img src={cover} alt="" style={styles.coverPreview} />
                    <button
                      className="reset-btn"
                      style={styles.coverRemoveBtn}
                      onClick={() => setCover(null)}
                    >
                      <CloseIcon size={10} color={colors.text1} />
                    </button>
                  </div>
                )}
              </div>

              {coverSrc && (
                <CoverCropModal src={coverSrc} onCancel={() => setCoverSrc(null)} onConfirm={handleCoverCropped} />
              )}

              {error && <div style={styles.error}>{error}</div>}

              <div style={styles.actions}>
                <Button variant="ghost" style={styles.actionBtn} onClick={onCancel} disabled={busy}>
                  {t.settings.cancel}
                </Button>
                <Button
                  variant="primary"
                  style={styles.actionBtn}
                  onClick={handleSubmit}
                  disabled={busy || !name.trim() || !path.trim()}
                >
                  {busy && <span className="spinner" />}
                  {t.addGame.submit}
                </Button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
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
    width: 580,
    maxWidth: 'calc(100vw - 48px)',
    border: `1px solid ${colors.borderStrong}`,
    borderRadius: radii.lg,
    background: colors.bgOverlay,
    boxShadow: shadows.sh5,
    overflow: 'hidden',
    outline: 'none'
  },
  topBar: { height: 2, background: gradients.energy },
  body: { padding: 22 },
  title: { fontFamily: fonts.display, fontWeight: 600, fontSize: 17, color: colors.text1, marginBottom: 8 },
  description: { fontSize: 12.5, color: colors.text3, lineHeight: 1.55, marginBottom: 18 },
  coverWarning: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    fontSize: 12.5,
    lineHeight: 1.5,
    color: colors.text2,
    background: colors.warningBg,
    border: `1px solid ${colors.warningBd}`,
    borderRadius: radii.md,
    padding: '10px 14px',
    marginBottom: 18
  },
  coverWarningText: { flex: 1, minWidth: 0 },
  coverWarningBtn: { height: 28, padding: '0 12px', fontSize: 12, whiteSpace: 'nowrap', flexShrink: 0 },
  label: {
    display: 'block',
    fontSize: 11.5,
    fontWeight: 600,
    color: colors.text2,
    marginBottom: 6,
    marginTop: 14
  },
  input: {
    width: '100%',
    height: 40,
    padding: '0 14px',
    border: `1px solid ${colors.borderDefault}`,
    borderRadius: radii.md,
    background: colors.bgInset,
    color: colors.text1,
    fontFamily: fonts.body,
    fontSize: 13.5,
    outline: 'none'
  },
  pathRow: { display: 'flex', gap: 8 },
  browseBtn: { height: 40, minWidth: 110, padding: '0 16px', fontSize: 13, whiteSpace: 'nowrap', flexShrink: 0 },
  coverRow: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  manualExeBtn: {
    height: 32,
    padding: '0 14px',
    fontSize: 12.5,
    whiteSpace: 'nowrap',
    flexShrink: 0
  },
  coverPreviewWrap: { position: 'relative', flexShrink: 0 },
  coverPreview: {
    width: 32,
    height: 48,
    borderRadius: radii.sm,
    objectFit: 'cover',
    border: `1px solid ${colors.borderDefault}`,
    display: 'block'
  },
  coverRemoveBtn: {
    position: 'absolute',
    top: -6,
    right: -6,
    width: 18,
    height: 18,
    borderRadius: '50%',
    background: colors.bgOverlay,
    border: `1px solid ${colors.borderStrong}`,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer'
  },
  error: {
    fontSize: 12.5,
    color: colors.danger,
    background: colors.dangerBg,
    border: `1px solid ${colors.dangerBd}`,
    borderRadius: radii.sm,
    padding: '8px 10px',
    marginTop: 16
  },
  actions: { display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 22 },
  actionBtn: { whiteSpace: 'nowrap', flexShrink: 0 }
}

export default AddCustomGameModal

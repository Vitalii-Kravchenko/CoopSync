import { useRef, useState } from 'react'
import { colors, fonts, gradients, radii, shadows } from '../theme'
import { useFocusTrap } from '../hooks/useFocusTrap'
import { useI18n } from '../i18n'
import { describeError } from '../errors'
import Button from './Button'

interface Props {
  onAdded: () => void
  onCancel: () => void
}

// Adds a game outside CoopSync's built-in catalog — see games:add-custom
// (main/ipc.ts) and customGames.ts. Manual sync only (no launch/exit
// auto-sync, no saveFilePattern) — the description below spells that out
// up front, before the user commits to adding it.
function AddCustomGameModal({ onAdded, onCancel }: Props): React.JSX.Element {
  const { t } = useI18n()
  const [name, setName] = useState('')
  const [path, setPath] = useState('')
  const [installPath, setInstallPath] = useState('')
  const [scanning, setScanning] = useState(false)
  const [hasScanned, setHasScanned] = useState(false)
  const [exeCandidates, setExeCandidates] = useState<string[]>([])
  const [selectedExes, setSelectedExes] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const mouseDownOnBackdrop = useRef(false)
  const cardRef = useRef<HTMLDivElement>(null)
  useFocusTrap(cardRef)

  async function handleBrowse(): Promise<void> {
    const picked = await window.api.games.pickSaveFolder()
    if (picked) setPath(picked)
  }

  async function scanInstallPath(folder: string): Promise<void> {
    if (!folder.trim()) return
    setScanning(true)
    try {
      const found = await window.api.games.scanExes(folder.trim())
      setExeCandidates(found)
      setSelectedExes(found.length === 1 ? found : [])
      setHasScanned(true)
    } finally {
      setScanning(false)
    }
  }

  async function handleBrowseInstall(): Promise<void> {
    const picked = await window.api.games.pickSaveFolder()
    if (!picked) return
    setInstallPath(picked)
    setHasScanned(false)
    await scanInstallPath(picked)
  }

  async function handlePickExeManually(): Promise<void> {
    const picked = await window.api.games.pickExeFile()
    if (!picked) return
    setExeCandidates((prev) => (prev.includes(picked) ? prev : [...prev, picked]))
    setSelectedExes((prev) => (prev.includes(picked) ? prev : [...prev, picked]))
    setHasScanned(true)
  }

  function toggleExe(exe: string): void {
    setSelectedExes((prev) => (prev.includes(exe) ? prev.filter((e) => e !== exe) : [...prev, exe]))
  }

  async function handleSubmit(): Promise<void> {
    if (!name.trim() || !path.trim()) return
    setBusy(true)
    setError(null)
    try {
      await window.api.games.addCustom(name.trim(), path.trim(), selectedExes)
      onAdded()
    } catch (e) {
      setError(describeError(e, t, t.errors.CUSTOM_GAME_INVALID({})))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      style={styles.backdrop}
      onMouseDown={(e) => {
        mouseDownOnBackdrop.current = e.target === e.currentTarget
      }}
      onClick={(e) => {
        if (!busy && mouseDownOnBackdrop.current && e.target === e.currentTarget) onCancel()
      }}
    >
      <div ref={cardRef} style={styles.card} onClick={(e) => e.stopPropagation()}>
        <div style={styles.topBar} />
        <div style={styles.body}>
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

          <label style={styles.label} htmlFor="add-game-install-path">
            {t.addGame.installPathLabel}
          </label>
          <div style={styles.hint}>{t.addGame.installPathHint}</div>
          <div style={styles.pathRow}>
            <input
              id="add-game-install-path"
              className="input-field"
              style={{ ...styles.input, flex: 1, minWidth: 0 }}
              value={installPath}
              onChange={(e) => {
                setInstallPath(e.target.value)
                setHasScanned(false)
              }}
              onBlur={() => scanInstallPath(installPath)}
            />
            <Button variant="secondary" style={styles.browseBtn} onClick={handleBrowseInstall}>
              {t.history.savePathBrowse}
            </Button>
          </div>

          {scanning && <div style={styles.hint}>{t.addGame.scanning}</div>}

          {!scanning && hasScanned && exeCandidates.length === 0 && (
            <div style={styles.hint}>{t.addGame.exeNoneFound}</div>
          )}

          {!scanning && exeCandidates.length > 0 && (
            <div style={styles.exeBox}>
              <div style={styles.exeLabel}>{t.addGame.exeFoundLabel}</div>
              {exeCandidates.map((exe) => (
                <label key={exe} style={styles.exeRow}>
                  <input
                    type="checkbox"
                    checked={selectedExes.includes(exe)}
                    onChange={() => toggleExe(exe)}
                  />
                  <span style={styles.exeName}>{exe}</span>
                </label>
              ))}
            </div>
          )}

          <Button variant="ghost" style={styles.manualExeBtn} onClick={handlePickExeManually}>
            {t.addGame.addExeManually}
          </Button>

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
  hint: { fontSize: 11.5, color: colors.text3, lineHeight: 1.5, marginTop: 4, marginBottom: 8 },
  exeBox: {
    border: `1px solid ${colors.borderDefault}`,
    borderRadius: radii.md,
    background: colors.bgInset,
    padding: '10px 12px',
    marginTop: 6
  },
  exeLabel: { fontSize: 11.5, fontWeight: 600, color: colors.text2, marginBottom: 8 },
  exeRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '4px 0',
    cursor: 'pointer'
  },
  exeName: { fontFamily: fonts.mono, fontSize: 12.5, color: colors.text1 },
  manualExeBtn: {
    height: 32,
    padding: '0 14px',
    fontSize: 12.5,
    marginTop: 10,
    whiteSpace: 'nowrap',
    flexShrink: 0
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

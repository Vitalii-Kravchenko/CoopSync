import { useState } from 'react'
import { colors, fonts, radii } from '../theme'
import { useI18n } from '../i18n'
import Button from './Button'

interface Props {
  /** Currently configured .exe name(s) — controlled from the parent so it
   *  works both for a brand-new game (AddCustomGameModal) and an existing
   *  one being (re)configured (GameDetailScreen). */
  selected: string[]
  onSelectedChange: (names: string[]) => void
}

// Install-folder scan + manual .exe fallback, boxed as its own section so it
// reads as one grouped control instead of loose buttons — shared by
// AddCustomGameModal (adding a game) and GameDetailScreen (a co-op partner
// setting up auto-sync for a game they didn't add themselves, where the
// save-path editor alone left no way to point at the game's .exe at all).
function ExePicker({ selected, onSelectedChange }: Props): React.JSX.Element {
  const { t } = useI18n()
  const [installPath, setInstallPath] = useState('')
  const [scanning, setScanning] = useState(false)
  const [hasScanned, setHasScanned] = useState(false)
  // Seeded with whatever's already selected, so an already-configured .exe
  // shows up as a checked row immediately, before any scan runs this session.
  const [candidates, setCandidates] = useState<string[]>(selected)

  async function scan(folder: string): Promise<void> {
    if (!folder.trim()) return
    setScanning(true)
    try {
      const found = await window.api.games.scanExes(folder.trim())
      setCandidates((prev) => [...new Set([...prev, ...found])])
      // Only auto-pick when nothing is selected yet — never clobber an
      // existing choice just because the folder got rescanned.
      if (found.length === 1 && selected.length === 0) onSelectedChange(found)
      setHasScanned(true)
    } finally {
      setScanning(false)
    }
  }

  async function handleBrowse(): Promise<void> {
    const picked = await window.api.games.pickSaveFolder()
    if (!picked) return
    setInstallPath(picked)
    setHasScanned(false)
    await scan(picked)
  }

  async function handlePickManually(): Promise<void> {
    const picked = await window.api.games.pickExeFile()
    if (!picked) return
    setCandidates((prev) => (prev.includes(picked) ? prev : [...prev, picked]))
    if (!selected.includes(picked)) onSelectedChange([...selected, picked])
    setHasScanned(true)
  }

  function toggle(exe: string): void {
    onSelectedChange(selected.includes(exe) ? selected.filter((e) => e !== exe) : [...selected, exe])
  }

  return (
    <div style={styles.box}>
      <label style={styles.label} htmlFor="exe-picker-install-path">
        {t.addGame.installPathLabel}
      </label>
      <div style={styles.hint}>{t.addGame.installPathHint}</div>
      <div style={styles.row}>
        <input
          id="exe-picker-install-path"
          className="input-field"
          style={styles.input}
          value={installPath}
          onChange={(e) => {
            setInstallPath(e.target.value)
            setHasScanned(false)
          }}
          onBlur={() => scan(installPath)}
        />
        <Button variant="secondary" style={styles.browseBtn} onClick={handleBrowse}>
          {t.history.savePathBrowse}
        </Button>
      </div>

      {scanning && <div style={styles.hint}>{t.addGame.scanning}</div>}

      {!scanning && hasScanned && candidates.length === 0 && (
        <div style={styles.hint}>{t.addGame.exeNoneFound}</div>
      )}

      {!scanning && candidates.length > 0 && (
        <div style={styles.candidatesBox}>
          <div style={styles.candidatesLabel}>{t.addGame.exeFoundLabel}</div>
          {candidates.map((exe) => (
            <label key={exe} style={styles.exeRow}>
              <input type="checkbox" checked={selected.includes(exe)} onChange={() => toggle(exe)} />
              <span style={styles.exeName}>{exe}</span>
            </label>
          ))}
        </div>
      )}

      <Button variant="ghost" style={styles.manualBtn} onClick={handlePickManually}>
        {t.addGame.addExeManually}
      </Button>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  box: {
    border: `1px solid ${colors.borderDefault}`,
    borderRadius: radii.md,
    background: colors.bgInset,
    padding: 14,
    marginTop: 14
  },
  label: { display: 'block', fontSize: 11.5, fontWeight: 600, color: colors.text2, marginBottom: 6 },
  hint: { fontSize: 11.5, color: colors.text3, lineHeight: 1.5, marginBottom: 8 },
  row: { display: 'flex', gap: 8 },
  input: {
    flex: 1,
    minWidth: 0,
    height: 38,
    padding: '0 12px',
    border: `1px solid ${colors.borderDefault}`,
    borderRadius: radii.md,
    background: colors.bgSurface,
    color: colors.text1,
    fontFamily: fonts.body,
    fontSize: 13,
    outline: 'none'
  },
  browseBtn: { height: 38, minWidth: 110, padding: '0 16px', fontSize: 13, whiteSpace: 'nowrap', flexShrink: 0 },
  candidatesBox: {
    border: `1px solid ${colors.borderDefault}`,
    borderRadius: radii.sm,
    background: colors.bgSurface,
    padding: '10px 12px',
    marginTop: 10
  },
  candidatesLabel: { fontSize: 11.5, fontWeight: 600, color: colors.text2, marginBottom: 8 },
  exeRow: { display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0', cursor: 'pointer' },
  exeName: { fontFamily: fonts.mono, fontSize: 12.5, color: colors.text1 },
  manualBtn: { height: 30, padding: '0 12px', fontSize: 12, marginTop: 10, whiteSpace: 'nowrap' }
}

export default ExePicker

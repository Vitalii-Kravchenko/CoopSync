import { useEffect, useState } from 'react'
import { colors, fonts, radii } from '../theme'
import { useI18n } from '../i18n'
import { describeError } from '../errors'
import Button from './Button'
import { DiskIcon, SyncIcon } from './icons'

interface Props {
  appId: string
  onError?: (message: string) => void
  /** Called after an exclusion actually saves — lets GameDetailScreen tell
   *  MainScreen the Games tab's card (size) may now be stale. */
  onChanged?: () => void
}

// Files sitting in the save folder's top level (not subfolders — see
// games:list-save-files), for excluding local/settings files from sync.
// Shared by GameDetailScreen (an existing custom game) and AddCustomGameModal
// (right after a brand-new custom game's appId exists) — appId is the only
// thing either caller needs to have ready.
function ExcludeFilesCard({ appId, onError, onChanged }: Props): React.JSX.Element {
  const { t } = useI18n()
  const [saveFiles, setSaveFiles] = useState<string[]>([])
  const [excludedFiles, setExcludedFiles] = useState<string[]>([])
  const [loading, setLoading] = useState(false)

  function load(): void {
    setLoading(true)
    Promise.all([window.api.games.listSaveFiles(appId), window.api.games.getExcludedFiles(appId)])
      .then(([files, excluded]) => {
        setSaveFiles(files)
        setExcludedFiles(excluded)
      })
      .catch(() => setSaveFiles([]))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appId])

  function toggle(file: string): void {
    const next = excludedFiles.includes(file)
      ? excludedFiles.filter((f) => f !== file)
      : [...excludedFiles, file]
    setExcludedFiles(next)
    window.api.games
      .setExcludedFiles(appId, next)
      .then(() => onChanged?.())
      .catch((e) => {
        onError?.(describeError(e, t, t.history.savePathSaveError))
      })
  }

  return (
    <div style={styles.card}>
      <div style={styles.topRow}>
        <div style={styles.labelRow}>
          <DiskIcon size={14} color={colors.text3} />
          <span style={styles.label}>{t.history.excludeFilesTitle}</span>
        </div>
        <Button variant="ghost" style={styles.retryBtn} onClick={load} disabled={loading}>
          <SyncIcon size={13} color={colors.text2} />
          {t.history.excludeFilesRefresh}
        </Button>
      </div>
      <div style={styles.hint}>{t.history.excludeFilesHint}</div>
      {!loading && saveFiles.length === 0 && <div style={styles.hint}>{t.history.excludeFilesEmpty}</div>}
      {!loading && saveFiles.length > 0 && (
        <div style={styles.filesBox}>
          {saveFiles.map((file) => (
            <label key={file} style={styles.fileRow}>
              <input type="checkbox" checked={excludedFiles.includes(file)} onChange={() => toggle(file)} />
              <span style={styles.fileName}>{file}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  card: {
    border: `1px solid ${colors.borderSubtle}`,
    borderRadius: radii.lg,
    padding: '16px 18px',
    marginBottom: 20
  },
  topRow: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '8px 12px',
    marginBottom: 10
  },
  labelRow: { display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 },
  label: {
    fontFamily: fonts.display,
    fontSize: 13,
    fontWeight: 600,
    color: colors.text2,
    textTransform: 'uppercase',
    letterSpacing: '.04em'
  },
  retryBtn: { height: 32, padding: '0 14px', fontSize: 12.5, whiteSpace: 'nowrap', flexShrink: 0 },
  hint: { fontSize: 11.5, color: colors.text3, lineHeight: 1.5 },
  filesBox: {
    border: `1px solid ${colors.borderDefault}`,
    borderRadius: radii.md,
    background: colors.bgInset,
    padding: '8px 12px',
    marginTop: 10,
    maxHeight: 180,
    overflowY: 'auto'
  },
  fileRow: { display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0', cursor: 'pointer' },
  fileName: { fontFamily: fonts.mono, fontSize: 12.5, color: colors.text1 }
}

export default ExcludeFilesCard

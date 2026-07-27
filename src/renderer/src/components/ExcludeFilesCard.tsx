import { useEffect, useState } from 'react'
import { colors, fonts, radii } from '../theme'
import { useI18n } from '../i18n'
import { describeError } from '../errors'
import Button from './Button'
import { ChevronRightIcon, DiskIcon, SyncIcon } from './icons'

interface Props {
  appId: string
  /** Set when this card is scoped to one of the game's extra folders (see
   *  CustomGame.extraFolders) instead of its main save folder — routes to
   *  the folder-scoped IPC calls instead of the game-level ones. */
  folderId?: string
  onError?: (message: string) => void
  /** Called after an exclusion actually saves — lets GameDetailScreen tell
   *  MainScreen the Games tab's card (size) may now be stale. */
  onChanged?: () => void
  /** 'card' (default) — the full bordered header+hint+refresh version, used
   *  in AddCustomGameModal and the main save-path settings. 'inline' — a
   *  lightweight collapsible disclosure (chevron + label + excluded count),
   *  for the extra-folders card where this is a rarely-touched setting that
   *  shouldn't carry the same visual weight as the main content. */
  variant?: 'card' | 'inline'
  /** Extra styles merged onto the root ('card' variant only) — lets a
   *  caller make it a flex item alongside a sibling card so both stretch
   *  to the same height, instead of each sitting at its own content height. */
  style?: React.CSSProperties
}

// Files sitting in the save folder's top level (not subfolders — see
// games:list-save-files), for excluding local/settings files from sync.
// Shared by GameDetailScreen (an existing custom game, or one of its extra
// folders via folderId) and AddCustomGameModal (right after a brand-new
// custom game's appId exists) — appId is the only thing either caller needs
// to have ready.
function ExcludeFilesCard({
  appId,
  folderId,
  onError,
  onChanged,
  variant = 'card',
  style
}: Props): React.JSX.Element {
  const { t } = useI18n()
  const [saveFiles, setSaveFiles] = useState<string[]>([])
  const [excludedFiles, setExcludedFiles] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  // Inline variant only — fetches on mount regardless (so the excluded
  // count next to the disclosure label is accurate before it's ever opened),
  // but only shows the file list once actually expanded.
  const [expanded, setExpanded] = useState(false)

  function load(): void {
    setLoading(true)
    const filesP = folderId
      ? window.api.games.listExtraFolderSaveFiles(appId, folderId)
      : window.api.games.listSaveFiles(appId)
    const excludedP = folderId
      ? window.api.games.getExtraFolderExcludedFiles(appId, folderId)
      : window.api.games.getExcludedFiles(appId)
    Promise.all([filesP, excludedP])
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
  }, [appId, folderId])

  function toggle(file: string): void {
    const next = excludedFiles.includes(file)
      ? excludedFiles.filter((f) => f !== file)
      : [...excludedFiles, file]
    setExcludedFiles(next)
    const saveP = folderId
      ? window.api.games.setExtraFolderExcludedFiles(appId, folderId, next)
      : window.api.games.setExcludedFiles(appId, next)
    saveP
      .then(() => onChanged?.())
      .catch((e) => {
        onError?.(describeError(e, t, t.history.savePathSaveError))
      })
  }

  if (variant === 'inline') {
    return (
      <div>
        <button
          className="reset-btn inline-exclude-toggle"
          style={styles.inlineToggle}
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
        >
          <span
            style={{
              display: 'flex',
              transform: expanded ? 'rotate(90deg)' : undefined,
              transition: 'transform var(--t-hover)'
            }}
          >
            <ChevronRightIcon size={11} color={expanded ? colors.cy : colors.text3} />
          </span>
          <span style={styles.inlineToggleLabel}>{t.history.excludeFilesTitle}</span>
          {excludedFiles.length > 0 && (
            <span style={styles.inlineToggleCount}>({excludedFiles.length})</span>
          )}
        </button>
        {expanded && (
          <div style={styles.inlineBody}>
            {!loading && saveFiles.length === 0 && <div style={styles.hint}>{t.history.excludeFilesEmpty}</div>}
            {!loading &&
              saveFiles.map((file) => (
                <label key={file} style={styles.fileRow}>
                  <input
                    type="checkbox"
                    checked={excludedFiles.includes(file)}
                    onChange={() => toggle(file)}
                    style={{ accentColor: colors.cy }}
                  />
                  <span style={styles.fileName}>{file}</span>
                </label>
              ))}
          </div>
        )}
      </div>
    )
  }

  return (
    <div style={{ ...styles.card, ...style }}>
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
              <input
                type="checkbox"
                checked={excludedFiles.includes(file)}
                onChange={() => toggle(file)}
                style={{ accentColor: colors.cy }}
              />
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
  fileName: { fontFamily: fonts.mono, fontSize: 12.5, color: colors.text1 },
  inlineToggle: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    width: '100%',
    padding: '6px 0',
    background: 'transparent',
    border: 'none',
    cursor: 'pointer',
    textAlign: 'left'
  },
  inlineToggleLabel: { fontFamily: fonts.display, fontWeight: 600, fontSize: 11.5, color: colors.text2 },
  inlineToggleCount: { fontFamily: fonts.mono, fontSize: 10, color: colors.text3 },
  inlineBody: { background: colors.bgInset, borderRadius: radii.md, padding: '8px 12px', marginTop: 4 }
}

export default ExcludeFilesCard

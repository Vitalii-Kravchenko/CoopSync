import { useEffect, useState } from 'react'
import { colors, fonts, radii } from '../theme'
import { useI18n } from '../i18n'
import { describeError, describeSyncResult } from '../errors'
import { formatVersion as fmtVersion } from '../../../shared/format'
import type { AuthUser, CustomExtraFolder, FolderSyncStatus } from '../../../shared/types'
import type { BannerState } from './Banner'
import Button from './Button'
import ConfirmModal from './ConfirmModal'
import ExcludeFilesCard from './ExcludeFilesCard'
import { syncDisplay } from './GameCard'
import { FolderIcon, EditIcon, TrashIcon, PlusIcon, UploadIcon, DownloadIcon } from './icons'

interface Props {
  appId: string
  /** Bumps after every real push (any folder, this game or another) — same
   *  signal GameDetailScreen already reacts to for the history table. */
  syncVersion: number
  onBanner: (banner: BannerState) => void
  /** Call after any change so MainScreen/GameDetailScreen's own state (which
   *  also reads statuses) doesn't go stale. */
  onSynced: () => void
  /** Own login — only the folder's creator (CustomExtraFolder.addedBy) may
   *  flip its shared/personal setting; everyone else sees it read-only. */
  user: AuthUser
}

// A custom game's extra save folders (see CustomGame.extraFolders) — each
// independently synced, on top of the game's main save folder (handled
// entirely elsewhere on this screen). Manages its own folder list + sync
// status fetch instead of receiving them as props, the same way this
// screen's own save-path/history state works.
function ExtraFoldersSection({ appId, syncVersion, onBanner, onSynced, user }: Props): React.JSX.Element {
  const { t } = useI18n()
  const [folders, setFolders] = useState<CustomExtraFolder[]>([])
  const [statuses, setStatuses] = useState<FolderSyncStatus[]>([])
  const [busyId, setBusyId] = useState<string | null>(null)
  const [togglingId, setTogglingId] = useState<string | null>(null)
  const [removeTarget, setRemoveTarget] = useState<CustomExtraFolder | null>(null)
  const [removing, setRemoving] = useState(false)
  const [removeError, setRemoveError] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [labelInput, setLabelInput] = useState('')

  const [showAdd, setShowAdd] = useState(false)
  const [newLabel, setNewLabel] = useState('')
  const [newPath, setNewPath] = useState('')
  const [newShared, setNewShared] = useState(false)
  const [adding, setAdding] = useState(false)
  const [addError, setAddError] = useState<string | null>(null)

  function load(): void {
    Promise.all([window.api.games.listExtraFolders(appId), window.api.sync.statuses()])
      .then(([f, all]) => {
        setFolders(f)
        setStatuses(all.find((s) => s.appId === appId)?.extraFolders ?? [])
      })
      .catch(() => {
        // Best-effort — the section just shows whatever it last had.
      })
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appId])

  useEffect(() => {
    if (syncVersion > 0) load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [syncVersion])

  async function handleAdd(): Promise<void> {
    const label = newLabel.trim()
    if (!label || !newPath.trim()) return
    setAdding(true)
    setAddError(null)
    try {
      await window.api.games.addExtraFolder(appId, label, newPath.trim(), newShared)
      setShowAdd(false)
      setNewLabel('')
      setNewPath('')
      setNewShared(false)
      onSynced()
      load()
    } catch (e) {
      setAddError(describeError(e, t, t.history.extraFolderAddError))
    } finally {
      setAdding(false)
    }
  }

  async function handleBrowseNewPath(): Promise<void> {
    const picked = await window.api.games.pickExtraFolderSaveFolder()
    if (picked) setNewPath(picked)
  }

  async function handleBrowseExistingPath(folderId: string): Promise<void> {
    const picked = await window.api.games.pickExtraFolderSaveFolder()
    if (!picked) return
    try {
      await window.api.games.setExtraFolderSavePath(appId, folderId, picked)
      onSynced()
      load()
    } catch (e) {
      onBanner({ text: describeError(e, t, t.history.savePathSaveError), kind: 'error' })
    }
  }

  function startRename(f: CustomExtraFolder): void {
    setEditingId(f.id)
    setLabelInput(f.label)
  }

  async function handleRename(folderId: string): Promise<void> {
    const label = labelInput.trim()
    setEditingId(null)
    if (!label) return
    try {
      await window.api.games.renameExtraFolder(appId, folderId, label)
      onSynced()
      load()
    } catch (e) {
      onBanner({ text: describeError(e, t, t.history.extraFolderRenameError), kind: 'error' })
    }
  }

  async function handleToggleShared(f: CustomExtraFolder): Promise<void> {
    if (togglingId) return // already mid-request — ignore a repeat click instead of firing a second one
    setTogglingId(f.id)
    try {
      await window.api.games.setExtraFolderShared(appId, f.id, !f.shared)
      onBanner({ text: t.history.extraFolderShareToggleSuccess, kind: 'success' })
      onSynced()
      load()
    } catch (e) {
      onBanner({ text: describeError(e, t, t.history.extraFolderShareToggleError), kind: 'error' })
    } finally {
      setTogglingId(null)
    }
  }

  async function handleRemove(): Promise<void> {
    if (!removeTarget) return
    setRemoving(true)
    setRemoveError(null)
    try {
      await window.api.games.removeExtraFolder(appId, removeTarget.id)
      setRemoveTarget(null)
      onSynced()
      load()
    } catch (e) {
      setRemoveError(describeError(e, t, t.history.extraFolderRemoveError))
    } finally {
      setRemoving(false)
    }
  }

  async function handleUpload(folderId: string): Promise<void> {
    setBusyId(folderId)
    try {
      const result = await window.api.sync.uploadExtraFolder(appId, folderId)
      const code = result.pushed === false ? 'push-skipped-nochange' : 'upload-success'
      onBanner({ text: describeSyncResult(code, { version: String(result.version) }, t), kind: 'success' })
      onSynced()
      load()
    } catch (e) {
      onBanner({ text: describeError(e, t, t.main.syncErrorFallback), kind: 'error' })
    } finally {
      setBusyId(null)
    }
  }

  async function handleDownload(folderId: string): Promise<void> {
    setBusyId(folderId)
    try {
      const result = await window.api.sync.downloadExtraFolder(appId, folderId)
      onBanner({
        text: describeSyncResult('download-success', { version: String(result.version) }, t),
        kind: 'success'
      })
      onSynced()
      load()
    } catch (e) {
      onBanner({ text: describeError(e, t, t.main.syncErrorFallback), kind: 'error' })
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div style={styles.wrap}>
      <div style={styles.topRow}>
        <div style={styles.labelRow}>
          <FolderIcon size={14} color={colors.text3} />
          <span style={styles.label}>{t.history.extraFoldersTitle}</span>
        </div>
        <Button variant="ghost" style={styles.addBtn} onClick={() => setShowAdd((v) => !v)}>
          <PlusIcon size={13} color={colors.text2} />
          {t.history.extraFoldersAdd}
        </Button>
      </div>
      <div style={styles.hint}>{t.history.extraFoldersHint}</div>

      {showAdd && (
        <div style={styles.addForm}>
          <div style={styles.addRow}>
            <input
              className="input-field"
              style={styles.addLabelInput}
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              placeholder={t.history.extraFolderLabelPlaceholder}
              autoFocus
            />
          </div>
          <div style={styles.addRow}>
            <input
              className="input-field"
              style={styles.addPathInput}
              value={newPath}
              onChange={(e) => setNewPath(e.target.value)}
              placeholder={t.history.extraFolderPathPlaceholder}
            />
            <Button variant="secondary" style={styles.browseBtn} onClick={handleBrowseNewPath}>
              {t.history.extraFolderBrowse}
            </Button>
          </div>
          <SharedToggle shared={newShared} onChange={setNewShared} t={t} />
          {addError && <div style={styles.errorText}>{addError}</div>}
          <div style={styles.addActions}>
            <Button
              variant="primary"
              style={styles.smallBtn}
              onClick={handleAdd}
              disabled={adding || !newLabel.trim() || !newPath.trim()}
            >
              {adding && <span className="spinner" />}
              {t.history.extraFolderAddSave}
            </Button>
            <Button variant="ghost" style={styles.smallBtn} onClick={() => setShowAdd(false)} disabled={adding}>
              {t.history.extraFolderAddCancel}
            </Button>
          </div>
        </div>
      )}

      {folders.length === 0 && !showAdd && <div style={styles.empty}>{t.history.extraFoldersEmpty}</div>}

      {folders.map((f) => {
        const st = statuses.find((s) => s.folderId === f.id)
        const display = f.savePath ? syncDisplay(st?.status, t) : null
        const busy = busyId === f.id
        return (
          <div key={f.id} style={styles.folderCard}>
            <div style={styles.folderTopRow}>
              {editingId === f.id ? (
                <input
                  className="input-field"
                  style={styles.renameInput}
                  value={labelInput}
                  onChange={(e) => setLabelInput(e.target.value)}
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void handleRename(f.id)
                    if (e.key === 'Escape') setEditingId(null)
                  }}
                  onBlur={() => handleRename(f.id)}
                />
              ) : (
                <div style={styles.folderNameRow}>
                  <span style={styles.folderName}>{f.label}</span>
                  <Button variant="ghost" style={styles.iconBtn} onClick={() => startRename(f)}>
                    <EditIcon size={12} color={colors.text3} />
                  </Button>
                </div>
              )}
              {display && (
                <span style={{ ...styles.statusPill, color: display.color, background: display.bg, borderColor: display.bd }}>
                  {display.text}
                </span>
              )}
              <Button variant="ghost" style={styles.iconBtn} onClick={() => setRemoveTarget(f)}>
                <TrashIcon size={13} color={colors.danger} />
              </Button>
            </div>

            <div style={styles.folderPathRow}>
              <span style={styles.folderPath} title={f.savePath || undefined}>
                {f.savePath || t.history.extraFolderNoPath}
              </span>
              <Button
                variant="ghost"
                style={styles.smallBtn}
                onClick={() => handleBrowseExistingPath(f.id)}
              >
                {t.history.extraFolderBrowse}
              </Button>
            </div>

            <SharedToggle
              shared={f.shared}
              onChange={() => handleToggleShared(f)}
              t={t}
              locked={!!f.addedBy && f.addedBy !== user.login}
              busy={togglingId === f.id}
            />

            {f.savePath && (
              <div style={styles.folderActions}>
                <Button
                  variant="secondary"
                  style={styles.smallBtn}
                  onClick={() => handleUpload(f.id)}
                  disabled={busy}
                >
                  {busy ? <span className="spinner" /> : <UploadIcon size={13} color={colors.text1} />}
                  {t.gameCard.upload}
                </Button>
                <Button
                  variant="secondary"
                  style={styles.smallBtn}
                  onClick={() => handleDownload(f.id)}
                  disabled={busy}
                >
                  {busy ? <span className="spinner" /> : <DownloadIcon size={13} color={colors.text1} />}
                  {t.gameCard.download}
                </Button>
                {st && (
                  <span style={styles.versions}>{t.gameCard.versions(fmtVersion(st.localVersion), fmtVersion(st.remoteVersion))}</span>
                )}
              </div>
            )}

            {f.savePath && (
              <ExcludeFilesCard
                appId={appId}
                folderId={f.id}
                onError={(msg) => onBanner({ text: msg, kind: 'error' })}
                onChanged={onSynced}
              />
            )}
          </div>
        )
      })}

      {removeTarget && (
        <ConfirmModal
          title={t.history.extraFolderRemoveConfirmTitle}
          description={t.history.extraFolderRemoveConfirmDesc(removeTarget.label)}
          confirmLabel={t.history.extraFolderRemove}
          cancelLabel={t.settings.cancel}
          busy={removing}
          error={removeError}
          onConfirm={handleRemove}
          onCancel={() => {
            setRemoveTarget(null)
            setRemoveError(null)
          }}
        />
      )}
    </div>
  )
}

function SharedToggle({
  shared,
  onChange,
  t,
  locked = false,
  busy = false
}: {
  shared: boolean
  onChange: (shared: boolean) => void
  t: ReturnType<typeof useI18n>['t']
  /** True when the current user didn't add this folder — only its creator
   *  may change this setting (see games:set-extra-folder-shared). */
  locked?: boolean
  /** True while a change is actually in flight — blocks repeat clicks and
   *  shows a spinner instead of silently doing nothing visible. */
  busy?: boolean
}): React.JSX.Element {
  const disabled = locked || busy
  return (
    <div style={styles.toggleWrap}>
      <div style={styles.toggleRow}>
        <Button
          variant={shared ? 'primary' : 'ghost'}
          style={styles.toggleBtn}
          onClick={() => !disabled && !shared && onChange(true)}
          disabled={disabled}
        >
          {busy && !shared && <span className="spinner" />}
          {t.history.extraFolderShared}
        </Button>
        <Button
          variant={!shared ? 'primary' : 'ghost'}
          style={styles.toggleBtn}
          onClick={() => !disabled && shared && onChange(false)}
          disabled={disabled}
        >
          {busy && shared && <span className="spinner" />}
          {t.history.extraFolderPersonal}
        </Button>
      </div>
      <div style={styles.toggleHint}>
        {locked
          ? t.errors.NOT_FOLDER_OWNER({})
          : busy
            ? t.history.extraFolderShareToggleBusy
            : shared
              ? t.history.extraFolderSharedHint
              : t.history.extraFolderPersonalHint}
      </div>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  wrap: {
    border: `1px solid ${colors.borderSubtle}`,
    borderRadius: radii.lg,
    padding: '16px 18px',
    marginBottom: 20
  },
  topRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 6 },
  labelRow: { display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 },
  label: {
    fontFamily: fonts.display,
    fontSize: 13,
    fontWeight: 600,
    color: colors.text2,
    textTransform: 'uppercase',
    letterSpacing: '.04em'
  },
  addBtn: { height: 30, padding: '0 12px', fontSize: 12, whiteSpace: 'nowrap', flexShrink: 0 },
  hint: { fontSize: 11.5, color: colors.text3, lineHeight: 1.5, marginBottom: 12 },
  empty: { fontSize: 12.5, color: colors.text3, padding: '8px 0' },
  addForm: {
    border: `1px solid ${colors.borderDefault}`,
    borderRadius: radii.md,
    background: colors.bgInset,
    padding: 12,
    marginBottom: 14
  },
  addRow: { display: 'flex', gap: 8, marginBottom: 8 },
  addLabelInput: {
    flex: 1,
    height: 34,
    padding: '0 10px',
    border: `1px solid ${colors.borderDefault}`,
    borderRadius: radii.md,
    background: colors.bgBase,
    color: colors.text1,
    fontSize: 12.5,
    outline: 'none'
  },
  addPathInput: {
    flex: 1,
    height: 34,
    padding: '0 10px',
    border: `1px solid ${colors.borderDefault}`,
    borderRadius: radii.md,
    background: colors.bgBase,
    color: colors.text1,
    fontFamily: fonts.mono,
    fontSize: 12,
    outline: 'none'
  },
  browseBtn: { height: 34, padding: '0 12px', fontSize: 12, whiteSpace: 'nowrap' },
  addActions: { display: 'flex', gap: 8, marginTop: 8 },
  errorText: { fontSize: 12, color: colors.danger, marginTop: 6 },
  smallBtn: { height: 30, padding: '0 12px', fontSize: 12, whiteSpace: 'nowrap' },
  folderCard: {
    border: `1px solid ${colors.borderDefault}`,
    borderRadius: radii.md,
    padding: 12,
    marginBottom: 10
  },
  folderTopRow: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 },
  folderNameRow: { display: 'flex', alignItems: 'center', gap: 4, flex: 1, minWidth: 0 },
  folderName: {
    fontSize: 13,
    fontWeight: 600,
    color: colors.text1,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap'
  },
  renameInput: {
    flex: 1,
    height: 30,
    padding: '0 8px',
    border: `1px solid ${colors.borderAccent}`,
    borderRadius: radii.sm,
    background: colors.bgInset,
    color: colors.text1,
    fontSize: 13,
    outline: 'none'
  },
  iconBtn: { width: 26, height: 26, padding: 0, flexShrink: 0 },
  statusPill: {
    fontSize: 10.5,
    fontWeight: 600,
    padding: '3px 8px',
    borderRadius: radii.pill,
    border: '1px solid',
    whiteSpace: 'nowrap',
    flexShrink: 0
  },
  folderPathRow: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 },
  folderPath: {
    flex: 1,
    minWidth: 0,
    fontFamily: fonts.mono,
    fontSize: 11.5,
    color: colors.text3,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap'
  },
  toggleWrap: { marginBottom: 8 },
  toggleRow: { display: 'flex', gap: 6 },
  toggleBtn: { height: 28, padding: '0 12px', fontSize: 11.5, flex: 1 },
  toggleHint: { fontSize: 11, color: colors.text3, marginTop: 6, lineHeight: 1.5 },
  folderActions: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap' },
  versions: { fontSize: 11, fontFamily: fonts.mono, color: colors.text3, marginLeft: 'auto' }
}

export default ExtraFoldersSection

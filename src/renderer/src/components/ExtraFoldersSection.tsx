import { useEffect, useState } from 'react'
import { colors, fonts, radii, shadows } from '../theme'
import { useI18n } from '../i18n'
import { describeError, describeSyncResult } from '../errors'
import { formatVersion as fmtVersion } from '../../../shared/format'
import type { AuthUser, CustomExtraFolder, FolderSyncStatus } from '../../../shared/types'
import type { BannerState } from './Banner'
import Button from './Button'
import ConfirmModal from './ConfirmModal'
import ExcludeFilesCard from './ExcludeFilesCard'
import { syncDisplay } from './GameCard'
import {
  FolderIcon,
  EditIcon,
  TrashIcon,
  PlusIcon,
  UploadIcon,
  DownloadIcon,
  ChevronRightIcon,
  FriendsIcon,
  InfoIcon,
  LockIcon
} from './icons'

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
    // sync.statuses() FIRST, not Promise.all with listExtraFolders — its
    // self-heal (sync.ts's getSyncStatuses) is what materializes a folder a
    // co-op partner registered while we were offline (e.g. after a full
    // reinstall wiped local settings). Racing the two meant listExtraFolders
    // almost always won (pure local read vs. a network round-trip) and
    // returned its answer BEFORE self-heal had written anything — the
    // just-materialized folder was silently missing from its very first
    // render, no matter how long the self-heal itself took after that.
    window.api.sync
      .statuses()
      .then((all) => {
        setStatuses(all.find((s) => s.appId === appId)?.extraFolders ?? [])
        return window.api.games.listExtraFolders(appId)
      })
      .then(setFolders)
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

      {folders.length > 0 && (
        <div style={styles.folderGrid}>
          {folders.map((f) => {
            const st = statuses.find((s) => s.folderId === f.id)
            const display = f.savePath ? syncDisplay(st?.status, t) : null
            return (
              <FolderCard
                key={f.id}
                appId={appId}
                folder={f}
                display={display}
                versions={
                  st ? t.gameCard.versions(fmtVersion(st.localVersion), fmtVersion(st.remoteVersion)) : null
                }
                busy={busyId === f.id}
                editing={editingId === f.id}
                labelInput={labelInput}
                onLabelInputChange={setLabelInput}
                onStartRename={() => startRename(f)}
                onCommitRename={() => handleRename(f.id)}
                onCancelEditing={() => setEditingId(null)}
                onBrowsePath={() => handleBrowseExistingPath(f.id)}
                shareBusy={togglingId === f.id}
                shareLocked={!!f.addedBy && f.addedBy !== user.login}
                onToggleShared={() => handleToggleShared(f)}
                onUpload={() => handleUpload(f.id)}
                onDownload={() => handleDownload(f.id)}
                onRequestRemove={() => setRemoveTarget(f)}
                onBanner={onBanner}
                onSynced={onSynced}
                t={t}
              />
            )
          })}
          {/* Keeps the last row visually balanced instead of one lone card
              stretched next to a dead gap, or a half-empty final row when
              the count is odd — a quiet "there's room here" slot, not a
              clickable action (that's still the "+ Додати папку" button
              above). */}
          {folders.length % 2 === 1 && (
            <div style={styles.folderPlaceholder}>
              <FolderIcon size={18} color={colors.textDisabled} />
            </div>
          )}
        </div>
      )}

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

interface FolderCardProps {
  appId: string
  folder: CustomExtraFolder
  display: { text: string; color: string; bg: string; bd: string } | null
  versions: string | null
  busy: boolean
  editing: boolean
  labelInput: string
  onLabelInputChange: (v: string) => void
  onStartRename: () => void
  onCommitRename: () => void
  onCancelEditing: () => void
  onBrowsePath: () => void
  shareBusy: boolean
  /** True when the current user didn't add this folder — only its creator
   *  may change this setting (see games:set-extra-folder-shared). */
  shareLocked: boolean
  onToggleShared: () => void
  onUpload: () => void
  onDownload: () => void
  onRequestRemove: () => void
  onBanner: (banner: BannerState) => void
  onSynced: () => void
  t: ReturnType<typeof useI18n>['t']
}

// One extra-folder card. Only name, ownership badge, status and
// upload/download stay on the face (visible at a glance) — path, the
// shared/personal switch and file exclusions live behind a "Settings"
// disclosure, since they're set once and rarely touched again.
function FolderCard({
  appId,
  folder,
  display,
  versions,
  busy,
  editing,
  labelInput,
  onLabelInputChange,
  onStartRename,
  onCommitRename,
  onCancelEditing,
  onBrowsePath,
  shareBusy,
  shareLocked,
  onToggleShared,
  onUpload,
  onDownload,
  onRequestRemove,
  onBanner,
  onSynced,
  t
}: FolderCardProps): React.JSX.Element {
  const [expanded, setExpanded] = useState(false)
  const [tipOpen, setTipOpen] = useState(false)

  return (
    <div style={styles.folderCard}>
      <div style={styles.faceRow}>
        <Button
          variant="ghost"
          style={styles.chevronBtn}
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          aria-label={t.history.extraFolderSettings}
        >
          <span
            style={{
              display: 'flex',
              transform: expanded ? 'rotate(90deg)' : undefined,
              transition: 'transform var(--t-hover)'
            }}
          >
            <ChevronRightIcon size={12} color={expanded ? colors.cy : colors.text3} />
          </span>
        </Button>
        <span style={styles.folderName}>{folder.label}</span>
        <span style={styles.ownerBadge}>
          {folder.shared ? (
            <FriendsIcon size={10} color={colors.cy} />
          ) : (
            <LockIcon size={10} color={colors.text3} />
          )}
          {folder.shared ? t.history.extraFolderShared : t.history.extraFolderPersonal}
        </span>
        <div style={{ flex: 1 }} />
        {display && (
          <span
            style={{
              ...styles.faceStatusPill,
              color: display.color,
              background: display.bg,
              borderColor: display.bd
            }}
          >
            <span style={{ ...styles.faceStatusDot, background: display.color }} />
            {display.text}
          </span>
        )}
      </div>

      {folder.savePath && (
        <div style={styles.actionsRow}>
          <div style={styles.actionBtns}>
            <Button variant="secondary" style={styles.actionBtn} onClick={onUpload} disabled={busy}>
              {busy ? <span className="spinner" /> : <UploadIcon size={13} color={colors.text1} />}
              {t.gameCard.upload}
            </Button>
            <Button variant="secondary" style={styles.actionBtn} onClick={onDownload} disabled={busy}>
              {busy ? <span className="spinner" /> : <DownloadIcon size={13} color={colors.text1} />}
              {t.gameCard.download}
            </Button>
          </div>
          {versions && <span style={styles.versionsText}>{versions}</span>}
        </div>
      )}

      {expanded && (
        <>
          <div style={styles.divider} />
          <div style={styles.settingsBody}>
            <div>
              <div style={styles.fieldLabelRow}>
                <span style={styles.fieldLabel}>{t.history.extraFolderNameLabel}</span>
              </div>
              {editing ? (
                <input
                  className="input-field"
                  style={styles.fieldInput}
                  value={labelInput}
                  onChange={(e) => onLabelInputChange(e.target.value)}
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') onCommitRename()
                    if (e.key === 'Escape') onCancelEditing()
                  }}
                  onBlur={onCommitRename}
                />
              ) : (
                <div style={styles.nameValueRow}>
                  <span style={styles.pathValueBox}>{folder.label}</span>
                  <Button variant="ghost" style={styles.fieldBrowseBtn} onClick={onStartRename}>
                    <EditIcon size={12} color={colors.text2} />
                  </Button>
                </div>
              )}
            </div>

            <div>
              <div style={styles.fieldLabelRow}>
                <span style={styles.fieldLabel}>{t.history.extraFolderPathLabel}</span>
              </div>
              <div style={styles.fieldRow}>
                <span style={styles.pathValueBox} title={folder.savePath || undefined}>
                  {folder.savePath || t.history.extraFolderNoPath}
                </span>
                <Button variant="secondary" style={styles.fieldBrowseBtn} onClick={onBrowsePath}>
                  {t.history.extraFolderBrowse}
                </Button>
              </div>
            </div>

            <div>
              <div style={styles.fieldLabelRow}>
                <span style={styles.fieldLabel}>{t.history.extraFolderVisibilityLabel}</span>
                <span
                  style={styles.visibilityInfoBtn}
                  onMouseEnter={() => setTipOpen(true)}
                  onMouseLeave={() => setTipOpen(false)}
                >
                  <InfoIcon size={12} color={tipOpen ? colors.cy : colors.text3} />
                  {tipOpen && (
                    <div style={styles.visibilityTip}>
                      {t.history.extraFolderShared}: {t.history.extraFolderSharedHint}{' '}
                      {t.history.extraFolderPersonal}: {t.history.extraFolderPersonalHint}
                    </div>
                  )}
                </span>
              </div>
              {shareLocked ? (
                <div style={styles.fieldHintText}>{t.errors.NOT_FOLDER_OWNER({})}</div>
              ) : (
                <div style={styles.segmentGroup}>
                  <button
                    className="reset-btn segment-option-btn"
                    style={{ ...styles.segmentBtn, ...(!folder.shared ? styles.segmentBtnActive : null) }}
                    onClick={() => !shareBusy && folder.shared && onToggleShared()}
                    disabled={shareBusy}
                  >
                    {shareBusy && folder.shared && <span className="spinner" />}
                    {t.history.extraFolderPersonal}
                  </button>
                  <button
                    className="reset-btn segment-option-btn"
                    style={{ ...styles.segmentBtn, ...(folder.shared ? styles.segmentBtnActive : null) }}
                    onClick={() => !shareBusy && !folder.shared && onToggleShared()}
                    disabled={shareBusy}
                  >
                    {shareBusy && !folder.shared && <span className="spinner" />}
                    {t.history.extraFolderShared}
                  </button>
                </div>
              )}
            </div>

            {folder.savePath && (
              <ExcludeFilesCard
                // Remounts (and re-fetches) whenever the save path actually
                // changes — appId+folderId alone don't change when just the
                // path does.
                key={`${folder.id}:${folder.savePath}`}
                appId={appId}
                folderId={folder.id}
                variant="inline"
                onError={(msg) => onBanner({ text: msg, kind: 'error' })}
                onChanged={onSynced}
              />
            )}

            <div style={styles.removeRow}>
              <button className="reset-btn remove-folder-btn" style={styles.removeBtn} onClick={onRequestRemove}>
                <TrashIcon size={12} color={colors.danger} />
                {t.history.extraFolderRemove}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

export function SharedToggle({
  shared,
  onChange,
  t,
  locked = false,
  busy = false,
  sharedHint,
  personalHint
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
  /** Defaults to the extra-folder wording — GameDetailScreen's own
   *  sync-scope toggle (a whole game, not a folder within one) passes its
   *  own game-level hint text instead. */
  sharedHint?: string
  personalHint?: string
}): React.JSX.Element {
  const disabled = locked || busy
  return (
    <div style={styles.toggleWrap}>
      {/* Sized a step up from FolderCard's own inline segmented toggle
          (scopeSegment* vs segment*) — this one is the primary, always-
          visible per-game/per-add-form choice, not a small control tucked
          in a per-folder settings disclosure, so it gets the full size from
          the design system's own segmented-control spec (4.5) instead of
          the compact variant. */}
      <div style={styles.scopeSegmentGroup}>
        <button
          className="reset-btn segment-option-btn"
          style={{ ...styles.scopeSegmentBtn, ...(!shared ? styles.scopeSegmentBtnActive : null) }}
          onClick={() => !disabled && shared && onChange(false)}
          disabled={disabled}
        >
          {busy && shared && <span className="spinner" />}
          {t.history.extraFolderPersonal}
        </button>
        <button
          className="reset-btn segment-option-btn"
          style={{ ...styles.scopeSegmentBtn, ...(shared ? styles.scopeSegmentBtnActive : null) }}
          onClick={() => !disabled && !shared && onChange(true)}
          disabled={disabled}
        >
          {busy && !shared && <span className="spinner" />}
          {t.history.extraFolderShared}
        </button>
      </div>
      <div style={styles.toggleHint}>
        {locked
          ? t.errors.NOT_FOLDER_OWNER({})
          : busy
            ? t.history.extraFolderShareToggleBusy
            : shared
              ? (sharedHint ?? t.history.extraFolderSharedHint)
              : (personalHint ?? t.history.extraFolderPersonalHint)}
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
  toggleWrap: { marginBottom: 8 },
  toggleHint: { fontSize: 11, color: colors.text3, marginTop: 8, lineHeight: 1.5 },

  // Flexbox, not grid — a grid track's minmax(x,calc(50%-gap)) still caps at
  // "50% of container" even once there's only one card left on its row,
  // leaving the other half empty instead of it filling the row. flex-grow
  // on a flex-wrap row naturally fills whatever's left on its own line,
  // whether that's one card alone or two sharing the row evenly.
  folderGrid: { display: 'flex', flexWrap: 'wrap', gap: 14 },
  folderPlaceholder: {
    flex: '1 1 300px',
    minWidth: 300,
    border: `1px dashed ${colors.borderDefault}`,
    borderRadius: radii.lg,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 84
  },
  folderCard: {
    flex: '1 1 300px',
    minWidth: 300,
    border: `1px solid ${colors.borderDefault}`,
    borderRadius: radii.lg,
    background: colors.bgSurface,
    padding: '14px 16px',
    display: 'flex',
    flexDirection: 'column',
    gap: 12
  },
  faceRow: { display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 10 },
  chevronBtn: { width: 26, height: 26, padding: 0, flexShrink: 0 },
  folderName: {
    fontFamily: fonts.display,
    fontWeight: 600,
    fontSize: 13.5,
    color: colors.text1,
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap'
  },
  ownerBadge: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 5,
    height: 20,
    padding: '0 8px',
    fontFamily: fonts.mono,
    fontSize: 9.5,
    color: colors.text2,
    background: 'rgba(255,255,255,.04)',
    border: `1px solid ${colors.borderDefault}`,
    borderRadius: radii.pill,
    flexShrink: 0,
    whiteSpace: 'nowrap'
  },
  faceStatusPill: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    height: 22,
    padding: '0 10px',
    fontFamily: fonts.display,
    fontWeight: 600,
    fontSize: 11,
    borderRadius: radii.pill,
    border: '1px solid',
    flexShrink: 0,
    whiteSpace: 'nowrap'
  },
  faceStatusDot: { width: 6, height: 6, borderRadius: '50%', flexShrink: 0 },
  actionsRow: { display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
  actionBtns: { display: 'flex', gap: 8 },
  actionBtn: { height: 30, padding: '0 12px', fontSize: 12, whiteSpace: 'nowrap' },
  versionsText: { fontFamily: fonts.mono, fontSize: 10.5, color: colors.text3, whiteSpace: 'nowrap' },
  divider: { height: 1, background: colors.borderSubtle },
  settingsBody: { display: 'flex', flexDirection: 'column', gap: 14 },
  fieldLabelRow: { display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 },
  fieldLabel: {
    fontFamily: fonts.mono,
    fontSize: 10,
    letterSpacing: '.1em',
    textTransform: 'uppercase',
    color: colors.text3
  },
  fieldRow: { display: 'flex', gap: 8 },
  nameValueRow: { display: 'flex', gap: 8 },
  pathValueBox: {
    flex: 1,
    minWidth: 0,
    height: 34,
    display: 'flex',
    alignItems: 'center',
    padding: '0 12px',
    fontFamily: fonts.mono,
    fontSize: 11.5,
    color: colors.text2,
    background: colors.bgInset,
    border: `1px solid ${colors.borderDefault}`,
    borderRadius: radii.md,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap'
  },
  fieldBrowseBtn: { height: 34, padding: '0 12px', flexShrink: 0, fontSize: 11.5, whiteSpace: 'nowrap' },
  fieldInput: {
    width: '100%',
    height: 34,
    padding: '0 10px',
    border: `1px solid ${colors.borderAccent}`,
    borderRadius: radii.md,
    background: colors.bgInset,
    color: colors.text1,
    fontSize: 13,
    outline: 'none'
  },
  fieldHintText: { fontSize: 11, color: colors.text3, lineHeight: 1.5 },
  visibilityInfoBtn: { position: 'relative', display: 'inline-flex', color: colors.text3, cursor: 'help' },
  visibilityTip: {
    position: 'absolute',
    top: 'calc(100% + 8px)',
    left: 0,
    width: 260,
    zIndex: 5,
    padding: '10px 12px',
    fontSize: 11.5,
    lineHeight: 1.5,
    color: colors.text2,
    background: colors.bgOverlay,
    border: `1px solid ${colors.borderStrong}`,
    borderRadius: radii.md,
    boxShadow: shadows.sh3
  },
  segmentGroup: {
    display: 'inline-flex',
    padding: 3,
    borderRadius: radii.pill,
    background: colors.bgInset,
    border: `1px solid ${colors.borderDefault}`,
    gap: 2
  },
  segmentBtn: {
    height: 26,
    padding: '0 12px',
    fontFamily: fonts.display,
    fontWeight: 600,
    fontSize: 11,
    border: 'none',
    borderRadius: radii.pill,
    background: 'transparent',
    color: colors.text3,
    cursor: 'pointer'
  },
  segmentBtnActive: { background: colors.bgHover, color: colors.text1 },
  // Same shape/colors as segmentGroup/segmentBtn above, just a size step up
  // (design system 4.5's own segmented-control numbers: 32px/0 16px/12.5px)
  // for SharedToggle's two prominent, always-visible usages — see its own
  // comment for why it doesn't just reuse the compact FolderCard sizing.
  scopeSegmentGroup: {
    display: 'inline-flex',
    padding: 3,
    borderRadius: radii.pill,
    background: colors.bgInset,
    border: `1px solid ${colors.borderDefault}`,
    gap: 2
  },
  scopeSegmentBtn: {
    height: 32,
    padding: '0 16px',
    fontFamily: fonts.display,
    fontWeight: 600,
    fontSize: 12.5,
    border: 'none',
    borderRadius: radii.pill,
    background: 'transparent',
    color: colors.text3,
    cursor: 'pointer'
  },
  scopeSegmentBtnActive: { background: colors.bgHover, color: colors.text1 },
  removeRow: { display: 'flex', justifyContent: 'flex-end' },
  removeBtn: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    height: 26,
    padding: '0 10px',
    fontFamily: fonts.display,
    fontWeight: 600,
    fontSize: 11,
    color: colors.danger,
    background: 'transparent',
    border: 'none',
    cursor: 'pointer'
  }
}

export default ExtraFoldersSection

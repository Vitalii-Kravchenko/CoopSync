import { useEffect, useRef, useState } from 'react'
import { colors, fonts, radii, steamPoster, transitions } from '../theme'
import { useI18n } from '../i18n'
import { describeError, describeSyncResult } from '../errors'
import type { Translation } from '../i18n'
import {
  ChevronRightIcon,
  HistoryIcon,
  FolderIcon,
  EditIcon,
  TrashIcon,
  AlertTriangleIcon,
  LockIcon
} from '../components/icons'
import Avatar from '../components/Avatar'
import Button from '../components/Button'
import ConfirmModal from '../components/ConfirmModal'
import CoverCropModal from '../components/CoverCropModal'
import ExcludeFilesCard from '../components/ExcludeFilesCard'
import ExtraFoldersSection from '../components/ExtraFoldersSection'
import ExePicker from '../components/ExePicker'
import Pagination from '../components/Pagination'
import type { BannerState } from '../components/Banner'
import { syncDisplay } from '../components/GameCard'
import { useAvatars } from '../hooks/useAvatars'
import { useRowCapacity } from '../hooks/useRowCapacity'
import type { AuthUser, SyncHistoryEntry, GameSavePathInfo, SyncStatus } from '../../../shared/types'
import { formatVersion as fmtVersion } from '../../../shared/format'
import { devHistoryMock } from '../devHistoryMock'

// ISO timestamp -> "2 min ago" / "1 hr ago" / "3 days ago" (localized).
function formatRelativeTime(iso: string, t: Translation): string {
  const diffMin = Math.floor((Date.now() - new Date(iso).getTime()) / 60000)
  if (diffMin < 1) return t.history.justNow
  if (diffMin < 60) return t.history.minutesAgo(diffMin)
  const diffHours = Math.floor(diffMin / 60)
  if (diffHours < 24) return t.history.hoursAgo(diffHours)
  const diffDays = Math.floor(diffHours / 24)
  return t.history.daysAgo(diffDays)
}

interface Props {
  appId: string
  name: string
  /** Added manually, not from CoopSync's built-in catalog — shows a
   *  disclaimer and a "Remove game" action. */
  isCustom?: boolean
  /** Custom game's own cover art, if set (isCustom only). */
  coverDataUrl?: string
  /** True if the last attempt to push the cover to the shared repo failed —
   *  shows a persistent retry banner instead of the failure just vanishing. */
  coverSyncFailed?: boolean
  /** Opened via the "Set up" action on a needs-setup card (a co-op partner's
   *  custom game with no local save folder yet) — highlights exactly what's
   *  missing instead of leaving the user to hunt for it. Clears itself once
   *  a save path is actually set, so it doesn't linger after the fix. */
  needsSetup?: boolean
  /** A custom game's cover was just changed — lets MainScreen's game list
   *  pick up the new art (only relevant when isCustom is true). */
  onCoverChanged: (appId: string, dataUrl: string | null) => void
  /** A custom game was just renamed — lets MainScreen's game list pick up
   *  the new name (only relevant when isCustom is true). */
  onNameChanged: (appId: string, name: string) => void
  /** Changes after every real push — a signal to reread this game's history. */
  syncVersion: number
  user: AuthUser
  /** Own avatar from local settings — same source as TitleBar/Friends. */
  avatarDataUrl: string | null
  onBack: () => void
  /** Show a global banner (rendered in App — visible on all tabs). */
  onBanner: (banner: BannerState) => void
  /** Call after a real push (a revert is one) — lets History/MainScreen reread. */
  onSynced: () => void
  /** A custom game was just removed — lets MainScreen drop it and go back to
   *  the grid (only relevant when isCustom is true). */
  onCustomGameRemoved: () => void
  /** True while this game's background autopush (post game-exit) is still in
   *  flight — blocks "Restore" so it can't race the same git clone. */
  autoPushPending: boolean
  /** Current sync status pill (mirrors the same field on its Games-tab card)
   *  — undefined while still checking. */
  status?: SyncStatus
}

// A single game's own sync history — reached from its card on the Games tab.
// Every entry but the newest can be reverted to — see revertToVersion in
// main/services/sync.ts for how that actually works (a new version carrying
// old content forward, not a branch).
function GameDetailScreen({
  appId,
  name,
  isCustom,
  coverDataUrl,
  coverSyncFailed: coverSyncFailedProp,
  needsSetup,
  onCoverChanged,
  onNameChanged,
  syncVersion,
  user,
  avatarDataUrl,
  onBack,
  onBanner,
  onSynced,
  onCustomGameRemoved,
  autoPushPending,
  status
}: Props): React.JSX.Element {
  const { t } = useI18n()
  const [entries, setEntries] = useState<SyncHistoryEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [imgError, setImgError] = useState(false)
  const [cover, setCover] = useState(coverDataUrl)
  const [coverSrc, setCoverSrc] = useState<string | null>(null)
  const [savingCover, setSavingCover] = useState(false)
  const [coverError, setCoverError] = useState<string | null>(null)
  const [coverSyncFailed, setCoverSyncFailed] = useState(!!coverSyncFailedProp)
  const [retryingCoverSync, setRetryingCoverSync] = useState(false)
  const [displayName, setDisplayName] = useState(name)
  const [editingName, setEditingName] = useState(false)
  const [nameInput, setNameInput] = useState('')
  const [savingName, setSavingName] = useState(false)
  const [nameError, setNameError] = useState<string | null>(null)
  // Anchor for the "Needs setup" banner's jump link — scrolls straight to the
  // one field actually blocking sync instead of leaving the user to hunt for it.
  const savePathRef = useRef<HTMLDivElement>(null)
  // Compact summary vs. the full scan/candidates UI — collapses ExePicker to
  // a one-line "already configured" state instead of always showing the full
  // install-folder scanner (see design brief: purpose-grouped cards, not a
  // flat stack of every control at once).
  const [editingExe, setEditingExe] = useState(false)

  function startEditName(): void {
    setNameInput(displayName)
    setNameError(null)
    setEditingName(true)
  }

  async function handleSaveName(): Promise<void> {
    const trimmed = nameInput.trim()
    if (!trimmed || trimmed === displayName) {
      setEditingName(false)
      return
    }
    setSavingName(true)
    setNameError(null)
    try {
      await window.api.games.renameCustom(appId, trimmed)
      setDisplayName(trimmed)
      onNameChanged(appId, trimmed)
      setEditingName(false)
      onSynced()
    } catch (e) {
      setNameError(describeError(e, t, t.history.renameGameError))
    } finally {
      setSavingName(false)
    }
  }

  async function handlePickCover(): Promise<void> {
    setCoverError(null)
    try {
      const raw = await window.api.games.pickCoverFile()
      if (raw) setCoverSrc(raw)
    } catch (e) {
      setCoverError(describeError(e, t, t.history.coverError))
    }
  }

  async function handleCoverCropped(dataUrl: string): Promise<void> {
    setSavingCover(true)
    try {
      const result = await window.api.games.saveCover(appId, dataUrl)
      setCover(dataUrl)
      setImgError(false)
      onCoverChanged(appId, dataUrl)
      setCoverSyncFailed(result.coverSyncFailed)
      onBanner(
        result.coverSyncFailed
          ? { text: t.history.coverSyncFailedBanner, kind: 'error' }
          : { text: t.history.coverUpdated, kind: 'success' }
      )
    } catch (e) {
      setCoverError(describeError(e, t, t.history.coverError))
    } finally {
      setSavingCover(false)
      setCoverSrc(null)
    }
  }

  async function handleRetryCoverSync(): Promise<void> {
    setRetryingCoverSync(true)
    try {
      const result = await window.api.games.retryCoverPush(appId)
      setCoverSyncFailed(result.coverSyncFailed)
      if (!result.coverSyncFailed) onBanner({ text: t.history.coverSyncRetrySuccess, kind: 'success' })
    } catch (e) {
      onBanner({ text: describeError(e, t, t.history.coverError), kind: 'error' })
    } finally {
      setRetryingCoverSync(false)
    }
  }
  // This screen's header (breadcrumbs + poster/title row, ~140px) is taller
  // than HistoryScreen's (plain title + search, ~100px) — useRowCapacity's
  // tiers assume the shorter one, so without trimming a row, a full page
  // plus the pagination bar doesn't actually fit and forces a scrollbar.
  const pageSize = useRowCapacity(1)
  const [page, setPage] = useState(1)
  const [restoreTarget, setRestoreTarget] = useState<SyncHistoryEntry | null>(null)
  const [restoring, setRestoring] = useState(false)
  const [restoreError, setRestoreError] = useState<string | null>(null)

  // Where this game's saves live — a user override, or the catalog default.
  const [savePathInfo, setSavePathInfo] = useState<GameSavePathInfo | null>(null)
  const [editingPath, setEditingPath] = useState(false)
  const [pathInput, setPathInput] = useState('')
  const [savingPath, setSavingPath] = useState(false)
  const [savePathError, setSavePathError] = useState<string | null>(null)

  useEffect(() => {
    setEditingPath(false)
    setSavePathError(null)
    window.api.games
      .getSavePath(appId)
      .then(setSavePathInfo)
      .catch(() => setSavePathInfo(null))
  }, [appId])

  // Opened via "Set up" on a needs-setup card — highlight the save-path field
  // (the only thing actually blocking sync) until a path is set, then clear
  // on its own instead of lingering after the fix.
  const stillNeedsSetup = !!needsSetup && !savePathInfo?.path

  // .exe name(s) driving launch/exit auto-sync — only relevant for a custom
  // game. Loaded separately from the save path since a co-op partner setting
  // up a game they didn't add themselves needs to configure both.
  const [processNames, setProcessNames] = useState<string[]>([])

  useEffect(() => {
    if (!isCustom) return
    window.api.games
      .getProcessNames(appId)
      .then(setProcessNames)
      .catch(() => setProcessNames([]))
  }, [appId, isCustom])

  function handleProcessNamesChange(names: string[]): void {
    setProcessNames(names)
    window.api.games
      .setProcessNames(appId, names)
      .then(onSynced)
      .catch((e) => {
        onBanner({ text: describeError(e, t, t.history.savePathSaveError), kind: 'error' })
      })
  }

  function startEditPath(): void {
    setPathInput(savePathInfo?.path ?? '')
    setSavePathError(null)
    setEditingPath(true)
  }

  async function savePath(path: string): Promise<void> {
    const trimmed = path.trim()
    if (!trimmed) return
    setSavingPath(true)
    setSavePathError(null)
    try {
      const info = await window.api.games.setSavePath(appId, trimmed)
      setSavePathInfo(info)
      setEditingPath(false)
      // The Games tab's card (size, last sync) reads from syncStatuses, which
      // only reflects the save folder actually being pointed here — without
      // this it stays stale until a manual refresh or a tab switch.
      onSynced()
    } catch (e) {
      setSavePathError(describeError(e, t, t.history.savePathSaveError))
    } finally {
      setSavingPath(false)
    }
  }

  // Picking a folder already IS the confirmation — auto-save right away
  // instead of making the user click Save afterward as a separate step.
  async function handleBrowsePath(): Promise<void> {
    const picked = await window.api.games.pickSaveFolder()
    if (!picked) return
    setPathInput(picked)
    await savePath(picked)
  }

  async function handleSavePath(): Promise<void> {
    await savePath(pathInput)
  }

  async function handleResetPath(): Promise<void> {
    setSavingPath(true)
    try {
      const info = await window.api.games.setSavePath(appId, null)
      setSavePathInfo(info)
      onSynced()
    } catch (e) {
      onBanner({ text: describeError(e, t, t.history.savePathSaveError), kind: 'error' })
    } finally {
      setSavingPath(false)
    }
  }

  const [showRemoveConfirm, setShowRemoveConfirm] = useState(false)
  const [removing, setRemoving] = useState(false)
  const [removeError, setRemoveError] = useState<string | null>(null)

  async function handleRemoveGame(): Promise<void> {
    setRemoving(true)
    setRemoveError(null)
    try {
      await window.api.games.removeCustom(appId)
      onBanner({ text: t.history.removeCustomGameSuccess(displayName), kind: 'success' })
      onCustomGameRemoved()
    } catch (e) {
      const msg = describeError(e, t, t.history.removeCustomGameError)
      setRemoveError(msg)
      onBanner({ text: msg, kind: 'error' })
    } finally {
      setRemoving(false)
    }
  }

  function load(): void {
    setLoading(true)
    window.api.sync
      .history()
      .then((real) => {
        // Same dev fallback as HistoryScreen — always the fixture in dev.
        const list = import.meta.env.DEV ? devHistoryMock(user.login) : real
        setEntries(list.filter((e) => e.appId === appId))
        setLoadError(null)
      })
      .catch((e) => setLoadError(describeError(e, t, t.history.loadError)))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appId])

  useEffect(() => {
    if (syncVersion > 0) load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [syncVersion])

  async function handleRestore(): Promise<void> {
    if (!restoreTarget) return
    setRestoring(true)
    setRestoreError(null)
    try {
      const result = await window.api.sync.revert(appId, restoreTarget.version)
      setRestoreTarget(null)
      onBanner({
        text: describeSyncResult('revert-success', { version: String(result.version) }, t),
        kind: 'success'
      })
      onSynced()
      load()
    } catch (e) {
      setRestoreError(describeError(e, t, t.history.restoreError))
    } finally {
      setRestoring(false)
    }
  }

  const showTable = loading || entries.length > 0
  // The newest entry has nothing to revert to — it's already the current save.
  const latestVersion = entries[0]?.version
  // Clamped rather than reset via effect — see HistoryScreen for the same pattern.
  const totalPages = Math.max(1, Math.ceil(entries.length / pageSize))
  const currentPage = Math.min(page, totalPages)
  const visible = entries.slice((currentPage - 1) * pageSize, currentPage * pageSize)
  const avatars = useAvatars(
    entries.map((e) => e.updatedBy),
    user.login,
    avatarDataUrl,
    syncVersion
  )

  return (
    <div style={styles.screen}>
      {/* Breadcrumbs — design system 4.12 Navigation: same 3-level drill-down
          pattern (Library / Game / sub-page) shown in docs/design-system.html. */}
      <div style={styles.breadcrumbs}>
        <BreadcrumbLink label={t.sidebar.games} onClick={onBack} />
        <span style={styles.crumbSep}>/</span>
        <span style={styles.crumbMuted}>{displayName}</span>
        <ChevronRightIcon size={14} color={colors.cy} />
        <span style={styles.crumbCurrent}>{t.history.title}</span>
      </div>

      <div style={styles.header}>
        {cover || !imgError ? (
          <img
            src={cover ?? steamPoster(appId)}
            alt=""
            style={styles.poster}
            onError={() => {
              if (!cover) setImgError(true)
            }}
          />
        ) : (
          <div style={styles.posterFallback} />
        )}
        <div style={styles.nameCol}>
          {editingName ? (
            <div>
              <div style={styles.editNameRow}>
                <input
                  className="input-field"
                  style={styles.nameInput}
                  value={nameInput}
                  onChange={(e) => setNameInput(e.target.value)}
                  autoFocus
                  disabled={savingName}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void handleSaveName()
                    if (e.key === 'Escape') setEditingName(false)
                  }}
                />
                <Button
                  variant="primary"
                  style={styles.smallBtn}
                  onClick={handleSaveName}
                  disabled={savingName || !nameInput.trim()}
                >
                  {savingName && <span className="spinner" />}
                  {t.history.savePathSave}
                </Button>
                <Button
                  variant="ghost"
                  style={styles.smallBtn}
                  onClick={() => setEditingName(false)}
                  disabled={savingName}
                >
                  {t.history.savePathCancel}
                </Button>
              </div>
              {nameError && <div style={styles.savePathErrorText}>{nameError}</div>}
            </div>
          ) : (
            <div style={styles.nameRow}>
              <div style={styles.h1}>{displayName}</div>
              {isCustom && (
                <Button
                  variant="ghost"
                  style={styles.editNameBtn}
                  onClick={startEditName}
                  title={t.history.renameGame}
                  aria-label={t.history.renameGame}
                >
                  <EditIcon size={13} color={colors.text2} />
                </Button>
              )}
            </div>
          )}
          {isCustom && (
            <Button variant="ghost" style={styles.changeCoverBtn} onClick={handlePickCover}>
              <EditIcon size={12} color={colors.text2} />
              {t.history.changeCover}
            </Button>
          )}
          {coverError && <div style={styles.savePathErrorText}>{coverError}</div>}
        </div>
        {!editingName && (
          // Grouped together (instead of two siblings directly in .header)
          // so they center on each other regardless of their own height
          // difference (22px badge vs 26px pill) — as two direct children of
          // .header's alignItems:'flex-start', they both just sat at the top
          // of the row instead, with the badge visibly higher than the pill.
          <div style={styles.badgeGroup}>
            {isCustom && (
              <span title={t.history.customGameWarning} style={styles.customBadgeHeader}>
                {t.history.customGameBadge}
              </span>
            )}
            {(() => {
              const syncing = autoPushPending
              const display = syncDisplay(status, t)
              return (
                <span
                  style={{
                    ...styles.statusPillHeader,
                    color: syncing ? colors.info : display.color,
                    background: syncing ? colors.infoBg : display.bg,
                    borderColor: syncing ? colors.infoBd : display.bd
                  }}
                >
                  <span
                    style={{ ...styles.statusDot, background: syncing ? colors.info : display.color }}
                  />
                  {syncing ? t.gameCard.syncing : display.text}
                </span>
              )
            })()}
          </div>
        )}
      </div>

      {coverSrc && (
        <CoverCropModal
          src={coverSrc}
          busy={savingCover}
          onCancel={() => setCoverSrc(null)}
          onConfirm={handleCoverCropped}
        />
      )}

      {stillNeedsSetup && (
        <div style={styles.needsSetupBanner}>
          <AlertTriangleIcon size={16} color={colors.warning} />
          <span>
            <b style={styles.needsSetupBold}>{t.history.needsSetupTitle}</b> — {t.history.savePathNeedsSetupHint}{' '}
            <a
              href="#"
              style={styles.jumpLink}
              onClick={(e) => {
                e.preventDefault()
                savePathRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
              }}
            >
              {t.history.jumpToIt} ↓
            </a>
          </span>
        </div>
      )}

      {isCustom && coverSyncFailed && (
        <div style={styles.coverSyncBanner}>
          <AlertTriangleIcon size={14} color={colors.text3} />
          <span style={styles.retryCoverText}>{t.history.coverSyncFailedBanner}</span>
          <Button
            variant="ghost"
            style={styles.retryCoverBtn}
            onClick={handleRetryCoverSync}
            disabled={retryingCoverSync}
          >
            {retryingCoverSync && <span className="spinner" />}
            {t.main.retry}
          </Button>
        </div>
      )}

      <div style={styles.sectionLabel}>{t.history.sectionWhereSavesLive}</div>
      <div
        ref={savePathRef}
        style={{ ...styles.savePathCard, ...(stillNeedsSetup ? styles.savePathCardHighlight : null) }}
      >
        <div style={styles.savePathTopRow}>
          <div style={styles.savePathLabelRow}>
            <FolderIcon size={14} color={colors.text3} />
            <span style={styles.savePathLabel}>{t.history.savePathTitle}</span>
            {savePathInfo?.isCustom && <span style={styles.customBadge}>{t.history.savePathCustomBadge}</span>}
          </div>
          {!editingPath && (
            <div style={{ display: 'flex', gap: 8 }}>
              {autoPushPending ? (
                <span title={t.history.savePathLocked} style={styles.lockedHint}>
                  <LockIcon size={12} color={colors.text3} />
                </span>
              ) : (
                <>
                  {savePathInfo?.isCustom && (
                    <Button
                      variant="ghost"
                      style={styles.smallBtn}
                      onClick={handleResetPath}
                      disabled={savingPath}
                    >
                      {t.history.savePathReset}
                    </Button>
                  )}
                  <Button variant="ghost" style={styles.smallBtn} onClick={startEditPath}>
                    <EditIcon size={13} color={colors.text2} />
                    {t.history.savePathEdit}
                  </Button>
                </>
              )}
            </div>
          )}
        </div>

        {!editingPath ? (
          <>
            <div style={styles.savePathValue} title={savePathInfo?.path}>
              {savePathInfo?.path ?? '—'}
            </div>
            {savePathInfo && !savePathInfo.exists && (
              <div style={styles.savePathWarning}>{t.history.savePathNotFound}</div>
            )}
          </>
        ) : (
          <div>
            <div style={styles.editRow}>
              <input
                className="input-field"
                style={styles.pathInput}
                value={pathInput}
                onChange={(e) => setPathInput(e.target.value)}
                placeholder={t.history.savePathPlaceholder}
                autoFocus
              />
              <Button variant="secondary" style={styles.browseBtn} onClick={handleBrowsePath}>
                {t.history.savePathBrowse}
              </Button>
            </div>
            {savePathError && <div style={styles.savePathErrorText}>{savePathError}</div>}
            <div style={styles.editActions}>
              <Button
                variant="primary"
                style={styles.smallBtn}
                onClick={handleSavePath}
                disabled={savingPath || !pathInput.trim()}
              >
                {savingPath && <span className="spinner" />}
                {t.history.savePathSave}
              </Button>
              <Button
                variant="ghost"
                style={styles.smallBtn}
                onClick={() => setEditingPath(false)}
                disabled={savingPath}
              >
                {t.history.savePathCancel}
              </Button>
            </div>
          </div>
        )}
      </div>

      {isCustom && (
        <>
          <div style={styles.sectionLabel}>{t.history.sectionSyncBehavior}</div>
          <div style={styles.syncBehaviorGrid}>
            <div style={styles.exeCard}>
              <div style={styles.savePathTopRow}>
                <div style={styles.savePathLabelRow}>
                  <LockIcon size={14} color={colors.text3} />
                  <span style={styles.savePathLabel}>{t.history.autoSyncExeTitle}</span>
                </div>
                {!editingExe && (
                  <Button variant="ghost" style={styles.smallBtn} onClick={() => setEditingExe(true)}>
                    <EditIcon size={13} color={colors.text2} />
                    {t.history.savePathEdit}
                  </Button>
                )}
              </div>
              {editingExe ? (
                <>
                  <ExePicker selected={processNames} onSelectedChange={handleProcessNamesChange} />
                  <div style={styles.editActions}>
                    <Button variant="primary" style={styles.smallBtn} onClick={() => setEditingExe(false)}>
                      {t.addGame.done}
                    </Button>
                  </div>
                </>
              ) : processNames.length > 0 ? (
                <>
                  <div style={styles.savePathValue}>{processNames.join(', ')}</div>
                  <div style={styles.exeHint}>{t.history.autoSyncExeHint}</div>
                </>
              ) : (
                <div style={styles.exeHint}>{t.history.autoSyncNotSet}</div>
              )}
            </div>

            <ExcludeFilesCard
              // Remounts (and re-fetches) whenever the save path actually
              // changes — without this it kept showing the file list from
              // whatever folder was set before, since appId/folderId alone
              // don't change when just the path does.
              key={`${appId}:${savePathInfo?.path ?? ''}`}
              appId={appId}
              onError={(msg) => onBanner({ text: msg, kind: 'error' })}
              onChanged={onSynced}
              style={styles.syncBehaviorItem}
            />
          </div>

          <ExtraFoldersSection
            appId={appId}
            syncVersion={syncVersion}
            onBanner={onBanner}
            onSynced={onSynced}
            user={user}
          />
        </>
      )}

      <div style={styles.sectionLabel}>{t.history.title}</div>

      {showTable && (
        <div style={styles.table}>
          <div style={styles.headerRow}>
            <div style={styles.headerCell}>{t.history.columnAction}</div>
            <div style={styles.headerCell}>{t.history.columnPlayer}</div>
            <div style={styles.headerCell}>{t.history.columnVersion}</div>
            <div style={styles.headerCell}>{t.history.columnWhen}</div>
            <div style={styles.headerCell} />
          </div>

          {loading
            ? [0, 1, 2].map((i) => <ShimmerRow key={i} last={i === 2} />)
            : visible.map((e, i) => (
                <HistoryRow
                  key={`${e.appId}-${e.updatedAt}`}
                  entry={e}
                  t={t}
                  avatarSrc={avatars[e.updatedBy]}
                  last={i === visible.length - 1}
                  canRestore={e.version !== latestVersion}
                  restoreDisabled={autoPushPending}
                  onRestoreClick={() => setRestoreTarget(e)}
                />
              ))}
        </div>
      )}

      {!loading && <Pagination page={currentPage} totalPages={totalPages} onChange={setPage} />}

      {!loading && entries.length === 0 && (
        <div style={styles.empty}>
          <div style={styles.emptyIcon}>
            <HistoryIcon size={20} color={colors.text3} />
          </div>
          <div style={styles.emptyTitle}>{loadError ?? t.history.emptyTitle}</div>
          {!loadError && <div style={styles.emptySubtitle}>{t.history.emptySubtitle}</div>}
        </div>
      )}

      {isCustom && (
        <>
          <div style={styles.dangerDivider} />
          <div style={styles.dangerZone}>
            <div style={styles.dangerZoneText}>
              <div style={styles.dangerZoneTitle}>{t.history.dangerZoneTitle}</div>
              <div style={styles.dangerZoneDesc}>{t.history.dangerZoneDesc}</div>
            </div>
            <Button variant="danger" style={styles.dangerZoneBtn} onClick={() => setShowRemoveConfirm(true)}>
              <TrashIcon size={13} color={colors.danger} />
              {t.history.removeCustomGame}
            </Button>
          </div>
        </>
      )}

      {restoreTarget && (
        <ConfirmModal
          title={t.history.restoreConfirmTitle}
          description={t.history.restoreConfirmDesc(
            fmtVersion(restoreTarget.version),
            restoreTarget.updatedBy
          )}
          confirmLabel={t.history.restore}
          cancelLabel={t.settings.cancel}
          countdownSeconds={3}
          busy={restoring || autoPushPending}
          error={restoreError}
          onConfirm={handleRestore}
          onCancel={() => {
            setRestoreTarget(null)
            setRestoreError(null)
          }}
        />
      )}

      {showRemoveConfirm && (
        <ConfirmModal
          title={t.history.removeCustomGameConfirmTitle}
          description={t.history.removeCustomGameConfirmDesc(displayName)}
          confirmLabel={t.history.removeCustomGame}
          cancelLabel={t.settings.cancel}
          countdownSeconds={3}
          busy={removing}
          error={removeError}
          onConfirm={handleRemoveGame}
          onCancel={() => {
            setShowRemoveConfirm(false)
            setRemoveError(null)
          }}
        />
      )}
    </div>
  )
}

function HistoryRow({
  entry,
  t,
  avatarSrc,
  last,
  canRestore,
  restoreDisabled,
  onRestoreClick
}: {
  entry: SyncHistoryEntry
  t: Translation
  /** Player's avatar (data URL), if we have one — placeholder otherwise. */
  avatarSrc?: string
  last: boolean
  /** false for the newest entry — nothing to revert to. */
  canRestore: boolean
  /** True while this game's background autopush is in flight — greys the
   *  button out instead of hiding it, since it's back to usable in a moment. */
  restoreDisabled: boolean
  onRestoreClick: () => void
}): React.JSX.Element {
  const [hover, setHover] = useState(false)

  return (
    <div
      style={{
        ...styles.row,
        borderBottom: last ? 'none' : `1px solid ${colors.borderSubtle}`,
        background: hover ? colors.bgHover : 'transparent'
      }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <div>
        <span style={styles.actionPill}>
          <span style={styles.actionDot} />
          {t.history.uploaded}
        </span>
      </div>
      <div style={styles.playerCell}>
        <Avatar src={avatarSrc} size={22} />
        <span style={styles.playerName}>{entry.updatedBy}</span>
      </div>
      <div style={styles.mono}>
        {fmtVersion(entry.version)}
        {entry.restoredFrom !== undefined && (
          <span style={styles.restoredBadge}>{t.history.restoredFromBadge(fmtVersion(entry.restoredFrom))}</span>
        )}
      </div>
      <div style={styles.mono}>{formatRelativeTime(entry.updatedAt, t)}</div>
      <div>
        {canRestore && (
          <Button
            variant="ghost"
            style={styles.restoreBtn}
            onClick={onRestoreClick}
            disabled={restoreDisabled}
            title={restoreDisabled ? t.history.restorePendingHint : undefined}
          >
            {t.history.restore}
          </Button>
        )}
      </div>
    </div>
  )
}

function BreadcrumbLink({ label, onClick }: { label: string; onClick: () => void }): React.JSX.Element {
  const [hover, setHover] = useState(false)

  return (
    <span
      style={{ ...styles.crumbLink, color: hover ? colors.cy : colors.text3 }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onClick={onClick}
    >
      {label}
    </span>
  )
}

function ShimmerRow({ last }: { last: boolean }): React.JSX.Element {
  return (
    <div style={{ ...styles.row, borderBottom: last ? 'none' : `1px solid ${colors.borderSubtle}` }}>
      <div style={{ ...styles.shimmer, width: 90, height: 12 }} />
      <div style={styles.playerCell}>
        <div style={{ ...styles.shimmer, width: 22, height: 22, borderRadius: '50%' }} />
        <div style={{ ...styles.shimmer, width: 70, height: 12 }} />
      </div>
      <div style={{ ...styles.shimmer, width: 50, height: 12 }} />
      <div style={{ ...styles.shimmer, width: 60, height: 12 }} />
      <div />
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  screen: { flex: 1, overflowY: 'auto', padding: '28px 36px 40px' },
  breadcrumbs: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    fontSize: 13,
    marginBottom: 20
  },
  crumbLink: { cursor: 'pointer', transition: `color ${transitions.fast}` },
  crumbSep: { color: colors.text3 },
  crumbMuted: {
    color: colors.text3,
    minWidth: 0,
    maxWidth: 260,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap'
  },
  crumbCurrent: { color: colors.cy },
  header: { display: 'flex', alignItems: 'flex-start', flexWrap: 'wrap', gap: 16, marginBottom: 18 },
  nameCol: { flex: 1, minWidth: 0 },
  poster: {
    width: 52,
    height: 78,
    borderRadius: radii.sm,
    objectFit: 'cover',
    border: `1px solid ${colors.borderSubtle}`,
    flexShrink: 0
  },
  posterFallback: {
    width: 52,
    height: 78,
    borderRadius: radii.sm,
    background: `linear-gradient(160deg,${colors.bgRaised},${colors.bgBase})`,
    border: `1px solid ${colors.borderSubtle}`,
    flexShrink: 0
  },
  h1: { fontFamily: fonts.display, fontSize: 22, fontWeight: 700, color: colors.text1 },
  nameRow: { display: 'flex', alignItems: 'center', gap: 8 },
  editNameBtn: { width: 28, height: 28, padding: 0, flexShrink: 0 },
  editNameRow: { display: 'flex', alignItems: 'center', gap: 8 },
  nameInput: {
    height: 34,
    padding: '0 10px',
    border: `1px solid ${colors.borderDefault}`,
    borderRadius: radii.md,
    background: colors.bgInset,
    color: colors.text1,
    fontFamily: fonts.display,
    fontSize: 16,
    fontWeight: 700,
    outline: 'none',
    minWidth: 220
  },
  changeCoverBtn: { height: 28, padding: '0 10px', fontSize: 11.5, marginTop: 8 },
  badgeGroup: { display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 },
  customBadgeHeader: {
    display: 'inline-flex',
    alignItems: 'center',
    height: 22,
    padding: '0 9px',
    fontFamily: fonts.mono,
    fontSize: 10,
    letterSpacing: '.04em',
    color: colors.text3,
    background: 'rgba(255,255,255,.04)',
    border: `1px solid ${colors.borderDefault}`,
    borderRadius: radii.pill,
    flexShrink: 0,
    cursor: 'default'
  },
  statusPillHeader: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 7,
    height: 26,
    padding: '0 11px',
    fontFamily: fonts.display,
    fontWeight: 600,
    fontSize: 11.5,
    letterSpacing: '.04em',
    borderRadius: radii.pill,
    border: '1px solid',
    flexShrink: 0
  },
  statusDot: { width: 6, height: 6, borderRadius: '50%' },
  needsSetupBanner: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 10,
    fontSize: 12.5,
    lineHeight: 1.5,
    color: colors.text1,
    background: colors.warningBg,
    border: `1px solid ${colors.warningBd}`,
    borderLeft: `3px solid ${colors.warning}`,
    borderRadius: radii.md,
    padding: '12px 14px',
    marginBottom: 12
  },
  needsSetupBold: { color: colors.text1 },
  jumpLink: { color: colors.warning, textDecoration: 'underline', whiteSpace: 'nowrap' },
  coverSyncBanner: {
    display: 'flex',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 10,
    fontSize: 12,
    lineHeight: 1.5,
    color: colors.text2,
    background: 'rgba(255,255,255,.03)',
    border: `1px solid ${colors.borderDefault}`,
    borderRadius: radii.md,
    padding: '9px 13px',
    marginBottom: 20
  },
  retryCoverText: { flex: 1, minWidth: 0 },
  retryCoverBtn: { height: 26, padding: '0 12px', fontSize: 11.5, whiteSpace: 'nowrap', flexShrink: 0 },
  sectionLabel: {
    fontFamily: fonts.mono,
    fontSize: 10,
    letterSpacing: '.14em',
    textTransform: 'uppercase',
    color: colors.cy,
    margin: '26px 0 10px'
  },
  lockedHint: { display: 'inline-flex', alignItems: 'center', padding: '0 4px', cursor: 'default' },
  // Flexbox, not grid — a grid track's minmax(x,calc(50%-gap)) still caps at
  // "50% of container" even once auto-fit has dropped to a single column,
  // leaving the other half empty instead of the lone item filling the row.
  // flex-grow on a flex-wrap row naturally fills whatever's left on its own
  // line, whether that's one item alone or two sharing the row evenly.
  // minWidth 320 (not a smaller number) is deliberate: the window's own
  // hard floor (880px, main/index.ts) leaves ~610px for this content area
  // at minimum size — anything much under 320 each never actually reaches
  // the width where wrapping would trigger, so the "collapses to one
  // column" behavior would exist in code but be unreachable in practice.
  syncBehaviorGrid: { display: 'flex', flexWrap: 'wrap', gap: 16, marginBottom: 20 },
  // Default align-items:'stretch' matches this row's two items' heights —
  // but only because each IS the actual bordered card (ExcludeFilesCard
  // takes this as its own root's style instead of being wrapped in an
  // extra div, which stretch can't see through to size correctly).
  // marginBottom:0 cancels ExcludeFilesCard's own default spacing (meant for
  // when it sits stacked above other content) — align-items:'stretch' grows
  // an item's border box to fill the line height MINUS its own margin, so
  // that unrelated 20px margin was quietly shrinking its visible border box
  // 20px shorter than exeCard's right next to it.
  syncBehaviorItem: { flex: '1 1 320px', minWidth: 320, marginBottom: 0 },
  exeCard: {
    flex: '1 1 320px',
    minWidth: 320,
    border: `1px solid ${colors.borderSubtle}`,
    borderRadius: radii.lg,
    padding: '16px 18px'
  },
  exeHint: { fontSize: 11, color: colors.text3, lineHeight: 1.5 },
  dangerDivider: { height: 1, background: colors.borderSubtle, margin: '32px 0 20px' },
  dangerZone: {
    display: 'flex',
    alignItems: 'center',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    gap: 16,
    border: `1px solid ${colors.dangerBd}`,
    borderRadius: radii.lg,
    padding: '16px 18px'
  },
  dangerZoneText: { flex: '1 1 240px', minWidth: 0 },
  dangerZoneTitle: { fontFamily: fonts.display, fontSize: 13, fontWeight: 600, color: colors.text1, marginBottom: 3 },
  dangerZoneDesc: { fontSize: 12, color: colors.text3, lineHeight: 1.5 },
  dangerZoneBtn: { height: 36, padding: '0 16px', fontSize: 12.5, flexShrink: 0, whiteSpace: 'nowrap' },
  savePathCard: {
    border: `1px solid ${colors.borderSubtle}`,
    borderRadius: radii.lg,
    padding: '16px 18px',
    marginBottom: 20
  },
  savePathCardHighlight: {
    borderColor: colors.warningBd,
    boxShadow: `0 0 0 1px ${colors.warningBd}`
  },
  savePathTopRow: {
    display: 'flex',
    alignItems: 'center',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    gap: 12,
    marginBottom: 10
  },
  savePathLabelRow: { display: 'flex', alignItems: 'center', gap: 8 },
  savePathLabel: {
    fontFamily: fonts.display,
    fontSize: 13,
    fontWeight: 600,
    color: colors.text2,
    textTransform: 'uppercase',
    letterSpacing: '.04em'
  },
  customBadge: {
    fontSize: 10.5,
    fontWeight: 600,
    color: colors.cy,
    background: 'rgba(54,226,232,.1)',
    border: `1px solid ${colors.borderAccent}`,
    borderRadius: radii.pill,
    padding: '2px 8px'
  },
  savePathValue: {
    fontFamily: fonts.mono,
    fontSize: 12.5,
    color: colors.text2,
    background: colors.bgInset,
    border: `1px solid ${colors.borderDefault}`,
    borderRadius: radii.md,
    padding: '10px 12px',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap'
  },
  savePathWarning: { fontSize: 12, color: colors.warning, marginTop: 8 },
  editRow: { display: 'flex', gap: 8 },
  pathInput: {
    flex: 1,
    height: 38,
    padding: '0 12px',
    border: `1px solid ${colors.borderDefault}`,
    borderRadius: radii.md,
    background: colors.bgInset,
    color: colors.text1,
    fontFamily: fonts.mono,
    fontSize: 12.5,
    outline: 'none'
  },
  browseBtn: { height: 38, padding: '0 14px', fontSize: 12.5, whiteSpace: 'nowrap' },
  savePathErrorText: { fontSize: 12, color: colors.danger, marginTop: 8 },
  editActions: { display: 'flex', gap: 8, marginTop: 10 },
  smallBtn: { height: 32, padding: '0 14px', fontSize: 12.5 },
  table: {
    border: `1px solid ${colors.borderSubtle}`,
    borderRadius: radii.lg,
    overflow: 'hidden'
  },
  headerRow: {
    display: 'grid',
    gridTemplateColumns: '1fr 1.3fr .8fr 1fr .9fr',
    padding: '12px 16px',
    background: colors.bgRaised,
    borderBottom: `1px solid ${colors.borderSubtle}`
  },
  headerCell: {
    fontFamily: fonts.mono,
    fontSize: 10.5,
    letterSpacing: '.1em',
    textTransform: 'uppercase',
    color: colors.text3
  },
  row: {
    display: 'grid',
    gridTemplateColumns: '1fr 1.3fr .8fr 1fr .9fr',
    alignItems: 'center',
    padding: '13px 16px',
    transition: `background ${transitions.fast}`
  },
  actionPill: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    height: 24,
    padding: '0 10px',
    fontSize: 11.5,
    fontWeight: 600,
    color: colors.success,
    background: colors.successBg,
    border: `1px solid ${colors.successBd}`,
    borderRadius: radii.pill
  },
  actionDot: { width: 6, height: 6, borderRadius: '50%', background: colors.success, flexShrink: 0 },
  restoreBtn: { height: 30, padding: '0 12px', fontSize: 12, justifySelf: 'end' },
  restoredBadge: { display: 'block', fontSize: 10, color: colors.cy, marginTop: 2 },
  playerCell: { display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, paddingRight: 10 },
  playerName: {
    fontSize: 12.5,
    fontWeight: 600,
    color: colors.text2,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap'
  },
  mono: { fontFamily: fonts.mono, fontSize: 12, color: colors.text3 },
  shimmer: {
    borderRadius: 6,
    background: 'linear-gradient(90deg,#161b27 25%,#222a3a 37%,#161b27 63%)',
    backgroundSize: '460px 100%',
    animation: 'shimmer 1.4s linear infinite'
  },
  empty: {
    border: `1px dashed ${colors.borderDefault}`,
    borderRadius: radii.lg,
    textAlign: 'center',
    padding: '36px 16px'
  },
  emptyIcon: {
    width: 44,
    height: 44,
    margin: '0 auto 12px',
    borderRadius: radii.md,
    background: colors.bgRaised,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center'
  },
  emptyTitle: { fontSize: 13.5, fontWeight: 600, color: colors.text1 },
  emptySubtitle: { fontSize: 12, color: colors.text3, marginTop: 3 }
}

export default GameDetailScreen

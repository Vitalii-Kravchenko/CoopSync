import { useEffect, useRef, useState } from 'react'
import { colors, fonts, radii, shadows } from '../theme'
import { useI18n } from '../i18n'
import type { Translation } from '../i18n'
import { describeError } from '../errors'
import { CheckIcon, CloseIcon, CrownIcon, DiskIcon, UsersIcon } from '../components/icons'
import Avatar from '../components/Avatar'
import Button from '../components/Button'
import ConfirmModal from '../components/ConfirmModal'
import type {
  AuthUser,
  SavesRepoStatus,
  PendingInvite,
  Collaborator,
  SyncHistoryEntry
} from '../../../shared/types'

interface Props {
  user: AuthUser
  avatarDataUrl: string | null
  /** Whether the tab is currently active — App.tsx keeps screens mounted and
   * only toggles display, so data (friend avatars, etc.) needs to be reread
   * every time the tab regains focus, not just on mount. */
  active: boolean
}

/** Per-member activity computed from the push history. */
interface MemberStats {
  /** ISO timestamp of the member's most recent push. */
  lastSyncAt: string
  /** Total number of pushes by this member. */
  total: number
}

// ISO timestamp -> "2 min ago" / "1 hr ago" / "3 days ago" (localized) —
// the same buckets as HistoryScreen, reusing its translation keys.
function formatRelativeTime(iso: string, t: Translation): string {
  const diffMin = Math.floor((Date.now() - new Date(iso).getTime()) / 60000)
  if (diffMin < 1) return t.history.justNow
  if (diffMin < 60) return t.history.minutesAgo(diffMin)
  const diffHours = Math.floor(diffMin / 60)
  if (diffHours < 24) return t.history.hoursAgo(diffHours)
  return t.history.daysAgo(Math.floor(diffHours / 24))
}

// Friends — a separate tab (used to live inside Settings): invite,
// see the group with per-member sync activity, cancel pending invites,
// and a summary strip of the shared storage itself.
function FriendsScreen({ user, avatarDataUrl, active }: Props): React.JSX.Element {
  const { t } = useI18n()
  const [repo, setRepo] = useState<SavesRepoStatus | null>(null)
  const [invites, setInvites] = useState<PendingInvite[]>([])
  const [collaborators, setCollaborators] = useState<Collaborator[]>([])
  const [avatars, setAvatars] = useState<Record<string, string>>({})
  const [history, setHistory] = useState<SyncHistoryEntry[]>([])
  // Games that were actually synced (exist in the cloud) at least once.
  // Deliberately NOT derived from the push history: it's capped at the last
  // 50 entries, so an old game's pushes eventually fall out of it — while
  // remoteVersion > 0 stays true for as long as the game lives in storage.
  const [cloudGamesCount, setCloudGamesCount] = useState(0)
  const [friend, setFriend] = useState('')
  const [busy, setBusy] = useState(false)
  const [inviteError, setInviteError] = useState<string | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [removeTarget, setRemoveTarget] = useState<string | null>(null)
  const [removing, setRemoving] = useState(false)
  const [removeError, setRemoveError] = useState<string | null>(null)
  const [cancelingId, setCancelingId] = useState<number | null>(null)
  const [cancelError, setCancelError] = useState<string | null>(null)

  useEffect(() => {
    void load()
  }, [])

  // On returning to the "Friends" tab, reread everything — the friend might have
  // accepted the invite or updated their avatar in the meantime. Skip the first
  // render (active is already true on mount) — it's covered by the mount effect above.
  const skipFirstActive = useRef(true)
  useEffect(() => {
    if (skipFirstActive.current) {
      skipFirstActive.current = false
      return
    }
    if (active) void load()
  }, [active])

  async function load(): Promise<void> {
    try {
      const r = await window.api.repo.getStatus()
      setRepo(r)
      setLoadError(null)
      if (r.state === 'ready') {
        setInvites(await window.api.repo.listInvitations())
        const collabs = await window.api.repo.listCollaborators()
        setCollaborators(collabs)
        // Push history feeds the per-member stats; sync statuses feed the
        // games counter. Not critical — on failure the cards just show no numbers.
        window.api.sync
          .history()
          .then(setHistory)
          .catch(() => {})
        window.api.sync
          .statuses()
          .then((list) => setCloudGamesCount(list.filter((s) => s.remoteVersion > 0).length))
          .catch(() => {})
        // We fetch friend/member avatars from the shared repo — our own
        // avatar is always fresher locally (avatarDataUrl), so we don't fetch it separately.
        const owner = r.repo.fullName.split('/')[0]
        const logins = [owner, ...collabs.map((c) => c.login)].filter((l) => l !== user.login)
        if (logins.length > 0) {
          window.api.repo
            .getAvatars(logins)
            .then(setAvatars)
            .catch(() => {
              // not critical — placeholders will just stay in place
            })
        }
      }
    } catch (e) {
      // Previously a failure here (e.g. no internet) silently showed "repo not
      // connected", even though the real state was unknown.
      setLoadError(describeError(e, t, t.friends.loadError))
    }
  }

  async function handleInvite(): Promise<void> {
    if (!friend.trim()) return
    setBusy(true)
    setInviteError(null)
    try {
      await window.api.repo.invite(friend)
      setFriend('')
      await load()
    } catch (e) {
      setInviteError(describeError(e, t, t.friends.inviteError))
    } finally {
      setBusy(false)
    }
  }

  async function handleCancelInvite(invite: PendingInvite): Promise<void> {
    setCancelingId(invite.id)
    setCancelError(null)
    try {
      await window.api.repo.cancelInvitation(invite.id, invite.login)
      await load()
    } catch (e) {
      setCancelError(describeError(e, t, t.friends.inviteError))
    } finally {
      setCancelingId(null)
    }
  }

  const noFriendsYet = collaborators.length === 0 && invites.length === 0
  // The repo owner isn't always the logged-in user: in the "join" role it's
  // the friend acting as host. fullName looks like "owner/coopsync-saves".
  const ownerLogin = repo?.state === 'ready' ? repo.repo.fullName.split('/')[0] : user.login
  // Only the owner manages membership (invite/kick) — a 'join' member has
  // push access on GitHub but must not be able to touch the group itself.
  const isOwner = ownerLogin === user.login

  // Per-member activity, derived from the same push history the History tab
  // shows. Capped at the last 50 pushes — "last sync" is always accurate,
  // "total" is effectively "syncs in recent history".
  const statsByLogin: Record<string, MemberStats> = {}
  for (const entry of history) {
    const prev = statsByLogin[entry.updatedBy]
    if (prev) {
      prev.total += 1
      if (entry.updatedAt > prev.lastSyncAt) prev.lastSyncAt = entry.updatedAt
    } else {
      statsByLogin[entry.updatedBy] = { lastSyncAt: entry.updatedAt, total: 1 }
    }
  }

  async function handleRemove(): Promise<void> {
    if (!removeTarget) return
    setRemoving(true)
    setRemoveError(null)
    try {
      await window.api.repo.removeCollaborator(removeTarget)
      setRemoveTarget(null)
      await load()
    } catch (e) {
      setRemoveError(describeError(e, t, t.friends.removeConfirmTitle(removeTarget)))
    } finally {
      setRemoving(false)
    }
  }

  function renderStats(login: string): React.JSX.Element {
    const stats = statsByLogin[login]
    return (
      <div style={styles.statsBlock}>
        <div style={styles.statRow}>
          <span>{t.friends.lastSyncLabel}</span>
          <span style={styles.statValue}>
            {stats ? formatRelativeTime(stats.lastSyncAt, t) : t.friends.neverSynced}
          </span>
        </div>
        <div style={styles.statRow}>
          <span>{t.friends.totalSyncsLabel}</span>
          <span style={styles.statValue}>{stats ? stats.total : t.friends.neverSynced}</span>
        </div>
      </div>
    )
  }

  return (
    <div style={styles.screen}>
      <div style={styles.h1}>{t.friends.title}</div>
      <div style={styles.subtitle}>{t.friends.subtitle}</div>

      {loadError ? (
        <div style={styles.card}>
          <div style={styles.error}>{loadError}</div>
          <Button variant="secondary" style={{ marginTop: 10 }} onClick={() => void load()}>
            {t.main.retry}
          </Button>
        </div>
      ) : repo?.state !== 'ready' ? (
        <div style={styles.card}>
          <div style={styles.muted}>{t.friends.noStorage}</div>
        </div>
      ) : (
        <div style={styles.column}>
          <button
            className="storage-strip"
            style={styles.storageStrip}
            onClick={() => void window.api.openExternal(repo.repo.url)}
            title={t.friends.openOnGithub}
          >
            <span style={styles.storageName}>
              <DiskIcon size={15} color={colors.cy} />
              <span style={styles.storageRepo}>{repo.repo.fullName}</span>
            </span>
            <span style={styles.storageMeta}>
              <span>{t.friends.membersShort(collaborators.length + 1)}</span>
              <span>{t.friends.gamesShort(cloudGamesCount)}</span>
              <span style={{ color: colors.text3 }}>↗</span>
            </span>
          </button>

          {isOwner && (
            <div style={styles.card}>
              <div style={styles.h2}>{t.friends.inviteTitle}</div>
              <div style={styles.row}>
                <input
                  className="input-field"
                  style={{
                    ...styles.input,
                    ...(inviteError
                      ? {
                          borderColor: colors.danger,
                          boxShadow: 'inset 0 1px 2px rgba(0,0,0,.3), 0 0 0 3px rgba(255,107,124,.15)'
                        }
                      : null)
                  }}
                  placeholder={t.settings.friendPlaceholder}
                  value={friend}
                  onChange={(e) => {
                    setFriend(e.target.value)
                    if (inviteError) setInviteError(null)
                  }}
                  disabled={busy}
                  onKeyDown={(e) => e.key === 'Enter' && handleInvite()}
                />
                <Button variant="primary" onClick={handleInvite} disabled={busy || !friend.trim()}>
                  {t.settings.invite}
                </Button>
              </div>
              {busy && <div style={styles.sending}>{t.friends.sending}</div>}
              {inviteError && <div style={styles.error}>{inviteError}</div>}
            </div>
          )}

          {noFriendsYet ? (
            <div style={{ ...styles.card, ...styles.emptyCard }}>
              <div style={styles.emptyIcon}>
                <UsersIcon size={24} color={colors.text3} />
              </div>
              <div style={styles.emptyTitle}>{t.friends.emptyTitle}</div>
              <div style={styles.muted}>{t.friends.emptySubtitle}</div>
            </div>
          ) : (
            <div style={styles.memberGrid}>
              <div style={styles.memberCard}>
                <div style={styles.memberHead}>
                  <Avatar
                    src={ownerLogin === user.login ? avatarDataUrl : avatars[ownerLogin]}
                    size={AVATAR_SIZE}
                  />
                  <div style={{ minWidth: 0 }}>
                    <div style={styles.memberName}>{ownerLogin}</div>
                    <span style={styles.ownerBadge}>
                      <span style={{ display: 'flex', transform: 'translateY(-1px)' }}>
                        <CrownIcon size={11} color={colors.cy} />
                      </span>
                      {t.friends.ownerBadge}
                    </span>
                  </div>
                </div>
                {renderStats(ownerLogin)}
              </div>

              {collaborators.map((c) => (
                <div key={c.login} style={styles.memberCard}>
                  {isOwner && (
                    <button
                      className="icon-btn-plain"
                      style={styles.kickBtn}
                      onClick={() => {
                        setRemoveTarget(c.login)
                        setRemoveError(null)
                      }}
                      title={t.friends.removeMember}
                      aria-label={t.friends.removeMember}
                    >
                      <CloseIcon size={13} />
                    </button>
                  )}
                  <div style={styles.memberHead}>
                    <Avatar
                      src={c.login === user.login ? avatarDataUrl : avatars[c.login]}
                      size={AVATAR_SIZE}
                    />
                    <div style={{ minWidth: 0 }}>
                      <div style={styles.memberName}>{c.login}</div>
                      <span style={styles.acceptedBadge}>
                        <CheckIcon size={11} color={colors.success} />
                        {t.friends.acceptedBadge}
                      </span>
                    </div>
                  </div>
                  {renderStats(c.login)}
                </div>
              ))}

              {invites.map((i) => (
                <div key={i.id} style={styles.pendingCard}>
                  <div style={styles.memberHead}>
                    <Avatar size={AVATAR_SIZE} />
                    <div style={{ minWidth: 0 }}>
                      <div style={styles.memberName}>{i.login}</div>
                      <span style={styles.pendingBadge}>{t.settings.pendingBadge}</span>
                    </div>
                  </div>
                  <div style={styles.statsBlock}>
                    <div style={styles.statRow}>
                      <span>
                        {t.friends.sentLabel} {formatRelativeTime(i.createdAt, t)}
                      </span>
                      {isOwner && (
                        <button
                          className="link-btn-danger"
                          style={styles.cancelBtn}
                          disabled={cancelingId !== null}
                          onClick={() => void handleCancelInvite(i)}
                        >
                          {cancelingId === i.id ? '…' : t.friends.cancelInvite}
                        </button>
                      )}
                    </div>
                    {cancelError && cancelingId === null && (
                      <div style={styles.error}>{cancelError}</div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {removeTarget && (
        <ConfirmModal
          title={t.friends.removeConfirmTitle(removeTarget)}
          description={t.friends.removeConfirmDesc}
          confirmLabel={t.friends.removeMember}
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

// We deliberately do NOT add an online/away dot on avatars: CoopSync has no
// real presence tracking (Collaborator/PendingInvite only carry a
// login), and drawing a made-up dot would mean faking a status. Sync stats
// from the push history are the honest replacement — they show real activity.
const AVATAR_SIZE = 44

const COLUMN_WIDTH = 640

const badgeBase: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  height: 22,
  fontFamily: fonts.display,
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: '.04em',
  padding: '0 9px',
  borderRadius: radii.pill,
  marginTop: 4
}

const cardBase: React.CSSProperties = {
  background: colors.bgSurface,
  border: `1px solid ${colors.borderSubtle}`,
  borderRadius: radii.lg,
  boxShadow: shadows.sheen,
  padding: '20px 24px'
}

const styles: Record<string, React.CSSProperties> = {
  screen: { flex: 1, overflowY: 'auto', padding: '28px 36px 40px' },
  h1: { fontFamily: fonts.display, fontSize: 22, fontWeight: 700, color: colors.text1, marginBottom: 4 },
  subtitle: { fontSize: 13, color: colors.text3, marginBottom: 18 },
  h2: { fontFamily: fonts.display, fontSize: 16, fontWeight: 600, color: colors.text1, marginBottom: 16 },
  column: { display: 'flex', flexDirection: 'column', gap: 14, maxWidth: COLUMN_WIDTH },
  card: { ...cardBase, maxWidth: COLUMN_WIDTH },
  storageStrip: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    background: colors.bgSurface,
    border: `1px solid ${colors.borderSubtle}`,
    borderRadius: radii.md,
    boxShadow: shadows.sheen,
    padding: '10px 14px',
    cursor: 'pointer',
    textAlign: 'left',
    fontFamily: fonts.body,
    width: '100%'
  },
  storageName: { display: 'inline-flex', alignItems: 'center', gap: 8, minWidth: 0 },
  storageRepo: {
    fontFamily: fonts.mono,
    fontSize: 12.5,
    color: colors.text2,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap'
  },
  storageMeta: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 14,
    fontSize: 12,
    color: colors.text3,
    flexShrink: 0
  },
  muted: { fontSize: 13, color: colors.text3 },
  row: { display: 'flex', gap: 10 },
  input: {
    flex: 1,
    height: 42,
    padding: '0 14px',
    border: `1px solid ${colors.borderDefault}`,
    borderRadius: radii.md,
    background: colors.bgInset,
    boxShadow: 'inset 0 1px 2px rgba(0,0,0,.3)',
    color: colors.text1,
    fontFamily: fonts.body,
    fontSize: 14,
    outline: 'none'
  },
  sending: { fontSize: 12, color: colors.text3, marginTop: 10 },
  error: { fontSize: 12.5, color: colors.danger, marginTop: 10 },
  memberGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
    gap: 12
  },
  memberCard: { ...cardBase, padding: 16, position: 'relative' },
  pendingCard: {
    ...cardBase,
    padding: 16,
    border: `1px dashed ${colors.borderStrong}`,
    opacity: 0.9
  },
  memberHead: { display: 'flex', alignItems: 'center', gap: 11 },
  memberName: {
    fontSize: 14,
    fontWeight: 600,
    color: colors.text1,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap'
  },
  kickBtn: { position: 'absolute', top: 10, right: 10 },
  statsBlock: {
    borderTop: `1px solid ${colors.borderSubtle}`,
    marginTop: 12,
    paddingTop: 10,
    display: 'flex',
    flexDirection: 'column',
    gap: 5
  },
  statRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    fontSize: 11.5,
    color: colors.text3
  },
  statValue: { color: colors.text2 },
  cancelBtn: {
    background: 'none',
    border: 'none',
    padding: 0,
    fontFamily: fonts.body,
    fontSize: 11.5,
    color: colors.danger,
    cursor: 'pointer'
  },
  emptyCard: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    textAlign: 'center',
    gap: 6,
    padding: '32px 24px'
  },
  emptyIcon: {
    width: 52,
    height: 52,
    borderRadius: '50%',
    background: colors.bgRaised,
    border: `1px solid ${colors.borderSubtle}`,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4
  },
  emptyTitle: { fontFamily: fonts.display, fontSize: 15, fontWeight: 600, color: colors.text1 },
  ownerBadge: {
    ...badgeBase,
    color: colors.cy,
    background: 'rgba(54,226,232,.10)',
    border: `1px solid ${colors.borderAccent}`
  },
  pendingBadge: {
    ...badgeBase,
    color: colors.warning,
    background: colors.warningBg,
    border: `1px solid ${colors.warningBd}`
  },
  acceptedBadge: {
    ...badgeBase,
    color: colors.success,
    background: colors.successBg,
    border: `1px solid ${colors.successBd}`
  }
}

export default FriendsScreen

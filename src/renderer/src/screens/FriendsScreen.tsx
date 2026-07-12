import { useEffect, useRef, useState } from 'react'
import { colors, fonts, radii, shadows } from '../theme'
import { useI18n } from '../i18n'
import { describeError } from '../errors'
import { CheckIcon, CloseIcon } from '../components/icons'
import Avatar from '../components/Avatar'
import Button from '../components/Button'
import ConfirmModal from '../components/ConfirmModal'
import type { AuthUser, SavesRepoStatus, PendingInvite, Collaborator } from '../../../shared/types'

interface Props {
  user: AuthUser
  avatarDataUrl: string | null
  /** Whether the tab is currently active — App.tsx keeps screens mounted and
   * only toggles display, so data (friend avatars, etc.) needs to be reread
   * every time the tab regains focus, not just on mount. */
  active: boolean
}

// Friends — a separate tab (used to live inside Settings): invite,
// see the list and each person's status (owner / accepted / pending / sending).
function FriendsScreen({ user, avatarDataUrl, active }: Props): React.JSX.Element {
  const { t } = useI18n()
  const [repo, setRepo] = useState<SavesRepoStatus | null>(null)
  const [invites, setInvites] = useState<PendingInvite[]>([])
  const [collaborators, setCollaborators] = useState<Collaborator[]>([])
  const [avatars, setAvatars] = useState<Record<string, string>>({})
  const [friend, setFriend] = useState('')
  const [busy, setBusy] = useState(false)
  const [inviteError, setInviteError] = useState<string | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [removeTarget, setRemoveTarget] = useState<string | null>(null)
  const [removing, setRemoving] = useState(false)
  const [removeError, setRemoveError] = useState<string | null>(null)

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

  const noFriendsYet = collaborators.length === 0 && invites.length === 0
  // The repo owner isn't always the logged-in user: in the "join" role it's
  // the friend acting as host. fullName looks like "owner/coopsync-saves".
  const ownerLogin = repo?.state === 'ready' ? repo.repo.fullName.split('/')[0] : user.login
  // Only the owner manages membership (invite/kick) — a 'join' member has
  // push access on GitHub but must not be able to touch the group itself.
  const isOwner = ownerLogin === user.login

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

  return (
    <div style={styles.screen}>
      <div style={styles.h1}>{t.friends.title}</div>

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
        <>
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

          <div style={styles.card}>
            <div style={styles.h2}>{t.settings.members(collaborators.length + 1)}</div>
            <div style={styles.memberRow}>
              <Avatar
                src={ownerLogin === user.login ? avatarDataUrl : avatars[ownerLogin]}
                size={AVATAR_SIZE}
              />
              <span style={styles.memberName}>{ownerLogin}</span>
              <span style={styles.muted}>{t.settings.owner}</span>
            </div>
            {collaborators.map((c) => (
              <div key={c.login} style={styles.memberRow}>
                <Avatar
                  src={c.login === user.login ? avatarDataUrl : avatars[c.login]}
                  size={AVATAR_SIZE}
                />
                <span style={{ ...styles.memberName, flex: 1 }}>{c.login}</span>
                <span style={styles.acceptedBadge}>
                  <CheckIcon size={11} color={colors.success} />
                  {t.friends.acceptedBadge}
                </span>
                {isOwner && (
                  <button
                    className="icon-btn-plain"
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
              </div>
            ))}
            {invites.length > 0 && (
              <>
                <div style={{ ...styles.muted, marginTop: 12, marginBottom: 8 }}>{t.settings.pendingConfirmation}</div>
                {invites.map((i) => (
                  <div key={i.login} style={styles.memberRow}>
                    <Avatar size={AVATAR_SIZE} />
                    <span style={{ ...styles.memberName, flex: 1 }}>{i.login}</span>
                    <span style={styles.pendingBadge}>{t.settings.pendingBadge}</span>
                  </div>
                ))}
              </>
            )}
            {noFriendsYet && <div style={styles.muted}>{t.friends.emptyFriends}</div>}
          </div>
        </>
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
// login), and drawing a made-up dot would mean faking a status.
const AVATAR_SIZE = 36

const styles: Record<string, React.CSSProperties> = {
  screen: { flex: 1, overflowY: 'auto', padding: '28px 36px 40px' },
  h1: { fontFamily: fonts.display, fontSize: 22, fontWeight: 700, color: colors.text1, marginBottom: 18 },
  h2: { fontFamily: fonts.display, fontSize: 16, fontWeight: 600, color: colors.text1, marginBottom: 16 },
  card: {
    background: colors.bgSurface,
    border: `1px solid ${colors.borderSubtle}`,
    borderRadius: radii.lg,
    boxShadow: shadows.sheen,
    padding: '20px 24px',
    marginBottom: 22,
    maxWidth: 460
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
  memberRow: { display: 'flex', alignItems: 'center', gap: 11, marginBottom: 12 },
  memberName: { fontSize: 14, color: colors.text1 },
  pendingBadge: {
    display: 'inline-flex',
    alignItems: 'center',
    height: 26,
    fontFamily: fonts.display,
    fontSize: 11.5,
    fontWeight: 600,
    letterSpacing: '.04em',
    color: colors.warning,
    background: colors.warningBg,
    border: `1px solid ${colors.warningBd}`,
    padding: '0 11px',
    borderRadius: radii.pill
  },
  acceptedBadge: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 7,
    height: 26,
    fontFamily: fonts.display,
    fontSize: 11.5,
    fontWeight: 600,
    letterSpacing: '.04em',
    color: colors.success,
    background: colors.successBg,
    border: `1px solid ${colors.successBd}`,
    padding: '0 11px',
    borderRadius: radii.pill
  }
}

export default FriendsScreen

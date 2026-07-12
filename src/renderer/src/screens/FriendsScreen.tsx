import { useEffect, useRef, useState } from 'react'
import { colors, fonts, radii, shadows } from '../theme'
import { useI18n } from '../i18n'
import { describeError } from '../errors'
import { GitHubIcon, CheckIcon } from '../components/icons'
import Button from '../components/Button'
import type { AuthUser, SavesRepoStatus, PendingInvite, Collaborator } from '../../../shared/types'

interface Props {
  user: AuthUser
  avatarDataUrl: string | null
  /** Чи вкладка зараз активна — App.tsx лишає екрани змонтованими й лише
   * перемикає display, тож дані (аватарки друга тощо) треба перечитувати
   * при кожному поверненні на вкладку, а не лише на самому монтуванні. */
  active: boolean
}

// Друзі — окрема вкладка (раніше жила всередині Налаштувань): запросити,
// побачити список і статус кожного (власник / прийняв / очікує / надсилаю).
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

  useEffect(() => {
    void load()
  }, [])

  // При поверненні на вкладку "Друзі" перечитуємо все — друг міг за цей час
  // прийняти запрошення чи оновити свою аватарку. Перший рендер (active вже
  // true на монтуванні) пропускаємо — його покриває ефект монтування вище.
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
        // Аватарки друга/учасників беремо зі спільного сховища — своя
        // завжди свіжіша локально (avatarDataUrl), тож її окремо не тягнемо.
        const owner = r.repo.fullName.split('/')[0]
        const logins = [owner, ...collabs.map((c) => c.login)].filter((l) => l !== user.login)
        if (logins.length > 0) {
          window.api.repo
            .getAvatars(logins)
            .then(setAvatars)
            .catch(() => {
              // не критично — просто лишаться заглушки
            })
        }
      }
    } catch (e) {
      // Раніше збій тут (напр. нема інтернету) тихо показував "сховище не
      // підключено", хоча реальний стан невідомий.
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
  // Власник сховища — не завжди залогінений користувач: у ролі "join" це
  // друг-хост. fullName має вигляд "owner/coopsync-saves".
  const ownerLogin = repo?.state === 'ready' ? repo.repo.fullName.split('/')[0] : user.login

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
          <div style={styles.card}>
            <div style={styles.h2}>{t.friends.inviteTitle}</div>
            <div style={styles.row}>
              <input
                className="input-field"
                style={styles.input}
                placeholder={t.settings.friendPlaceholder}
                value={friend}
                onChange={(e) => setFriend(e.target.value)}
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

          <div style={styles.card}>
            <div style={styles.h2}>{t.settings.members(collaborators.length + 1)}</div>
            <div style={styles.memberRow}>
              <div style={styles.memberAvatar}>
                {ownerLogin === user.login && avatarDataUrl ? (
                  <img src={avatarDataUrl} alt="" style={styles.memberAvatarImg} />
                ) : avatars[ownerLogin] ? (
                  <img src={avatars[ownerLogin]} alt="" style={styles.memberAvatarImg} />
                ) : (
                  <GitHubIcon size={16} />
                )}
              </div>
              <span style={styles.memberName}>{ownerLogin}</span>
              <span style={styles.muted}>{t.settings.owner}</span>
            </div>
            {collaborators.map((c) => (
              <div key={c.login} style={styles.memberRow}>
                <div style={styles.memberAvatar}>
                  {c.login === user.login && avatarDataUrl ? (
                    <img src={avatarDataUrl} alt="" style={styles.memberAvatarImg} />
                  ) : avatars[c.login] ? (
                    <img src={avatars[c.login]} alt="" style={styles.memberAvatarImg} />
                  ) : (
                    <GitHubIcon size={16} />
                  )}
                </div>
                <span style={{ ...styles.memberName, flex: 1 }}>{c.login}</span>
                <span style={styles.acceptedBadge}>
                  <CheckIcon size={11} color={colors.success} />
                  {t.friends.acceptedBadge}
                </span>
              </div>
            ))}
            {invites.length > 0 && (
              <>
                <div style={{ ...styles.muted, marginTop: 12, marginBottom: 8 }}>{t.settings.pendingConfirmation}</div>
                {invites.map((i) => (
                  <div key={i.login} style={styles.memberRow}>
                    <div style={styles.memberAvatar}>
                      <GitHubIcon size={16} />
                    </div>
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
    </div>
  )
}

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
    height: 40,
    padding: '0 14px',
    border: `1px solid ${colors.borderDefault}`,
    borderRadius: radii.md,
    background: colors.bgInset,
    boxShadow: 'inset 0 1px 2px rgba(0,0,0,.3)',
    color: colors.text1,
    fontFamily: fonts.body,
    fontSize: 13,
    outline: 'none'
  },
  sending: { fontSize: 12, color: colors.text3, marginTop: 10 },
  error: { fontSize: 12.5, color: colors.danger, marginTop: 10 },
  memberRow: { display: 'flex', alignItems: 'center', gap: 11, marginBottom: 12 },
  memberAvatar: {
    width: 30,
    height: 30,
    borderRadius: '50%',
    background: colors.bgInset,
    border: `1px solid ${colors.borderDefault}`,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 13,
    overflow: 'hidden'
  },
  memberAvatarImg: { width: '100%', height: '100%', objectFit: 'cover' },
  memberName: { fontSize: 14, color: colors.text1 },
  pendingBadge: {
    fontFamily: fonts.display,
    fontSize: 10.5,
    fontWeight: 600,
    color: colors.warning,
    background: colors.warningBg,
    border: `1px solid ${colors.warningBd}`,
    padding: '3px 10px',
    borderRadius: radii.pill
  },
  acceptedBadge: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 5,
    fontFamily: fonts.display,
    fontSize: 10.5,
    fontWeight: 600,
    color: colors.success,
    background: colors.successBg,
    border: `1px solid ${colors.successBd}`,
    padding: '3px 10px',
    borderRadius: radii.pill
  }
}

export default FriendsScreen

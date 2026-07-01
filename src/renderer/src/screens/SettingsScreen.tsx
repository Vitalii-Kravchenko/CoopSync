import { useEffect, useState } from 'react'
import { colors, fonts, gradients, radii, shadows } from '../theme'
import { LANGUAGES, useI18n, type LanguageCode } from '../i18n'
import { GitHubIcon, Logo } from '../components/icons'
import Button from '../components/Button'
import type {
  AuthUser,
  SavesRepoStatus,
  PendingInvite,
  Collaborator,
  StartupSettings
} from '../../../shared/types'

interface Props {
  user: AuthUser
  onLoggedOut: () => void
  /** Кастомний аватар (data URL) — спільний з titlebar і онбордингом. */
  avatarDataUrl: string | null
  onAvatarChange: (dataUrl: string) => void
}

function SettingsScreen({ user, onLoggedOut, avatarDataUrl, onAvatarChange }: Props): React.JSX.Element {
  const { t, language, setLanguage } = useI18n()
  const [repo, setRepo] = useState<SavesRepoStatus | null>(null)
  const [invites, setInvites] = useState<PendingInvite[]>([])
  const [collaborators, setCollaborators] = useState<Collaborator[]>([])
  const [friend, setFriend] = useState('')
  const [busy, setBusy] = useState(false)
  const [startup, setStartup] = useState<StartupSettings>({
    openAtLogin: false,
    startMinimized: false
  })
  const [avatarError, setAvatarError] = useState<string | null>(null)

  useEffect(() => {
    void loadRepo()
    window.api.settings.getStartup().then(setStartup)
  }, [])

  async function handleStartup(patch: Partial<StartupSettings>): Promise<void> {
    setStartup(await window.api.settings.setStartup(patch))
  }

  async function handlePickAvatar(): Promise<void> {
    setAvatarError(null)
    try {
      const dataUrl = await window.api.settings.pickAvatar()
      if (dataUrl) onAvatarChange(dataUrl)
    } catch (e) {
      setAvatarError(e instanceof Error ? e.message : t.settings.avatarError)
    }
  }

  async function loadRepo(): Promise<void> {
    const r = await window.api.repo.getStatus()
    setRepo(r)
    if (r.state === 'ready') {
      setInvites(await window.api.repo.listInvitations())
      setCollaborators(await window.api.repo.listCollaborators())
    }
  }

  async function handleInvite(): Promise<void> {
    if (!friend.trim()) return
    setBusy(true)
    try {
      await window.api.repo.invite(friend)
      setFriend('')
      await loadRepo()
    } finally {
      setBusy(false)
    }
  }

  async function handleLogout(): Promise<void> {
    await window.api.auth.logout()
    onLoggedOut()
  }

  return (
    <div style={styles.screen}>
      <div style={styles.h1}>{t.settings.title}</div>

      {/* Профіль */}
      <div style={styles.card}>
        <div style={styles.profileLeft}>
          <div style={styles.avatar}>
            {avatarDataUrl ? (
              <img src={avatarDataUrl} alt="" style={styles.avatarImg} />
            ) : (
              <GitHubIcon size={40} />
            )}
          </div>
          <Button
            variant="ghost"
            style={{ height: 30, padding: '0 12px', fontSize: 12 }}
            onClick={handlePickAvatar}
          >
            {t.settings.changeAvatar}
          </Button>
          {avatarError && <div style={styles.avatarError}>{avatarError}</div>}
        </div>
        <div style={{ flex: 1 }}>
          <div style={styles.userName}>{user.login}</div>
          <div style={styles.muted}>{t.settings.githubUser}</div>
        </div>
        <Button variant="danger" onClick={handleLogout}>
          <GitHubIcon size={14} color={colors.danger} /> {t.settings.logout}
        </Button>
      </div>

      <div style={styles.cols}>
        {/* Сховище */}
        <div style={styles.card2}>
          <div style={styles.h2}>{t.settings.storage}</div>
          {repo?.state === 'ready' ? (
            <>
              <div style={styles.repoRow}>
                <div style={styles.repoIcon}>🔒</div>
                <div>
                  <div style={styles.repoName}>{repo.repo.fullName}</div>
                  <div style={styles.muted}>{t.settings.privateRepo}</div>
                </div>
              </div>
              <button
                style={styles.linkBtn}
                onClick={() => window.api.openExternal(repo.repo.url)}
              >
                {repo.repo.url} ⧉
              </button>
              <div style={{ ...styles.muted, marginTop: 14, marginBottom: 8 }}>{t.settings.inviteMoreFriend}</div>
              <div style={styles.row}>
                <input
                  className="input-field"
                  style={styles.input}
                  placeholder={t.settings.friendPlaceholder}
                  value={friend}
                  onChange={(e) => setFriend(e.target.value)}
                  disabled={busy}
                />
                <Button variant="primary" onClick={handleInvite} disabled={busy || !friend.trim()}>
                  {t.settings.invite}
                </Button>
              </div>
            </>
          ) : (
            <div style={styles.muted}>{t.settings.storageNotSet}</div>
          )}
        </div>

        {/* Учасники */}
        <div style={styles.card2}>
          <div style={styles.h2}>{t.settings.members(collaborators.length + 1)}</div>
          <div style={styles.memberRow}>
            <div style={styles.memberAvatar}>
              {avatarDataUrl ? <img src={avatarDataUrl} alt="" style={styles.memberAvatarImg} /> : <GitHubIcon size={16} />}
            </div>
            <span style={styles.memberName}>{user.login}</span>
            <span style={styles.muted}>{t.settings.owner}</span>
          </div>
          {collaborators.map((c) => (
            <div key={c.login} style={styles.memberRow}>
              <div style={styles.memberAvatar}>👤</div>
              <span style={styles.memberName}>{c.login}</span>
            </div>
          ))}
          {invites.length > 0 && (
            <>
              <div style={{ ...styles.muted, marginTop: 12, marginBottom: 8 }}>{t.settings.pendingConfirmation}</div>
              {invites.map((i) => (
                <div key={i.login} style={styles.memberRow}>
                  <div style={styles.memberAvatar}>👤</div>
                  <span style={{ ...styles.memberName, flex: 1 }}>{i.login}</span>
                  <span style={styles.badge}>{t.settings.pendingBadge}</span>
                </div>
              ))}
            </>
          )}
        </div>
      </div>

      <div style={styles.cols}>
        {/* Загальне */}
        <div style={styles.card2}>
          <div style={styles.h2}>{t.settings.general}</div>
          <div style={styles.langRow}>
            <span style={{ fontSize: 14, color: colors.text1 }}>{t.settings.language}</span>
            <select
              style={styles.langSelect}
              value={language}
              onChange={(e) => setLanguage(e.target.value as LanguageCode)}
            >
              {LANGUAGES.map((l) => (
                <option key={l.code} value={l.code}>
                  {l.flag} {l.label}
                </option>
              ))}
            </select>
          </div>
          <div style={styles.divider} />
          <Toggle
            label={t.settings.autostart}
            value={startup.openAtLogin}
            onChange={(v) => handleStartup({ openAtLogin: v })}
          />
          <div style={styles.divider} />
          <Toggle
            label={t.settings.startMinimized}
            value={startup.startMinimized}
            onChange={(v) => handleStartup({ startMinimized: v })}
          />
        </div>

        {/* Про програму */}
        <div style={styles.card2}>
          <div style={styles.h2}>{t.settings.about}</div>
          <div style={styles.aboutRow}>
            <Logo size={42} />
            <div>
              <div style={styles.repoName}>CoopSync</div>
              <div style={styles.muted}>{t.settings.version('0.1.0')}</div>
            </div>
          </div>
          <div style={{ ...styles.muted, lineHeight: 1.5, margin: '4px 0 14px' }}>
            {t.settings.aboutDescription}
          </div>
          <button
            style={styles.linkBtn}
            onClick={() => window.api.openExternal('https://github.com/Vitalii-Kravchenko/CoopSync')}
          >
            {t.settings.githubRepoLink}
          </button>
        </div>
      </div>
    </div>
  )
}

function Toggle({
  label,
  value,
  onChange
}: {
  label: string
  value: boolean
  onChange: (v: boolean) => void
}): React.JSX.Element {
  return (
    <div style={styles.toggleRow}>
      <span style={{ fontSize: 14, color: colors.text1 }}>{label}</span>
      <div
        onClick={() => onChange(!value)}
        style={{
          width: 44,
          height: 25,
          borderRadius: radii.pill,
          background: value ? gradients.energy : colors.bgRaised,
          // Завжди 1px рамки (прозора при "увімкнено") — щоб внутрішня висота
          // не змінювалась між станами і кружечок лишався по центру.
          border: value ? '1px solid transparent' : `1px solid ${colors.borderDefault}`,
          boxShadow: value ? shadows.glowCy : 'none',
          position: 'relative',
          cursor: 'pointer',
          transition: 'background .15s, box-shadow .15s',
          flexShrink: 0
        }}
      >
        <div
          style={{
            position: 'absolute',
            top: 2,
            left: value ? 21 : 2,
            width: 19,
            height: 19,
            borderRadius: '50%',
            background: value ? '#fff' : colors.text3,
            boxShadow: shadows.sh1,
            transition: 'left .15s'
          }}
        />
      </div>
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
    display: 'flex',
    alignItems: 'center',
    gap: 22,
    marginBottom: 22
  },
  cols: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 22, marginBottom: 22 },
  card2: {
    background: colors.bgSurface,
    border: `1px solid ${colors.borderSubtle}`,
    borderRadius: radii.lg,
    boxShadow: shadows.sheen,
    padding: '20px 24px'
  },
  profileLeft: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 },
  avatar: {
    width: 72,
    height: 72,
    borderRadius: '50%',
    background: colors.bgInset,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    border: `1px solid ${colors.borderDefault}`,
    overflow: 'hidden'
  },
  avatarImg: { width: '100%', height: '100%', objectFit: 'cover' },
  avatarError: { fontSize: 11, color: colors.danger, maxWidth: 100, textAlign: 'center' },
  userName: { fontFamily: fonts.display, fontSize: 20, fontWeight: 700, color: colors.text1 },
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
  repoRow: { display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 },
  repoIcon: {
    width: 36,
    height: 36,
    borderRadius: radii.md,
    background: colors.bgInset,
    border: `1px solid ${colors.borderDefault}`,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 16
  },
  repoName: { fontFamily: fonts.display, fontSize: 15, fontWeight: 600, color: colors.text1 },
  linkBtn: {
    display: 'block',
    width: '100%',
    textAlign: 'left',
    fontSize: 12.5,
    color: colors.cy,
    background: colors.bgInset,
    border: `1px solid ${colors.borderDefault}`,
    borderRadius: radii.md,
    padding: '10px 12px',
    cursor: 'pointer',
    fontFamily: fonts.mono,
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis'
  },
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
  badge: {
    fontFamily: fonts.display,
    fontSize: 10.5,
    fontWeight: 600,
    color: colors.warning,
    background: colors.warningBg,
    border: `1px solid ${colors.warningBd}`,
    padding: '3px 10px',
    borderRadius: radii.pill
  },
  toggleRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '8px 0'
  },
  langRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '8px 0'
  },
  langSelect: {
    height: 36,
    padding: '0 12px',
    borderRadius: radii.md,
    border: `1px solid ${colors.borderDefault}`,
    background: colors.bgInset,
    color: colors.text1,
    fontFamily: fonts.body,
    fontSize: 13,
    cursor: 'pointer',
    outline: 'none'
  },
  divider: { height: 1, background: colors.borderSubtle, margin: '6px 0' },
  aboutRow: { display: 'flex', alignItems: 'center', gap: 13, marginBottom: 14 }
}

export default SettingsScreen

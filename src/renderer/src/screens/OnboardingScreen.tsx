import { useEffect, useState } from 'react'
import { colors, fonts, gradients, radii, shadows, transitions } from '../theme'
import { useI18n } from '../i18n'
import { describeError } from '../errors'
import { GitHubIcon, CheckIcon, CrownIcon, UsersIcon } from '../components/icons'
import Avatar from '../components/Avatar'
import Button from '../components/Button'
import type {
  AuthStatus,
  DeviceCodeInfo,
  SavesRepoStatus,
  PendingInvite,
  Collaborator,
  UserRole
} from '../../../shared/types'

interface Props {
  /** Called when everything is set up and we can move on to games. */
  onComplete: () => void
  /** Custom avatar (data URL) — shared with titlebar and Settings. */
  avatarDataUrl?: string | null
}

function OnboardingScreen({ onComplete, avatarDataUrl }: Props): React.JSX.Element {
  const { t } = useI18n()
  const [auth, setAuth] = useState<AuthStatus | null>(null)
  const [role, setRole] = useState<UserRole | null>(null)
  const [repo, setRepo] = useState<SavesRepoStatus | null>(null)
  const [deviceCode, setDeviceCode] = useState<DeviceCodeInfo | null>(null)
  const [invites, setInvites] = useState<PendingInvite[]>([])
  const [collaborators, setCollaborators] = useState<Collaborator[]>([])
  const [friend, setFriend] = useState('')
  const [hostLogin, setHostLogin] = useState('')
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    window.api.auth
      .getStatus()
      .then(async (a) => {
        setAuth(a)
        if (a.state === 'logged-in') {
          const cfg = await window.api.role.get()
          if (cfg) {
            setRole(cfg.role)
            if (cfg.role === 'host') await loadRepo()
          }
        }
      })
      .catch((e) => {
        // Previously a failure here (e.g. no internet) was silently lost — step 3
        // quietly showed "Create repo", even though the real state was unknown.
        setError(describeError(e, t, t.onboarding.genericError))
      })
    return window.api.auth.onDeviceCode(setDeviceCode)
  }, [])

  async function loadRepo(): Promise<void> {
    const r = await window.api.repo.getStatus()
    setRepo(r)
    if (r.state === 'ready') {
      setInvites(await window.api.repo.listInvitations())
      setCollaborators(await window.api.repo.listCollaborators())
    }
  }

  async function handleLogin(): Promise<void> {
    setBusy(true)
    setError(null)
    setCopied(false)
    try {
      const result = await window.api.auth.login()
      setAuth(result)
    } catch (e) {
      setError(describeError(e, t, t.onboarding.loginError))
    } finally {
      setBusy(false)
      setDeviceCode(null)
    }
  }

  async function handleSetHost(): Promise<void> {
    setBusy(true)
    setError(null)
    try {
      await window.api.role.setHost()
      setRole('host')
      await loadRepo()
    } catch (e) {
      setError(describeError(e, t, t.onboarding.genericError))
    } finally {
      setBusy(false)
    }
  }

  async function handleJoin(): Promise<void> {
    if (!hostLogin.trim()) return
    setBusy(true)
    setError(null)
    try {
      await window.api.role.join(hostLogin)
      onComplete()
    } catch (e) {
      setError(describeError(e, t, t.onboarding.joinError))
    } finally {
      setBusy(false)
    }
  }

  async function handleCreateRepo(): Promise<void> {
    setBusy(true)
    setError(null)
    try {
      await window.api.repo.create()
      await loadRepo()
    } catch (e) {
      setError(describeError(e, t, t.onboarding.createRepoError))
    } finally {
      setBusy(false)
    }
  }

  async function handleInvite(): Promise<void> {
    if (!friend.trim()) return
    setBusy(true)
    setError(null)
    try {
      await window.api.repo.invite(friend)
      setFriend('')
      await loadRepo()
    } catch (e) {
      setError(describeError(e, t, t.onboarding.inviteError))
    } finally {
      setBusy(false)
    }
  }

  const loggedIn = auth?.state === 'logged-in'
  const repoReady = repo?.state === 'ready'
  const hostReady = loggedIn && role === 'host' && repoReady

  return (
    <div style={styles.screen}>
      <div style={styles.head}>
        <div style={styles.title}>{t.onboarding.welcomeTitle}</div>
        <div style={styles.subtitle}>{t.onboarding.welcomeSubtitle}</div>
      </div>

      {/* STEP 1 — login */}
      <Step n={1} done={loggedIn} title={t.onboarding.step1Title}>
        {!loggedIn && !deviceCode && (
          <Button variant="ghost" style={{ alignSelf: 'flex-start' }} onClick={handleLogin} disabled={busy}>
            <GitHubIcon size={17} color={colors.text1} /> {t.onboarding.loginButton}
          </Button>
        )}
        {!loggedIn && deviceCode && (
          <div style={styles.device}>
            <div style={styles.deviceCode}>{deviceCode.userCode}</div>
            <div style={styles.row}>
              <Button
                variant="success"
                onClick={async () => {
                  await window.api.copyToClipboard(deviceCode.userCode)
                  setCopied(true)
                }}
              >
                {copied ? `✓ ${t.onboarding.copied}` : t.onboarding.copy}
              </Button>
              <Button variant="primary" onClick={() => window.api.openExternal(deviceCode.verificationUri)}>
                {t.onboarding.openGithub}
              </Button>
            </div>
            <div style={styles.muted}>{t.onboarding.pasteCodeHint}</div>
          </div>
        )}
        {loggedIn && (
          <div style={styles.okRow}>
            <Avatar src={avatarDataUrl} size={30} />
            <span style={styles.okName}>{auth.user.login}</span>
          </div>
        )}
      </Step>

      {/* STEP 2 — role selection */}
      <Step n={2} done={role !== null} title={t.onboarding.step2Title} disabled={!loggedIn} last={role === 'join'}>
        {role === null && (
          <div style={styles.roleRow}>
            <RoleCard
              icon={<CrownIcon size={18} color={colors.cy} />}
              title={t.onboarding.hostTitle}
              desc={t.onboarding.hostDesc}
              onClick={handleSetHost}
              disabled={busy}
            />
            <RoleCard
              icon={<UsersIcon size={18} color={colors.cy} />}
              title={t.onboarding.joinTitle}
              desc={t.onboarding.joinDesc}
              onClick={() => setRole('join')}
              disabled={busy}
            />
          </div>
        )}
        {role === 'host' && (
          <div style={styles.okRow}>
            <CrownIcon size={16} color={colors.success} />
            <span style={styles.okName}>{t.onboarding.youAreHost}</span>
            <Button variant="ghost" style={styles.smallGhost} onClick={() => setRole(null)}>
              {t.onboarding.change}
            </Button>
          </div>
        )}
        {role === 'join' && (
          <div style={styles.joinBox}>
            <div style={styles.row}>
              <input
                className="input-field"
                style={styles.input}
                placeholder={t.onboarding.hostLoginPlaceholder}
                value={hostLogin}
                onChange={(e) => setHostLogin(e.target.value)}
                disabled={busy}
              />
              <Button variant="primary" onClick={handleJoin} disabled={busy || !hostLogin.trim()}>
                {busy ? t.onboarding.checking : t.onboarding.connect}
              </Button>
            </div>
            <Button
              variant="ghost"
              style={{ ...styles.smallGhost, alignSelf: 'flex-start' }}
              onClick={() => setRole(null)}
            >
              {t.onboarding.chooseOtherRole}
            </Button>
          </div>
        )}
      </Step>

      {/* STEP 3 (host only) — repo + friend */}
      {role === 'host' && (
        <>
          <Step n={3} done={repoReady} title={t.onboarding.step3Title}>
            {!repoReady ? (
              <Button variant="primary" style={{ alignSelf: 'flex-start' }} onClick={handleCreateRepo} disabled={busy}>
                {busy ? t.onboarding.creating : t.onboarding.createRepo}
              </Button>
            ) : (
              <div style={styles.okRow}>
                <span style={{ color: colors.success }}>✓</span>
                <span style={styles.okName}>{repo.repo.fullName}</span>
                <span style={{ fontSize: 13 }}>🔒</span>
              </div>
            )}
          </Step>

          <Step n={4} done={collaborators.length > 0} title={t.onboarding.step4Title} disabled={!repoReady} last>
            <div style={styles.row}>
              <input
                className="input-field"
                style={styles.input}
                placeholder={t.onboarding.friendPlaceholder}
                value={friend}
                onChange={(e) => setFriend(e.target.value)}
                disabled={busy || !repoReady}
              />
              <Button variant="primary" onClick={handleInvite} disabled={busy || !friend.trim()}>
                {t.onboarding.invite}
              </Button>
            </div>
            {collaborators.length > 0 && (
              <div style={styles.members}>
                {collaborators.map((c) => (
                  <span key={c.login} style={styles.memberOk}>
                    👤 {c.login}
                  </span>
                ))}
              </div>
            )}
            {invites.length > 0 && (
              <div style={styles.members}>
                {invites.map((i) => (
                  <span key={i.login} style={styles.memberPending}>
                    ⏳ {i.login} {t.onboarding.pending}
                  </span>
                ))}
              </div>
            )}
          </Step>
        </>
      )}

      {error && <div style={styles.error}>⚠ {error}</div>}

      {/* "Go to games" button — host only (join moves on right after connecting) */}
      {role === 'host' && (
        <div style={styles.footer}>
          <div style={styles.muted}>
            {hostReady ? `✓ ${t.onboarding.allReady}` : t.onboarding.finishStepsAbove}
          </div>
          <Button
            variant="primary"
            style={{ height: 46, padding: '0 26px', fontSize: 15 }}
            onClick={onComplete}
            disabled={!hostReady}
          >
            {t.onboarding.goToGames}
          </Button>
        </div>
      )}
    </div>
  )
}

// Clickable role selection card — hover is driven by JS state (not CSS :hover),
// since border/box-shadow are already set inline and would override any CSS rule
// (the same pitfall as with the Sidebar/GameCard items — see the comments there).
function RoleCard({
  icon,
  title,
  desc,
  onClick,
  disabled
}: {
  icon: React.ReactNode
  title: string
  desc: string
  onClick: () => void
  disabled?: boolean
}): React.JSX.Element {
  const [hover, setHover] = useState(false)
  return (
    <button
      className="reset-btn"
      style={{
        ...styles.roleCard,
        borderColor: hover ? colors.borderAccent : colors.borderSubtle,
        boxShadow: hover ? `${shadows.sh3}, ${shadows.glowCy}` : shadows.sheen,
        transform: hover ? 'translateY(-2px)' : 'none'
      }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onClick={onClick}
      disabled={disabled}
    >
      <div style={styles.roleIconBox}>{icon}</div>
      <div style={styles.roleTitle}>{title}</div>
      <div style={styles.roleDesc}>{desc}</div>
    </button>
  )
}

function Step({
  n,
  title,
  done,
  disabled,
  last,
  children
}: {
  n: number
  title: string
  done: boolean
  disabled?: boolean
  last?: boolean
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '28px 1fr', gap: 16, opacity: disabled ? 0.5 : 1 }}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        <div
          style={{
            width: 28,
            height: 28,
            borderRadius: '50%',
            background: done ? colors.success : gradients.energy,
            color: colors.textOnAccent,
            fontFamily: fonts.display,
            fontWeight: 700,
            fontSize: 13,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: done ? `0 0 12px ${colors.success}` : shadows.glowCy
          }}
        >
          {done ? <CheckIcon size={14} /> : n}
        </div>
        {!last && <div style={{ width: 2, flex: 1, background: colors.borderSubtle, marginTop: 6 }} />}
      </div>
      <div style={styles.stepBody}>
        <div style={styles.stepTitle}>{title}</div>
        {children}
      </div>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  screen: { padding: '26px 34px', maxWidth: 760, margin: '0 auto', width: '100%' },
  head: { textAlign: 'center', marginBottom: 24 },
  title: { fontFamily: fonts.display, fontSize: 26, fontWeight: 700, color: colors.text1 },
  subtitle: { fontSize: 14, color: colors.text3, marginTop: 6 },
  stepBody: {
    border: `1px solid ${colors.borderSubtle}`,
    borderRadius: radii.lg,
    background: colors.bgSurface,
    boxShadow: shadows.sheen,
    padding: '14px 18px 16px',
    marginBottom: 14,
    display: 'flex',
    flexDirection: 'column',
    gap: 10
  },
  stepTitle: { fontFamily: fonts.display, fontSize: 14.5, fontWeight: 600, color: colors.text1 },
  row: { display: 'flex', gap: 10 },
  roleRow: { display: 'flex', gap: 12 },
  roleCard: {
    flex: 1,
    textAlign: 'left',
    padding: '16px',
    border: `1px solid ${colors.borderSubtle}`,
    borderRadius: radii.lg,
    background: colors.bgRaised,
    boxShadow: shadows.sheen,
    color: colors.text1,
    cursor: 'pointer',
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
    transition: `transform ${transitions.hover}, box-shadow ${transitions.hover}, border-color ${transitions.hover}`
  },
  roleIconBox: {
    width: 36,
    height: 36,
    borderRadius: radii.md,
    background: gradients.energySoft,
    border: `1px solid ${colors.borderAccent}`,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center'
  },
  roleTitle: { fontFamily: fonts.display, fontSize: 14.5, fontWeight: 700 },
  roleDesc: { fontSize: 12.5, color: colors.text3 },
  joinBox: { display: 'flex', flexDirection: 'column', gap: 8 },
  smallGhost: { height: 30, padding: '0 14px', fontSize: 12 },
  device: { display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'flex-start' },
  deviceCode: {
    fontFamily: fonts.mono,
    fontSize: 26,
    fontWeight: 700,
    letterSpacing: 4,
    background: colors.bgInset,
    border: `1px solid ${colors.borderAccent}`,
    boxShadow: 'inset 0 1px 2px rgba(0,0,0,.3), 0 0 18px rgba(54,226,232,.18)',
    padding: '8px 18px',
    borderRadius: radii.md,
    color: colors.cy
  },
  okRow: { display: 'flex', alignItems: 'center', gap: 9 },
  okName: { fontSize: 14, fontWeight: 600, color: colors.text1 },
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
  members: { display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 4 },
  memberOk: { fontSize: 13, color: colors.success },
  memberPending: { fontSize: 13, color: colors.text3 },
  muted: { fontSize: 13, color: colors.text3 },
  error: { color: colors.danger, fontSize: 13, marginTop: 8, marginLeft: 44 },
  footer: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 18,
    paddingTop: 18,
    borderTop: `1px solid ${colors.borderSubtle}`
  }
}

export default OnboardingScreen

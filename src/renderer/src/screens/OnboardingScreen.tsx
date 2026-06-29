import { useEffect, useState } from 'react'
import { colors } from '../theme'
import { GitHubIcon } from '../components/icons'
import Button from '../components/Button'
import type {
  AuthStatus,
  DeviceCodeInfo,
  SavesRepoStatus,
  PendingInvite,
  Collaborator
} from '../../../shared/types'

interface Props {
  /** Викликається, коли все налаштовано і користувач тисне "Перейти до ігор". */
  onComplete: () => void
}

function OnboardingScreen({ onComplete }: Props): React.JSX.Element {
  const [auth, setAuth] = useState<AuthStatus | null>(null)
  const [repo, setRepo] = useState<SavesRepoStatus | null>(null)
  const [deviceCode, setDeviceCode] = useState<DeviceCodeInfo | null>(null)
  const [invites, setInvites] = useState<PendingInvite[]>([])
  const [collaborators, setCollaborators] = useState<Collaborator[]>([])
  const [friend, setFriend] = useState('')
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    window.api.auth.getStatus().then(async (a) => {
      setAuth(a)
      if (a.state === 'logged-in') await loadRepo()
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
      await loadRepo()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Помилка логіну')
    } finally {
      setBusy(false)
      setDeviceCode(null)
    }
  }

  async function handleCreateRepo(): Promise<void> {
    setBusy(true)
    setError(null)
    try {
      const r = await window.api.repo.create()
      setRepo(r)
      await loadRepo()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не вдалось створити сховище')
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
      setError(e instanceof Error ? e.message : 'Не вдалось запросити')
    } finally {
      setBusy(false)
    }
  }

  const loggedIn = auth?.state === 'logged-in'
  const repoReady = repo?.state === 'ready'
  const ready = loggedIn && repoReady

  return (
    <div style={styles.screen}>
      <div style={styles.head}>
        <div style={styles.title}>Ласкаво просимо до CoopSync!</div>
        <div style={styles.subtitle}>Налаштуємо все за 3 прості кроки</div>
      </div>

      {/* КРОК 1 — логін */}
      <Step n={1} done={loggedIn} title="Увійти через GitHub">
        {!loggedIn && !deviceCode && (
          <Button variant="ghost" style={{ alignSelf: 'flex-start' }} onClick={handleLogin} disabled={busy}>
            <GitHubIcon size={17} color={colors.text} /> Увійти через GitHub
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
                {copied ? '✓ Скопійовано' : 'Копіювати'}
              </Button>
              <Button
                variant="primary"
                onClick={() => window.api.openExternal(deviceCode.verificationUri)}
              >
                Відкрити GitHub →
              </Button>
            </div>
            <div style={styles.muted}>Встав код на сторінці й підтверди. ⏳ Чекаю…</div>
          </div>
        )}
        {loggedIn && (
          <div style={styles.okRow}>
            <div style={styles.avatar}>
              <GitHubIcon size={18} />
            </div>
            <span style={styles.okName}>{auth.user.login}</span>
          </div>
        )}
      </Step>

      {/* КРОК 2 — сховище */}
      <Step n={2} done={repoReady} title="Створити спільне сховище" disabled={!loggedIn}>
        {!repoReady ? (
          <Button
            variant="primary"
            style={{ alignSelf: 'flex-start' }}
            onClick={handleCreateRepo}
            disabled={busy || !loggedIn}
          >
            {busy ? 'Створюю…' : 'Створити репозиторій'}
          </Button>
        ) : (
          <div style={styles.okRow}>
            <span style={{ color: colors.success }}>✓</span>
            <span style={styles.okName}>{repo.repo.fullName}</span>
            <span style={{ fontSize: 13 }}>🔒</span>
          </div>
        )}
      </Step>

      {/* КРОК 3 — друг */}
      <Step n={3} done={collaborators.length > 0} title="Запросити друга" disabled={!repoReady} last>
        <div style={styles.row}>
          <input
            style={styles.input}
            placeholder="Нік друга на GitHub"
            value={friend}
            onChange={(e) => setFriend(e.target.value)}
            disabled={busy || !repoReady}
          />
          <Button variant="primary" onClick={handleInvite} disabled={busy || !friend.trim()}>
            Запросити
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
                ⏳ {i.login} (очікує)
              </span>
            ))}
          </div>
        )}
      </Step>

      {error && <div style={styles.error}>⚠️ {error}</div>}

      <div style={styles.footer}>
        <div style={styles.muted}>
          {ready ? '✓ Усе готово! Можна переходити до ігор.' : 'Заверши кроки вище'}
        </div>
        <Button
          variant="primary"
          style={{ height: 46, padding: '0 26px', fontSize: 15 }}
          onClick={onComplete}
          disabled={!ready}
        >
          Перейти до ігор →
        </Button>
      </div>
    </div>
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
            background: done ? colors.success : colors.accent,
            color: colors.bgDarker,
            fontWeight: 700,
            fontSize: 14,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}
        >
          {done ? '✓' : n}
        </div>
        {!last && <div style={{ width: 2, flex: 1, background: colors.surface, marginTop: 6 }} />}
      </div>
      <div style={styles.stepBody}>
        <div style={styles.stepTitle}>{title}</div>
        {children}
      </div>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  screen: { padding: '26px 34px', maxWidth: 720, margin: '0 auto', width: '100%' },
  head: { textAlign: 'center', marginBottom: 24 },
  title: { fontSize: 24, fontWeight: 800, color: colors.text },
  subtitle: { fontSize: 14, color: colors.muted, marginTop: 6 },
  stepBody: {
    border: `1px solid ${colors.surface}`,
    borderRadius: 10,
    padding: '14px 18px 16px',
    marginBottom: 14,
    display: 'flex',
    flexDirection: 'column',
    gap: 10
  },
  stepTitle: { fontSize: 15, fontWeight: 600, color: colors.text },
  row: { display: 'flex', gap: 10 },
  device: { display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'flex-start' },
  deviceCode: {
    fontSize: 26,
    letterSpacing: 4,
    fontFamily: 'monospace',
    background: colors.bgDarker,
    padding: '8px 16px',
    borderRadius: 8,
    color: colors.text
  },
  okRow: { display: 'flex', alignItems: 'center', gap: 9 },
  avatar: {
    width: 30,
    height: 30,
    borderRadius: '50%',
    background: colors.bgDarker,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    border: `1px solid ${colors.border}`
  },
  okName: { fontSize: 14, fontWeight: 600, color: colors.text },
  input: {
    flex: 1,
    height: 40,
    padding: '0 14px',
    border: `1px solid ${colors.border}`,
    borderRadius: 8,
    background: colors.bgDarker,
    color: colors.text,
    fontSize: 13,
    outline: 'none'
  },
  members: { display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 4 },
  memberOk: { fontSize: 13, color: colors.success },
  memberPending: { fontSize: 13, color: colors.muted },
  btnGhost: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    height: 42,
    padding: '0 18px',
    border: `1px solid ${colors.border}`,
    borderRadius: 8,
    background: colors.surface,
    color: colors.text,
    fontWeight: 600,
    fontSize: 13.5,
    cursor: 'pointer',
    alignSelf: 'flex-start'
  },
  btnPrimary: {
    height: 40,
    padding: '0 18px',
    border: 'none',
    borderRadius: 8,
    background: colors.accent,
    color: colors.bgDarker,
    fontWeight: 700,
    fontSize: 13.5,
    cursor: 'pointer'
  },
  btnSmall: {
    height: 40,
    padding: '0 16px',
    border: 'none',
    borderRadius: 8,
    background: colors.success,
    color: colors.bgDarker,
    fontWeight: 700,
    fontSize: 13.5,
    cursor: 'pointer'
  },
  muted: { fontSize: 13, color: colors.muted },
  error: { color: colors.error, fontSize: 13, marginTop: 8 },
  footer: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 18,
    paddingTop: 18,
    borderTop: `1px solid ${colors.surface}`
  },
  btnGo: {
    height: 46,
    padding: '0 26px',
    border: 'none',
    borderRadius: 9,
    background: colors.accent,
    color: colors.bgDarker,
    fontWeight: 700,
    fontSize: 15
  }
}

export default OnboardingScreen

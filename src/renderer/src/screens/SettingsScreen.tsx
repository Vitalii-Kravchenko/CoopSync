import { useEffect, useState } from 'react'
import { colors } from '../theme'
import { GitHubIcon } from '../components/icons'
import Button from '../components/Button'
import type { AuthUser, SavesRepoStatus, PendingInvite, Collaborator } from '../../../shared/types'

interface Props {
  user: AuthUser
  onLoggedOut: () => void
}

// Доступні мови. Поки одна — список розшириться в майбутньому.
const LANGUAGES = [{ code: 'uk', label: 'Українська', flag: '🇺🇦' }]

function SettingsScreen({ user, onLoggedOut }: Props): React.JSX.Element {
  const [repo, setRepo] = useState<SavesRepoStatus | null>(null)
  const [invites, setInvites] = useState<PendingInvite[]>([])
  const [collaborators, setCollaborators] = useState<Collaborator[]>([])
  const [friend, setFriend] = useState('')
  const [busy, setBusy] = useState(false)
  // Перемикачі поки візуальні — реальна логіка автозапуску/трею буде в кроці 4.
  const [autostart, setAutostart] = useState(true)
  const [tray, setTray] = useState(true)
  const [language, setLanguage] = useState('uk')

  useEffect(() => {
    void loadRepo()
  }, [])

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
      <div style={styles.h1}>Налаштування</div>

      {/* Профіль */}
      <div style={styles.card}>
        <div style={styles.profileLeft}>
          <div style={styles.avatar}>
            <GitHubIcon size={40} />
          </div>
          <Button variant="ghost" style={{ height: 30, padding: '0 12px', fontSize: 12 }}>
            Змінити зображення
          </Button>
        </div>
        <div style={{ flex: 1 }}>
          <div style={styles.userName}>{user.login}</div>
          <div style={styles.muted}>GitHub користувач</div>
        </div>
        <Button variant="danger" onClick={handleLogout}>
          <GitHubIcon size={14} color={colors.error} /> Вийти
        </Button>
      </div>

      <div style={styles.cols}>
        {/* Сховище */}
        <div style={styles.card2}>
          <div style={styles.h2}>Сховище</div>
          {repo?.state === 'ready' ? (
            <>
              <div style={styles.repoRow}>
                <div style={styles.repoIcon}>🔒</div>
                <div>
                  <div style={styles.repoName}>{repo.repo.fullName}</div>
                  <div style={styles.muted}>Приватний репозиторій</div>
                </div>
              </div>
              <button
                style={styles.linkBtn}
                onClick={() => window.api.openExternal(repo.repo.url)}
              >
                {repo.repo.url} ⧉
              </button>
              <div style={{ ...styles.muted, marginTop: 14, marginBottom: 8 }}>Запросити ще друга</div>
              <div style={styles.row}>
                <input
                  style={styles.input}
                  placeholder="Нік друга на GitHub"
                  value={friend}
                  onChange={(e) => setFriend(e.target.value)}
                  disabled={busy}
                />
                <Button variant="primary" onClick={handleInvite} disabled={busy || !friend.trim()}>
                  Запросити
                </Button>
              </div>
            </>
          ) : (
            <div style={styles.muted}>Сховище не налаштоване</div>
          )}
        </div>

        {/* Учасники */}
        <div style={styles.card2}>
          <div style={styles.h2}>Учасники ({collaborators.length + 1})</div>
          <div style={styles.memberRow}>
            <div style={styles.memberAvatar}>
              <GitHubIcon size={16} />
            </div>
            <span style={styles.memberName}>{user.login}</span>
            <span style={styles.muted}>(власник)</span>
          </div>
          {collaborators.map((c) => (
            <div key={c.login} style={styles.memberRow}>
              <div style={styles.memberAvatar}>👤</div>
              <span style={styles.memberName}>{c.login}</span>
            </div>
          ))}
          {invites.length > 0 && (
            <>
              <div style={{ ...styles.muted, marginTop: 12, marginBottom: 8 }}>Очікують підтвердження</div>
              {invites.map((i) => (
                <div key={i.login} style={styles.memberRow}>
                  <div style={styles.memberAvatar}>👤</div>
                  <span style={{ ...styles.memberName, flex: 1 }}>{i.login}</span>
                  <span style={styles.badge}>Очікує</span>
                </div>
              ))}
            </>
          )}
        </div>
      </div>

      <div style={styles.cols}>
        {/* Загальне */}
        <div style={styles.card2}>
          <div style={styles.h2}>Загальне</div>
          <div style={styles.langRow}>
            <span style={{ fontSize: 14, color: colors.text }}>Мова</span>
            <select
              style={styles.langSelect}
              value={language}
              onChange={(e) => setLanguage(e.target.value)}
            >
              {LANGUAGES.map((l) => (
                <option key={l.code} value={l.code}>
                  {l.flag} {l.label}
                </option>
              ))}
            </select>
          </div>
          <div style={styles.divider} />
          <Toggle label="Запускати разом із Windows" value={autostart} onChange={setAutostart} />
          <div style={styles.divider} />
          <Toggle label="Працювати у фоні (трей)" value={tray} onChange={setTray} />
          <div style={{ ...styles.muted, marginTop: 10, fontSize: 12 }}>
            Перемикачі поки демонстраційні — запрацюють у кроці «фон + автозапуск».
          </div>
        </div>

        {/* Про програму */}
        <div style={styles.card2}>
          <div style={styles.h2}>Про програму</div>
          <div style={styles.aboutRow}>
            <div style={styles.aboutLogo}>🎮</div>
            <div>
              <div style={styles.repoName}>CoopSync</div>
              <div style={styles.muted}>Версія 0.1.0</div>
            </div>
          </div>
          <div style={{ ...styles.muted, lineHeight: 1.5, margin: '4px 0 14px' }}>
            Синхронізація збережень кооперативних ігор між друзями через GitHub.
          </div>
          <button
            style={styles.linkBtn}
            onClick={() => window.api.openExternal('https://github.com/Vitalii-Kravchenko/CoopSync')}
          >
            GitHub репозиторій →
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
      <span style={{ fontSize: 14, color: colors.text }}>{label}</span>
      <div
        onClick={() => onChange(!value)}
        style={{
          width: 46,
          height: 26,
          borderRadius: 13,
          background: value ? colors.accent : colors.border,
          position: 'relative',
          cursor: 'pointer',
          transition: 'background .15s',
          flexShrink: 0
        }}
      >
        <div
          style={{
            position: 'absolute',
            top: 2,
            left: 2,
            width: 22,
            height: 22,
            borderRadius: '50%',
            background: '#fff',
            transform: value ? 'translateX(20px)' : 'translateX(0)',
            transition: 'transform .15s'
          }}
        />
      </div>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  screen: { flex: 1, overflowY: 'auto', padding: '28px 36px 40px' },
  h1: { fontSize: 22, fontWeight: 700, color: colors.text, marginBottom: 18 },
  h2: { fontSize: 17, fontWeight: 700, color: colors.text, marginBottom: 16 },
  card: {
    background: colors.surface,
    border: `1px solid ${colors.border}`,
    borderRadius: 12,
    padding: '20px 24px',
    display: 'flex',
    alignItems: 'center',
    gap: 22,
    marginBottom: 22
  },
  cols: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 22, marginBottom: 22 },
  card2: {
    background: colors.surface,
    border: `1px solid ${colors.border}`,
    borderRadius: 12,
    padding: '20px 24px'
  },
  profileLeft: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 },
  avatar: {
    width: 72,
    height: 72,
    borderRadius: '50%',
    background: colors.bgDarker,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    border: `1px solid ${colors.border}`
  },
  userName: { fontSize: 22, fontWeight: 700, color: colors.text },
  muted: { fontSize: 13, color: colors.muted },
  row: { display: 'flex', gap: 10 },
  input: {
    flex: 1,
    height: 40,
    padding: '0 14px',
    border: `1px solid ${colors.border}`,
    borderRadius: 8,
    background: colors.bg,
    color: colors.text,
    fontSize: 13,
    outline: 'none'
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
  btnGhostSmall: {
    fontSize: 11.5,
    padding: '5px 10px',
    border: `1px solid ${colors.border}`,
    borderRadius: 7,
    background: colors.bg,
    color: colors.text,
    cursor: 'pointer'
  },
  btnDanger: {
    height: 42,
    padding: '0 18px',
    border: `1px solid rgba(243,139,168,0.4)`,
    borderRadius: 9,
    background: 'transparent',
    color: colors.error,
    fontWeight: 600,
    fontSize: 14,
    cursor: 'pointer'
  },
  repoRow: { display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 },
  repoIcon: {
    width: 36,
    height: 36,
    borderRadius: 9,
    background: colors.bg,
    border: `1px solid ${colors.border}`,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 16
  },
  repoName: { fontSize: 15, fontWeight: 600, color: colors.text },
  linkBtn: {
    display: 'block',
    width: '100%',
    textAlign: 'left',
    fontSize: 12.5,
    color: colors.accent,
    background: colors.bg,
    border: `1px solid ${colors.border}`,
    borderRadius: 8,
    padding: '10px 12px',
    cursor: 'pointer',
    fontFamily: 'ui-monospace, monospace',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis'
  },
  memberRow: { display: 'flex', alignItems: 'center', gap: 11, marginBottom: 12 },
  memberAvatar: {
    width: 30,
    height: 30,
    borderRadius: '50%',
    background: colors.bg,
    border: `1px solid ${colors.border}`,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 13
  },
  memberName: { fontSize: 14, color: colors.text },
  badge: {
    fontSize: 10.5,
    color: colors.warning,
    background: 'rgba(249,226,175,0.12)',
    border: '1px solid rgba(249,226,175,0.35)',
    padding: '3px 10px',
    borderRadius: 11
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
    borderRadius: 8,
    border: `1px solid ${colors.border}`,
    background: colors.bg,
    color: colors.text,
    fontSize: 13,
    cursor: 'pointer',
    outline: 'none'
  },
  divider: { height: 1, background: colors.border, margin: '6px 0' },
  aboutRow: { display: 'flex', alignItems: 'center', gap: 13, marginBottom: 14 },
  aboutLogo: {
    width: 42,
    height: 42,
    borderRadius: 10,
    background: 'linear-gradient(135deg,#89b4fa,#cba6f7)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 22
  }
}

export default SettingsScreen

import { useEffect, useState } from 'react'
import type { SavesRepoStatus, PendingInvite } from '../../../shared/types'

function SavesRepo(): React.JSX.Element {
  const [status, setStatus] = useState<SavesRepoStatus | null>(null) // null = завантаження
  const [invites, setInvites] = useState<PendingInvite[]>([])
  const [friend, setFriend] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [inviteMsg, setInviteMsg] = useState<string | null>(null)

  useEffect(() => {
    void refresh()
  }, [])

  async function refresh(): Promise<void> {
    const s = await window.api.repo.getStatus()
    setStatus(s)
    if (s.state === 'ready') {
      setInvites(await window.api.repo.listInvitations())
    }
  }

  async function handleCreate(): Promise<void> {
    setBusy(true)
    setError(null)
    try {
      const s = await window.api.repo.create()
      setStatus(s)
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
    setInviteMsg(null)
    try {
      await window.api.repo.invite(friend)
      setInviteMsg(`Запрошення надіслано: ${friend.trim()}`)
      setFriend('')
      setInvites(await window.api.repo.listInvitations())
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не вдалось надіслати запрошення')
    } finally {
      setBusy(false)
    }
  }

  if (status === null) {
    return <p style={styles.muted}>Перевіряю сховище…</p>
  }

  return (
    <div style={styles.box}>
      <h2 style={styles.heading}>Спільне сховище</h2>

      {status.state === 'none' && (
        <>
          <p style={styles.muted}>Сховища ще нема. Створи приватний репозиторій для сейвів.</p>
          <button style={styles.btn} onClick={handleCreate} disabled={busy}>
            {busy ? 'Створюю…' : 'Створити спільне сховище'}
          </button>
        </>
      )}

      {status.state === 'ready' && (
        <>
          <p style={styles.ok}>
            ✅ Сховище:{' '}
            <a
              href={status.repo.url}
              style={styles.link}
              onClick={(e) => {
                e.preventDefault()
                window.api.openExternal(status.repo.url)
              }}
            >
              {status.repo.fullName}
            </a>
          </p>

          <div style={styles.inviteRow}>
            <input
              style={styles.input}
              placeholder="Нік друга на GitHub"
              value={friend}
              onChange={(e) => setFriend(e.target.value)}
              disabled={busy}
            />
            <button style={styles.btn} onClick={handleInvite} disabled={busy || !friend.trim()}>
              {busy ? '…' : 'Запросити'}
            </button>
          </div>

          {inviteMsg && <p style={styles.ok}>{inviteMsg}</p>}

          {invites.length > 0 && (
            <div style={styles.invites}>
              <p style={styles.muted}>Очікують підтвердження:</p>
              <ul style={styles.list}>
                {invites.map((i) => (
                  <li key={i.login}>{i.login}</li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}

      {error && <p style={styles.error}>⚠️ {error}</p>}
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  box: {
    marginTop: 28,
    paddingTop: 20,
    borderTop: '1px solid #313244',
    width: 420,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 10
  },
  heading: { margin: 0, fontSize: 20 },
  muted: { opacity: 0.7, margin: '4px 0' },
  ok: { color: '#a6e3a1', margin: '4px 0' },
  link: { color: '#89b4fa', cursor: 'pointer' },
  inviteRow: { display: 'flex', gap: 8, width: '100%' },
  input: {
    flex: 1,
    fontSize: 14,
    padding: '8px 12px',
    borderRadius: 8,
    border: '1px solid #585b70',
    background: '#313244',
    color: '#e8e8e8'
  },
  btn: {
    fontSize: 14,
    padding: '8px 18px',
    border: 'none',
    borderRadius: 8,
    background: '#89b4fa',
    color: '#1e1e2e',
    cursor: 'pointer',
    fontWeight: 600
  },
  invites: { width: '100%' },
  list: { margin: '4px 0', paddingLeft: 20, opacity: 0.85 },
  error: { color: '#f38ba8', margin: '4px 0' }
}

export default SavesRepo

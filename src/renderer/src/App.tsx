import { useEffect, useState } from 'react'
import type { AuthStatus, DeviceCodeInfo } from '../../shared/types'
import SavesRepo from './components/SavesRepo'

function App(): React.JSX.Element {
  const [status, setStatus] = useState<AuthStatus | null>(null) // null = ще завантажуємо
  const [deviceCode, setDeviceCode] = useState<DeviceCodeInfo | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  // При старті: перевірити, чи вже залогінені, і підписатись на код device flow.
  useEffect(() => {
    window.api.auth.getStatus().then(setStatus)
    const unsubscribe = window.api.auth.onDeviceCode(setDeviceCode)
    return unsubscribe
  }, [])

  async function handleLogin(): Promise<void> {
    setBusy(true)
    setError(null)
    setCopied(false)
    try {
      const result = await window.api.auth.login()
      setStatus(result)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Помилка логіну')
    } finally {
      setBusy(false)
      setDeviceCode(null)
    }
  }

  async function handleLogout(): Promise<void> {
    const result = await window.api.auth.logout()
    setStatus(result)
  }

  async function handleCopy(): Promise<void> {
    if (!deviceCode) return
    await window.api.copyToClipboard(deviceCode.userCode)
    setCopied(true)
  }

  function handleOpenGitHub(): void {
    if (!deviceCode) return
    window.api.openExternal(deviceCode.verificationUri)
  }

  return (
    <main style={styles.main}>
      <h1 style={styles.title}>CoopSync ☁️</h1>
      <p style={styles.subtitle}>Синхронізатор кооп-сейвів через GitHub</p>

      {status === null && <p style={styles.muted}>Завантаження…</p>}

      {status?.state === 'logged-in' && (
        <div style={styles.card}>
          <p style={styles.ok}>
            ✅ Залогінено як <b>{status.user.login}</b>{' '}
            <button style={styles.btnLink} onClick={handleLogout}>
              (вийти)
            </button>
          </p>
          <SavesRepo />
        </div>
      )}

      {status?.state === 'logged-out' && (
        <div style={styles.card}>
          {!busy && (
            <button style={styles.btn} onClick={handleLogin}>
              Login with GitHub
            </button>
          )}

          {busy && !deviceCode && <p style={styles.muted}>Запитую код у GitHub…</p>}

          {busy && deviceCode && (
            <div style={styles.deviceBox}>
              <p style={styles.step}>1. Скопіюй код:</p>
              <div style={styles.code}>{deviceCode.userCode}</div>
              <button style={styles.btnSmall} onClick={handleCopy}>
                {copied ? '✓ Скопійовано' : 'Копіювати код'}
              </button>

              <p style={styles.step}>2. Відкрий сторінку GitHub:</p>
              <button style={styles.btn} onClick={handleOpenGitHub}>
                Відкрити GitHub →
              </button>

              <p style={styles.step}>3. Встав код на сторінці й підтверди доступ.</p>
              <p style={styles.muted}>⏳ Чекаю підтвердження…</p>
            </div>
          )}
        </div>
      )}

      {error && <p style={styles.error}>⚠️ {error}</p>}
    </main>
  )
}

const styles: Record<string, React.CSSProperties> = {
  main: {
    fontFamily: 'system-ui, sans-serif',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: '100vh',
    margin: 0,
    color: '#e8e8e8'
  },
  title: { margin: 0, fontSize: 42 },
  subtitle: { opacity: 0.7, marginTop: 4 },
  muted: { opacity: 0.7, margin: '8px 0' },
  card: {
    marginTop: 24,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 12
  },
  deviceBox: {
    textAlign: 'center',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 8
  },
  step: { margin: '8px 0 0', fontWeight: 600, opacity: 0.9 },
  btn: {
    fontSize: 16,
    padding: '12px 24px',
    border: 'none',
    borderRadius: 8,
    background: '#89b4fa',
    color: '#1e1e2e',
    cursor: 'pointer',
    fontWeight: 600
  },
  btnSmall: {
    fontSize: 14,
    padding: '8px 18px',
    border: 'none',
    borderRadius: 8,
    background: '#a6e3a1',
    color: '#1e1e2e',
    cursor: 'pointer',
    fontWeight: 600
  },
  btnLink: {
    fontSize: 14,
    padding: 0,
    border: 'none',
    background: 'transparent',
    color: '#89b4fa',
    cursor: 'pointer',
    textDecoration: 'underline'
  },
  code: {
    fontSize: 32,
    letterSpacing: 4,
    fontFamily: 'monospace',
    background: '#313244',
    padding: '12px 20px',
    borderRadius: 8,
    margin: '4px 0'
  },
  ok: { color: '#a6e3a1', fontSize: 18 },
  error: { color: '#f38ba8', marginTop: 16 }
}

export default App

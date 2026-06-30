import { useEffect, useState } from 'react'
import { colors } from './theme'
import TitleBar from './components/TitleBar'
import Sidebar, { type Screen } from './components/Sidebar'
import OnboardingScreen from './screens/OnboardingScreen'
import MainScreen from './screens/MainScreen'
import SettingsScreen from './screens/SettingsScreen'
import type { AuthUser } from '../../shared/types'

type Phase = 'loading' | 'onboarding' | 'app'

function App(): React.JSX.Element {
  const [phase, setPhase] = useState<Phase>('loading')
  const [screen, setScreen] = useState<Screen>('main')
  const [user, setUser] = useState<AuthUser | null>(null)

  // При старті визначаємо: чи все вже налаштовано (повторний запуск),
  // чи треба показати майстер налаштування.
  useEffect(() => {
    void init()
  }, [])

  async function init(): Promise<void> {
    const auth = await window.api.auth.getStatus()
    if (auth.state !== 'logged-in') {
      setPhase('onboarding')
      return
    }
    setUser(auth.user)

    // Роль ще не вибрана → онбординг.
    const cfg = await window.api.role.get()
    if (!cfg) {
      setPhase('onboarding')
      return
    }
    // Host без готового сховища — теж онбординг.
    if (cfg.role === 'host') {
      const repo = await window.api.repo.getStatus()
      if (repo.state !== 'ready') {
        setPhase('onboarding')
        return
      }
    }
    enterApp()
  }

  // Перехід у робочий застосунок + запуск автосинхронізації.
  function enterApp(): void {
    setPhase('app')
    setScreen('main')
    void window.api.window.maximize()
    void window.api.watcher.start()
  }

  async function handleOnboardingComplete(): Promise<void> {
    const auth = await window.api.auth.getStatus()
    if (auth.state === 'logged-in') setUser(auth.user)
    enterApp()
  }

  function handleLoggedOut(): void {
    void window.api.watcher.stop()
    setUser(null)
    setPhase('onboarding')
  }

  return (
    <div style={styles.root}>
      <TitleBar user={phase === 'app' ? user : null} />

      {phase === 'loading' && <div style={styles.center}>Завантаження…</div>}

      {phase === 'onboarding' && (
        <div style={styles.onboarding}>
          <OnboardingScreen onComplete={handleOnboardingComplete} />
        </div>
      )}

      {phase === 'app' && user && (
        <div style={styles.appBody}>
          <Sidebar active={screen} onNavigate={setScreen} />
          {/* Обидва екрани лишаються змонтованими — перемикаємо лише видимість,
              щоб Settings не перезавантажував дані при кожному вході. */}
          <div style={{ flex: 1, display: screen === 'main' ? 'flex' : 'none', minHeight: 0 }}>
            <MainScreen />
          </div>
          <div style={{ flex: 1, display: screen === 'settings' ? 'flex' : 'none', minHeight: 0 }}>
            <SettingsScreen user={user} onLoggedOut={handleLoggedOut} />
          </div>
        </div>
      )}
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  root: {
    height: '100vh',
    display: 'flex',
    flexDirection: 'column',
    color: colors.text,
    fontFamily: 'system-ui, sans-serif',
    overflow: 'hidden'
  },
  center: {
    flex: 1,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: colors.muted
  },
  onboarding: { flex: 1, overflowY: 'auto', display: 'flex', alignItems: 'flex-start' },
  appBody: { flex: 1, display: 'flex', minHeight: 0 }
}

export default App

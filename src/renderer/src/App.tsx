import { useEffect, useState } from 'react'
import { colors, fonts } from './theme'
import { useI18n } from './i18n'
import TitleBar from './components/TitleBar'
import Sidebar, { type Screen } from './components/Sidebar'
import OnboardingScreen from './screens/OnboardingScreen'
import MainScreen from './screens/MainScreen'
import FriendsScreen from './screens/FriendsScreen'
import HistoryScreen from './screens/HistoryScreen'
import SettingsScreen from './screens/SettingsScreen'
import type { AuthUser } from '../../shared/types'

type Phase = 'loading' | 'onboarding' | 'app'

function App(): React.JSX.Element {
  const { t } = useI18n()
  const [phase, setPhase] = useState<Phase>('loading')
  const [screen, setScreen] = useState<Screen>('main')
  const [user, setUser] = useState<AuthUser | null>(null)
  const [avatarDataUrl, setAvatarDataUrl] = useState<string | null>(null)

  // При старті визначаємо: чи все вже налаштовано (повторний запуск),
  // чи треба показати майстер налаштування.
  useEffect(() => {
    void init()
    // Аватар — окреме локальне налаштування, не пов'язане з логіном,
    // тож тягнемо його паралельно і показуємо всюди (titlebar, onboarding, учасники).
    window.api.settings.getGeneral().then((g) => setAvatarDataUrl(g.avatarDataUrl))
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
    void enterApp()
  }

  // Перехід у робочий застосунок + запуск автосинхронізації.
  async function enterApp(): Promise<void> {
    setPhase('app')
    setScreen('main')
    // maximize() у Electron завжди показує вікно, навіть приховане — тож при
    // автозапуску "у трей" його викликати не можна, інакше вікно вилазить саме.
    const hidden = await window.api.window.wasStartedHidden()
    if (!hidden) void window.api.window.maximize()
    void window.api.watcher.start()
  }

  async function handleOnboardingComplete(): Promise<void> {
    const auth = await window.api.auth.getStatus()
    if (auth.state === 'logged-in') setUser(auth.user)
    void enterApp()
  }

  function handleLoggedOut(): void {
    void window.api.watcher.stop()
    setUser(null)
    setPhase('onboarding')
  }

  return (
    <div style={styles.root}>
      <TitleBar user={phase === 'app' ? user : null} avatarDataUrl={avatarDataUrl} />

      {phase === 'loading' && <div style={styles.center}>{t.app.loading}</div>}

      {phase === 'onboarding' && (
        <div style={styles.onboarding}>
          <OnboardingScreen onComplete={handleOnboardingComplete} avatarDataUrl={avatarDataUrl} />
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
          <div style={{ flex: 1, display: screen === 'friends' ? 'flex' : 'none', minHeight: 0 }}>
            <FriendsScreen user={user} avatarDataUrl={avatarDataUrl} />
          </div>
          <div style={{ flex: 1, display: screen === 'history' ? 'flex' : 'none', minHeight: 0 }}>
            <HistoryScreen />
          </div>
          <div style={{ flex: 1, display: screen === 'settings' ? 'flex' : 'none', minHeight: 0 }}>
            <SettingsScreen
              user={user}
              onLoggedOut={handleLoggedOut}
              avatarDataUrl={avatarDataUrl}
              onAvatarChange={setAvatarDataUrl}
            />
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
    color: colors.text1,
    fontFamily: fonts.body,
    overflow: 'hidden'
  },
  center: {
    flex: 1,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: colors.text3
  },
  onboarding: { flex: 1, overflowY: 'auto', display: 'flex', alignItems: 'flex-start' },
  appBody: { flex: 1, display: 'flex', minHeight: 0 }
}

export default App

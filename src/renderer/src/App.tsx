import { useEffect, useState } from 'react'
import { colors, fonts } from './theme'
import { useI18n } from './i18n'
import { describeError, describeSyncResult } from './errors'
import TitleBar from './components/TitleBar'
import Sidebar, { type Screen } from './components/Sidebar'
import Banner, { type BannerState } from './components/Banner'
import Button from './components/Button'
import OnboardingScreen from './screens/OnboardingScreen'
import MainScreen from './screens/MainScreen'
import FriendsScreen from './screens/FriendsScreen'
import HistoryScreen from './screens/HistoryScreen'
import SettingsScreen from './screens/SettingsScreen'
import type { AuthUser } from '../../shared/types'

type Phase = 'loading' | 'onboarding' | 'app' | 'error'

function App(): React.JSX.Element {
  const { t } = useI18n()
  const [phase, setPhase] = useState<Phase>('loading')
  const [errorMessage, setErrorMessage] = useState('')
  const [screen, setScreen] = useState<Screen>('main')
  const [user, setUser] = useState<AuthUser | null>(null)
  const [avatarDataUrl, setAvatarDataUrl] = useState<string | null>(null)
  // Бампається при видаленні/створенні сховища або будь-якому реальному push'і.
  // MainScreen і HistoryScreen лишаються змонтованими у фоні (див. коментар нижче)
  // і самі не дізнаються про такі зміни, тож перечитують дані по цьому сигналу.
  const [syncVersion, setSyncVersion] = useState(0)
  const bumpSyncVersion = (): void => setSyncVersion((v) => v + 1)
  // Глобальний тост про синхронізацію — рендериться поза табами (styles.appBody),
  // тому видимий незалежно від того, яка вкладка зараз відкрита.
  const [banner, setBanner] = useState<BannerState | null>(null)

  // При старті визначаємо: чи все вже налаштовано (повторний запуск),
  // чи треба показати майстер налаштування.
  useEffect(() => {
    void init()
    // Аватар — окреме локальне налаштування, не пов'язане з логіном,
    // тож тягнемо його паралельно і показуємо всюди (titlebar, onboarding, учасники).
    window.api.settings.getGeneral().then((g) => setAvatarDataUrl(g.avatarDataUrl))
  }, [])

  async function init(): Promise<void> {
    setPhase('loading')
    try {
      const auth = await window.api.auth.getStatus()
      if (auth.state === 'error') {
        // Тимчасовий збій перевірки (нема інтернету, ліміт GitHub API) — НЕ
        // токен насправді невалідний, тож не викидаємо в онбординг, а даємо
        // повідомлення + Retry.
        setErrorMessage(t.errors[auth.code](auth.params ?? {}))
        setPhase('error')
        return
      }
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
    } catch (e) {
      // Раніше будь-який збій тут (напр. нема інтернету при repo.getStatus())
      // лишав phase='loading' навіки без пояснення — тепер показуємо
      // повідомлення й даємо спробувати ще раз.
      setErrorMessage(describeError(e, t, t.main.syncErrorFallback))
      setPhase('error')
    }
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

  // Реакція на автосинхронізацію (запуск/вихід гри у фоні) — на рівні App, а не
  // MainScreen, щоб банер про push/pull був видимий на будь-якій вкладці.
  useEffect(() => {
    if (phase !== 'app') return
    return window.api.watcher.onAutoSync((e) => {
      // watcher-error не прив'язана до конкретної гри (напр. не вдалось
      // перевірити список запущених процесів) — без префікса назви гри.
      const text =
        e.action === 'watcher-error'
          ? describeSyncResult(e.code, e.params, t)
          : `${e.name}: ${describeSyncResult(e.code, e.params, t)}`
      if (e.code === 'push-skipped-nochange') {
        // Грали, але сейв не змінився — не проблема і не привід для тривоги
        // (як і ручне "вже синхронізовано"), тому info-тон, а не warning.
        setBanner({ text, kind: 'info' })
      } else if (e.action === 'push-skipped') {
        // Свідомо пропущений автопуш (конфлікт версій) — це не помилка,
        // але й не мовчати можна: тут людина могла б втратити прогрес друга.
        setBanner({ text, kind: 'warning' })
      } else if (e.ok) {
        setBanner({ text, kind: 'success', icon: e.action === 'pull' ? 'download' : 'upload' })
      } else {
        // Раніше помилки автосинку мовчки губились — тепер теж показуємо їх.
        setBanner({ text, kind: 'error' })
      }
      // Будь-яка реальна синхронізація (push ДОДАЄ запис; pull МІГ підтягнути
      // git-пул чужий новий запис, якого локально ще не було видно) — окрім
      // свідомо пропущених/no-change випадків — сигналимо MainScreen/HistoryScreen.
      if (e.ok && e.action !== 'push-skipped') bumpSyncVersion()
    })
  }, [phase, t])

  // Банер сам зникає через 5 секунд.
  useEffect(() => {
    if (!banner) return
    const timer = setTimeout(() => setBanner(null), 5000)
    return () => clearTimeout(timer)
  }, [banner])

  return (
    <div style={styles.root}>
      <TitleBar user={phase === 'app' ? user : null} avatarDataUrl={avatarDataUrl} />

      {phase === 'loading' && <div style={styles.center}>{t.app.loading}</div>}

      {phase === 'error' && (
        <div style={styles.center}>
          <div style={styles.errorBox}>
            <div>{errorMessage}</div>
            <Button variant="secondary" onClick={() => void init()}>
              {t.main.retry}
            </Button>
          </div>
        </div>
      )}

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
            <MainScreen
              active={screen === 'main'}
              syncVersion={syncVersion}
              onSynced={bumpSyncVersion}
              onBanner={setBanner}
            />
          </div>
          <div style={{ flex: 1, display: screen === 'friends' ? 'flex' : 'none', minHeight: 0 }}>
            <FriendsScreen user={user} avatarDataUrl={avatarDataUrl} />
          </div>
          <div style={{ flex: 1, display: screen === 'history' ? 'flex' : 'none', minHeight: 0 }}>
            <HistoryScreen active={screen === 'history'} syncVersion={syncVersion} />
          </div>
          <div style={{ flex: 1, display: screen === 'settings' ? 'flex' : 'none', minHeight: 0 }}>
            <SettingsScreen
              user={user}
              onLoggedOut={handleLoggedOut}
              avatarDataUrl={avatarDataUrl}
              onAvatarChange={setAvatarDataUrl}
              onRepoChanged={bumpSyncVersion}
            />
          </div>

          <Banner banner={banner} />
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
  errorBox: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 14,
    maxWidth: 360,
    textAlign: 'center'
  },
  onboarding: { flex: 1, overflowY: 'auto', display: 'flex', alignItems: 'flex-start' },
  appBody: { flex: 1, display: 'flex', minHeight: 0 }
}

export default App

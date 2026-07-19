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
  // Bumped when a repo is deleted/created or on any real push.
  // MainScreen and HistoryScreen stay mounted in the background (see comment below)
  // and don't find out about such changes on their own, so they reread data on this signal.
  const [syncVersion, setSyncVersion] = useState(0)
  const bumpSyncVersion = (): void => setSyncVersion((v) => v + 1)
  // Bumped every time the Sidebar's "Games" item is clicked — including when
  // 'main' is already the active screen (e.g. a game's detail sub-view is open) —
  // so MainScreen knows to back out of that sub-view even though `screen` itself
  // doesn't change and its own effects wouldn't otherwise fire.
  const [mainResetSignal, setMainResetSignal] = useState(0)
  function handleNavigate(next: Screen): void {
    setScreen(next)
    if (next === 'main') setMainResetSignal((v) => v + 1)
  }
  // Global sync toast — rendered outside the tabs (styles.appBody),
  // so it stays visible regardless of which tab is currently open.
  const [banner, setBanner] = useState<BannerState | null>(null)
  // appIds whose background autopush (post game-exit) is currently in
  // flight — GameDetailScreen uses this to block "Restore" for that game
  // until the push actually lands, so it can't race the same git clone.
  const [autoPushPending, setAutoPushPending] = useState<Set<string>>(new Set())
  // appIds with a cloud save pushed by a friend that this device hasn't
  // looked at yet — drives the number badge on the Sidebar's "History" item.
  // No "Games" badge anymore (deliberately removed — auto-sync already pulls
  // the save silently on next launch regardless, and it's redundant with
  // History's badge + the tray toast, both covering the same signal).
  const [unseenHistory, setUnseenHistory] = useState<Set<string>>(new Set())
  const markHistorySeen = (): void => setUnseenHistory(new Set())

  // Tells main which game/version pairs were just shown on the Games screen —
  // main-side bookkeeping only now (suppresses a re-toast for a version the
  // user already looked at), no local badge to clear anymore.
  function markGamesSeen(entries: Array<{ appId: string; version: number }>): void {
    const withVersion = entries.filter((e) => e.version > 0)
    if (withVersion.length === 0) return
    void window.api.sync.markSeen(withVersion)
  }

  // On startup, determine whether everything is already configured (repeat launch)
  // or whether we need to show the setup wizard.
  useEffect(() => {
    void init()
    // Avatar is a separate local setting, not tied to login,
    // so we fetch it in parallel and show it everywhere (titlebar, onboarding, members).
    window.api.settings.getGeneral().then((g) => setAvatarDataUrl(g.avatarDataUrl))
  }, [])

  async function init(): Promise<void> {
    setPhase('loading')
    try {
      const auth = await window.api.auth.getStatus()
      if (auth.state === 'error') {
        // Temporary check failure (no internet, GitHub API rate limit) — the
        // token isn't actually invalid, so we don't kick the user to onboarding,
        // we show a message + Retry instead.
        setErrorMessage(t.errors[auth.code](auth.params ?? {}))
        setPhase('error')
        return
      }
      if (auth.state !== 'logged-in') {
        setPhase('onboarding')
        return
      }
      setUser(auth.user)

      // Role not chosen yet -> onboarding.
      const cfg = await window.api.role.get()
      if (!cfg) {
        setPhase('onboarding')
        return
      }
      // Host without a ready repo — also onboarding.
      if (cfg.role === 'host') {
        const repo = await window.api.repo.getStatus()
        if (repo.state !== 'ready') {
          setPhase('onboarding')
          return
        }
      }
      void enterApp()
    } catch (e) {
      // Previously any failure here (e.g. no internet during repo.getStatus())
      // left phase='loading' forever with no explanation — now we show
      // a message and let the user retry.
      setErrorMessage(describeError(e, t, t.main.syncErrorFallback))
      setPhase('error')
    }
  }

  // Transition into the main app + start auto-sync.
  async function enterApp(): Promise<void> {
    setPhase('app')
    setScreen('main')
    // Electron's maximize() always shows the window, even if hidden — so on
    // auto-launch "to tray" we must not call it, or the window will pop up on its own.
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

  // After leaving a shared repo (repo:leave already reset our role on the
  // main side) — stay logged in, just drop back to onboarding's "choose a
  // role" step so the user can host their own storage or join someone else.
  function handleLeftSharedRepo(): void {
    void window.api.watcher.stop()
    setPhase('onboarding')
  }

  // After turning the local clone into our own repo (repo:adopt-as-own
  // already set role/hostOwner to us on the main side) — we're already a
  // host with a ready repo, so no onboarding: just refresh statuses/history
  // under the new role and restart the watcher (watcher:start reads
  // role/hostOwner fresh, so it picks the new host role up on its own).
  function handleAdoptedOwnStorage(): void {
    bumpSyncVersion()
    void window.api.watcher.start()
  }

  // Reaction to auto-sync (game launch/exit in the background) — handled at the App
  // level, not MainScreen, so the push/pull banner is visible on any tab.
  useEffect(() => {
    if (phase !== 'app') return
    return window.api.watcher.onAutoSync((e) => {
      // Pure marker for "a background push for this game just started" —
      // no result to show, just flips the game into "pending" so
      // GameDetailScreen can block Restore until the matching push/
      // push-skipped below clears it again.
      if (e.action === 'push-start') {
        setAutoPushPending((prev) => new Set(prev).add(e.appId))
        return
      }
      if (e.action === 'push' || e.action === 'push-skipped') {
        setAutoPushPending((prev) => {
          if (!prev.has(e.appId)) return prev
          const next = new Set(prev)
          next.delete(e.appId)
          return next
        })
      }
      // watcher-error isn't tied to a specific game (e.g. failed to
      // check the list of running processes) — no game name prefix.
      const text =
        e.action === 'watcher-error'
          ? describeSyncResult(e.code, e.params, t)
          : `${e.name}: ${describeSyncResult(e.code, e.params, t)}`
      if (e.code === 'push-skipped-nochange') {
        // Played, but the save didn't change — not a problem or cause for alarm
        // (same as manual "already synced"), so info tone, not warning.
        setBanner({ text, kind: 'info' })
      } else if (e.action === 'push-skipped') {
        // Deliberately skipped auto-push (version conflict) — not an error,
        // but we shouldn't stay silent either: the user could lose a friend's progress here.
        setBanner({ text, kind: 'warning' })
      } else if (e.ok) {
        setBanner({ text, kind: 'success', icon: e.action === 'pull' ? 'download' : 'upload' })
      } else {
        // Previously auto-sync errors were silently swallowed — now we show them too.
        setBanner({ text, kind: 'error' })
      }
      // Any real sync (push ADDS an entry; pull MAY have pulled in
      // someone else's new entry via git that wasn't visible locally yet) — except
      // for deliberately skipped/no-change cases — signals MainScreen/HistoryScreen.
      if (e.ok && e.action !== 'push-skipped') bumpSyncVersion()
    })
  }, [phase, t])

  // A friend pushed a save while this device wasn't running/looking —
  // background-detected by the watcher (see watcher.ts checkFriendUpdates),
  // independent of any game launch/exit on THIS pc. Toast via the OS
  // notification center + light up the History nav badge.
  useEffect(() => {
    if (phase !== 'app') return
    return window.api.watcher.onFriendUpdate((updates) => {
      setUnseenHistory((prev) => {
        const next = new Set(prev)
        for (const u of updates) next.add(u.appId)
        return next
      })
      for (const u of updates) {
        const n = new Notification(t.notifications.friendUploadedTitle, {
          body: t.notifications.friendUploadedBody(u.updatedBy, u.name)
        })
        n.onclick = () => void window.api.window.maximize()
      }
      // Refresh statuses/history in the background — if the Games tab is
      // already open, this shows the new version right away and (via the
      // 'active' gate in MainScreen) marks it seen immediately too.
      bumpSyncVersion()
    })
  }, [phase, t])

  // The OS toast for "update available" is fired from the main process now
  // (see updater.ts showUpdateToast) — that toast's click brings the window
  // up directly via a main-process callback, not through this renderer,
  // which may be sitting hidden/backgrounded for a long stretch (tray) and
  // isn't a reliable place to depend on for handling the click.

  // The banner dismisses itself after 5 seconds.
  useEffect(() => {
    if (!banner) return
    const timer = setTimeout(() => setBanner(null), 5000)
    return () => clearTimeout(timer)
  }, [banner])

  return (
    <div style={styles.root}>
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
        // grid-template-areas (not flex-direction!) — DOM order (= Tab order)
        // is intentionally "screen content -> Sidebar", while grid-area places the Sidebar
        // on the left purely visually, independent of DOM order. flex-direction:
        // row-reverse doesn't work here — Chromium computes Tab order from the
        // visual (reversed) position, not from the DOM, so the reverse trick
        // just brought back the old (wrong) focus order.
        <div style={styles.appBody}>
          {/* Both screens stay mounted — we only toggle visibility,
              so Settings doesn't reload data on every entry. */}
          <div
            style={{ gridArea: 'content', display: screen === 'main' ? 'flex' : 'none', minHeight: 0 }}
          >
            <MainScreen
              active={screen === 'main'}
              syncVersion={syncVersion}
              resetSignal={mainResetSignal}
              onSynced={bumpSyncVersion}
              onBanner={setBanner}
              onGamesSeen={markGamesSeen}
              user={user}
              avatarDataUrl={avatarDataUrl}
              autoPushPending={autoPushPending}
            />
          </div>
          <div
            style={{ gridArea: 'content', display: screen === 'friends' ? 'flex' : 'none', minHeight: 0 }}
          >
            <FriendsScreen
              user={user}
              avatarDataUrl={avatarDataUrl}
              active={screen === 'friends'}
              onRepoChanged={bumpSyncVersion}
            />
          </div>
          <div
            style={{ gridArea: 'content', display: screen === 'history' ? 'flex' : 'none', minHeight: 0 }}
          >
            <HistoryScreen
              active={screen === 'history'}
              syncVersion={syncVersion}
              onSeen={markHistorySeen}
              user={user}
              avatarDataUrl={avatarDataUrl}
            />
          </div>
          <div
            style={{ gridArea: 'content', display: screen === 'settings' ? 'flex' : 'none', minHeight: 0 }}
          >
            <SettingsScreen
              user={user}
              onLoggedOut={handleLoggedOut}
              active={screen === 'settings'}
              avatarDataUrl={avatarDataUrl}
              onAvatarChange={setAvatarDataUrl}
              onRepoChanged={bumpSyncVersion}
              onLeftRepo={handleLeftSharedRepo}
              onAdoptedOwnStorage={handleAdoptedOwnStorage}
              onBanner={setBanner}
            />
          </div>

          <Sidebar active={screen} onNavigate={handleNavigate} historyBadge={unseenHistory.size} />
          <Banner banner={banner} />
        </div>
      )}

      {/* TitleBar — last in the DOM (not first), Tab reaches Support and
          window buttons only AFTER the current tab's content and Sidebar. Visually
          it's still on top — grid-area:'titlebar' on root puts it in the first
          grid row regardless of DOM order. */}
      <TitleBar user={phase === 'app' ? user : null} avatarDataUrl={avatarDataUrl} />
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  root: {
    height: '100vh',
    // grid-template-areas — TitleBar is last in the DOM (Tab order), but
    // gridArea:'titlebar' (in TitleBar.tsx) puts it in the first grid row
    // regardless of DOM order. See the comment near <TitleBar>.
    display: 'grid',
    gridTemplateRows: 'auto 1fr',
    gridTemplateAreas: '"titlebar" "body"',
    color: colors.text1,
    fontFamily: fonts.body,
    overflow: 'hidden'
  },
  center: {
    gridArea: 'body',
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
  onboarding: { gridArea: 'body', overflowY: 'auto', display: 'flex', alignItems: 'flex-start', minHeight: 0 },
  // grid-template-areas — Sidebar is last in the DOM (Tab order), while
  // gridArea:'sidebar' (in Sidebar.tsx) places it on the left purely visually.
  // See the comment near <Sidebar> above.
  appBody: {
    gridArea: 'body',
    display: 'grid',
    gridTemplateColumns: '196px 1fr',
    gridTemplateAreas: '"sidebar content"',
    minHeight: 0,
    minWidth: 0
  }
}

export default App

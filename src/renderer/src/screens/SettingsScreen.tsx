import { useEffect, useState } from 'react'
import { colors, fonts, gradients, radii, shadows, transitions } from '../theme'
import { LANGUAGES, useI18n, type LanguageCode } from '../i18n'
import { describeError } from '../errors'
import { GitHubIcon, Logo } from '../components/icons'
import Button from '../components/Button'
import ConfirmModal from '../components/ConfirmModal'
import type { AuthUser, SavesRepoStatus, StartupSettings } from '../../../shared/types'

interface Props {
  user: AuthUser
  onLoggedOut: () => void
  /** Кастомний аватар (data URL) — спільний з titlebar і онбордингом. */
  avatarDataUrl: string | null
  onAvatarChange: (dataUrl: string) => void
  /** MainScreen лишається змонтованим у фоні — сповіщаємо його перерахувати
   *  статуси синку, коли сховище видалене або створене заново. */
  onRepoChanged: () => void
}

function SettingsScreen({
  user,
  onLoggedOut,
  avatarDataUrl,
  onAvatarChange,
  onRepoChanged
}: Props): React.JSX.Element {
  const { t, language, setLanguage } = useI18n()
  const [repo, setRepo] = useState<SavesRepoStatus | null>(null)
  const [startup, setStartup] = useState<StartupSettings>({
    openAtLogin: false,
    startMinimized: false
  })
  const [avatarError, setAvatarError] = useState<string | null>(null)
  const [showCloudWarning, setShowCloudWarning] = useState(true)
  const [appVersion, setAppVersion] = useState('')
  const [showDeleteRepo, setShowDeleteRepo] = useState(false)
  const [deletingRepo, setDeletingRepo] = useState(false)
  const [deleteRepoError, setDeleteRepoError] = useState<string | null>(null)
  const [creatingRepo, setCreatingRepo] = useState(false)
  const [createRepoError, setCreateRepoError] = useState<string | null>(null)

  useEffect(() => {
    void loadRepo()
    window.api.settings.getStartup().then(setStartup)
    window.api.settings.getGeneral().then((s) => setShowCloudWarning(s.showCloudWarning))
    window.api.getAppVersion().then(setAppVersion)
  }, [])

  async function handleStartup(patch: Partial<StartupSettings>): Promise<void> {
    setStartup(await window.api.settings.setStartup(patch))
  }

  async function handleCloudWarningToggle(value: boolean): Promise<void> {
    setShowCloudWarning(value)
    await window.api.settings.setCloudWarning(value)
  }

  async function handlePickAvatar(): Promise<void> {
    setAvatarError(null)
    try {
      const dataUrl = await window.api.settings.pickAvatar()
      if (dataUrl) onAvatarChange(dataUrl)
    } catch (e) {
      setAvatarError(describeError(e, t, t.settings.avatarError))
    }
  }

  async function loadRepo(): Promise<void> {
    setRepo(await window.api.repo.getStatus())
  }

  async function handleLogout(): Promise<void> {
    await window.api.auth.logout()
    onLoggedOut()
  }

  async function handleCreateRepo(): Promise<void> {
    setCreatingRepo(true)
    setCreateRepoError(null)
    try {
      await window.api.repo.create()
      await loadRepo()
      onRepoChanged()
      // repo:delete зупиняє автосинк (watcher.stopWatcher()), а сам він більше
      // ніде не перезапускається — без цього гра/вихід з гри після пересоздання
      // репо мовчки ігноруються до перезапуску застосунку.
      void window.api.watcher.start()
    } catch (e) {
      setCreateRepoError(describeError(e, t, t.onboarding.createRepoError))
    } finally {
      setCreatingRepo(false)
    }
  }

  async function handleDeleteRepo(): Promise<void> {
    setDeletingRepo(true)
    setDeleteRepoError(null)
    try {
      await window.api.repo.delete()
      setShowDeleteRepo(false)
      await loadRepo()
      onRepoChanged()
    } catch (e) {
      setDeleteRepoError(describeError(e, t, t.settings.deleteRepoConfirmTitle))
    } finally {
      setDeletingRepo(false)
    }
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

      {/* Сховище */}
      <div style={{ ...styles.card2, marginBottom: 22 }}>
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
            <div style={{ ...styles.divider, marginTop: 18 }} />
            <Button
              variant="danger"
              style={{ marginTop: 4 }}
              onClick={() => setShowDeleteRepo(true)}
            >
              {t.settings.deleteRepoButton}
            </Button>
          </>
        ) : (
          <>
            <div style={{ ...styles.muted, marginBottom: 14 }}>{t.settings.storageNotSet}</div>
            <Button
              variant="primary"
              style={{ alignSelf: 'flex-start' }}
              onClick={handleCreateRepo}
              disabled={creatingRepo}
            >
              {creatingRepo ? t.onboarding.creating : t.onboarding.createRepo}
            </Button>
            {createRepoError && <div style={styles.createRepoError}>{createRepoError}</div>}
          </>
        )}
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
          <div style={styles.divider} />
          <Toggle
            label={t.settings.cloudWarningToggle}
            value={showCloudWarning}
            onChange={handleCloudWarningToggle}
          />
        </div>

        {/* Про програму */}
        <div style={styles.card2}>
          <div style={styles.h2}>{t.settings.about}</div>
          <div style={styles.aboutRow}>
            <Logo size={42} />
            <div>
              <div style={styles.repoName}>CoopSync</div>
              <div style={styles.muted}>{t.settings.version(appVersion)}</div>
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
          <div style={styles.smartAppWarning}>
            <div style={styles.smartAppWarningTitle}>⚠️ {t.settings.smartAppWarningTitle}</div>
            <div style={styles.smartAppWarningText}>{t.settings.smartAppWarningText}</div>
          </div>
        </div>
      </div>

      {showDeleteRepo && (
        <ConfirmModal
          title={t.settings.deleteRepoConfirmTitle}
          description={t.settings.deleteRepoConfirmDesc}
          confirmLabel={t.settings.deleteRepoButton}
          cancelLabel={t.settings.cancel}
          countdownSeconds={10}
          busy={deletingRepo}
          error={deleteRepoError}
          onConfirm={handleDeleteRepo}
          onCancel={() => {
            setShowDeleteRepo(false)
            setDeleteRepoError(null)
          }}
        />
      )}
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
          transition: `background ${transitions.hover}, box-shadow ${transitions.hover}`,
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
            transition: `left ${transitions.hover}`
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
  createRepoError: { fontSize: 12.5, color: colors.danger, marginTop: 10 },
  userName: { fontFamily: fonts.display, fontSize: 20, fontWeight: 700, color: colors.text1 },
  muted: { fontSize: 13, color: colors.text3 },
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
  aboutRow: { display: 'flex', alignItems: 'center', gap: 13, marginBottom: 14 },
  smartAppWarning: {
    marginTop: 14,
    padding: '10px 12px',
    borderRadius: radii.md,
    border: `1px solid ${colors.warningBd}`,
    background: colors.warningBg
  },
  smartAppWarningTitle: {
    fontFamily: fonts.display,
    fontSize: 12.5,
    fontWeight: 600,
    color: colors.text1,
    marginBottom: 4
  },
  smartAppWarningText: {
    fontSize: 11.5,
    color: colors.text2,
    lineHeight: 1.5
  }
}

export default SettingsScreen

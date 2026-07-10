import type { ErrorCode } from '../../../shared/errors'

export type LanguageCode = 'en' | 'uk' | 'de' | 'fr' | 'pl' | 'ru' | 'es' | 'pt-BR' | 'tr' | 'zh-CN'

export interface LanguageMeta {
  code: LanguageCode
  label: string
  flag: string
}

// Порядок — за англійською назвою мови (стандартна практика для списків вибору мови).
export const LANGUAGES: LanguageMeta[] = [
  { code: 'en', label: 'English', flag: '🇺🇸' },
  { code: 'fr', label: 'Français', flag: '🇫🇷' },
  { code: 'de', label: 'Deutsch', flag: '🇩🇪' },
  { code: 'pl', label: 'Polski', flag: '🇵🇱' },
  { code: 'pt-BR', label: 'Português (Brasil)', flag: '🇧🇷' },
  { code: 'ru', label: 'Русский', flag: '🇷🇺' },
  { code: 'zh-CN', label: '简体中文', flag: '🇨🇳' },
  { code: 'es', label: 'Español', flag: '🇪🇸' },
  { code: 'tr', label: 'Türkçe', flag: '🇹🇷' },
  { code: 'uk', label: 'Українська', flag: '🇺🇦' }
]

const CODES: string[] = LANGUAGES.map((l) => l.code)

/** Перевірка, що збережений у налаштуваннях рядок — дійсний код мови. */
export function isLanguageCode(value: string): value is LanguageCode {
  return CODES.includes(value)
}

export interface Translation {
  app: { loading: string }
  windowControls: { minimize: string; maximize: string; restore: string; close: string }
  sidebar: { games: string; friends: string; settings: string; history: string }
  main: {
    searchPlaceholder: string
    loadingGames: string
    installedGames: string
    allSupportedGames: string
    nothingFound: string
    alreadySynced: string
    noSavesInCloud: string
    noLocalSaves: string
    syncErrorFallback: string
    uploadSuccess: (version: string) => string
    downloadSuccess: (version: string) => string
    restoreSuccess: (count: string) => string
    pushSkipped: string
    pushSkippedStale: string
    pushSkippedNoChange: string
    statusesError: string
    retry: string
  }
  gameCard: {
    statusSynced: string
    statusLocalNewer: string
    statusRemoteNewer: string
    statusLocalStale: string
    statusNotUploaded: string
    statusCloudOnly: string
    statusNoSaves: string
    statusNoRepo: string
    statusChecking: string
    unsupported: string
    syncing: string
    upload: string
    download: string
    versions: (local: string, cloud: string) => string
    gameNotSupported: string
    notInstalled: string
    lastSync: (value: string) => string
    savesSize: (value: string) => string
  }
  friends: {
    title: string
    inviteTitle: string
    sending: string
    acceptedBadge: string
    noStorage: string
    emptyFriends: string
    inviteError: string
  }
  history: {
    title: string
    columnGame: string
    columnAction: string
    columnVersion: string
    columnWhen: string
    uploaded: string
    emptyTitle: string
    emptySubtitle: string
    loadError: string
    justNow: string
    minutesAgo: (n: number) => string
    hoursAgo: (n: number) => string
    daysAgo: (n: number) => string
  }
  cloudWarning: {
    title: string
    message: string
    instructions: string
    settingsHint: string
    dismiss: string
  }
  onboarding: {
    welcomeTitle: string
    welcomeSubtitle: string
    step1Title: string
    loginButton: string
    copied: string
    copy: string
    openGithub: string
    pasteCodeHint: string
    step2Title: string
    hostTitle: string
    hostDesc: string
    joinTitle: string
    joinDesc: string
    youAreHost: string
    change: string
    hostLoginPlaceholder: string
    checking: string
    connect: string
    chooseOtherRole: string
    step3Title: string
    creating: string
    createRepo: string
    step4Title: string
    friendPlaceholder: string
    invite: string
    pending: string
    finishStepsAbove: string
    allReady: string
    goToGames: string
    loginError: string
    genericError: string
    joinError: string
    createRepoError: string
    inviteError: string
  }
  settings: {
    title: string
    changeAvatar: string
    avatarError: string
    githubUser: string
    logout: string
    storage: string
    privateRepo: string
    storageNotSet: string
    friendPlaceholder: string
    invite: string
    members: (count: number) => string
    owner: string
    pendingConfirmation: string
    pendingBadge: string
    deleteRepoButton: string
    deleteRepoConfirmTitle: string
    deleteRepoConfirmDesc: string
    cancel: string
    general: string
    language: string
    autostart: string
    startMinimized: string
    cloudWarningToggle: string
    smartAppWarningTitle: string
    smartAppWarningText: string
    about: string
    version: (v: string) => string
    aboutDescription: string
    githubRepoLink: string
  }
  /** Локалізовані тексти для кодів помилок з main-процесу (shared/errors.ts). */
  errors: Record<ErrorCode, (params: Record<string, string>) => string>
}

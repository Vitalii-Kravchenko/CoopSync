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
    addGameCard: string
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
    statusNeedsSetup: string
    unsupported: string
    syncing: string
    upload: string
    download: string
    versions: (local: string, cloud: string) => string
    gameNotSupported: string
    notInstalled: string
    lastSyncLabel: string
    savesSizeLabel: string
    details: string
    customTag: string
    setUp: string
  }
  addGame: {
    title: string
    description: string
    nameLabel: string
    namePlaceholder: string
    pathLabel: string
    submit: string
    installPathLabel: string
    installPathHint: string
    scanButton: string
    scanning: string
    exeFoundLabel: string
    exeNoneFound: string
    addExeManually: string
    addCover: string
    coverLabel: string
  }
  friends: {
    title: string
    subtitle: string
    inviteTitle: string
    sending: string
    acceptedBadge: string
    noStorage: string
    emptyTitle: string
    emptySubtitle: string
    inviteError: string
    loadError: string
    removeMember: string
    removeConfirmTitle: (login: string) => string
    removeConfirmDesc: string
    removeError: string
    ownerBadge: string
    membersShort: (count: number) => string
    gamesShort: (count: number) => string
    openOnGithub: string
    lastSyncLabel: string
    totalSyncsLabel: string
    neverSynced: string
    sentLabel: string
    cancelInvite: string
  }
  history: {
    title: string
    columnGame: string
    columnAction: string
    columnPlayer: string
    filterPlaceholder: string
    pagePrev: string
    pageNext: string
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
    restore: string
    restorePendingHint: string
    restoreConfirmTitle: string
    restoreConfirmDesc: (version: string, who: string) => string
    restoreError: string
    revertSuccess: (version: string) => string
    restoredFromBadge: (version: string) => string
    savePathTitle: string
    savePathCustomBadge: string
    savePathNotFound: string
    savePathEdit: string
    savePathBrowse: string
    savePathPlaceholder: string
    savePathSave: string
    savePathCancel: string
    savePathReset: string
    savePathSaveError: string
    customGameWarning: string
    removeCustomGame: string
    removeCustomGameConfirmTitle: string
    removeCustomGameConfirmDesc: (name: string) => string
    removeCustomGameError: string
    changeCover: string
    coverError: string
    coverUpdated: string
    excludeFilesTitle: string
    excludeFilesHint: string
    excludeFilesEmpty: string
  }
  cloudWarning: {
    title: string
    message: string
    instructions: string
    settingsHint: string
    dismiss: string
  }
  updateBanner: {
    title: string
    message: (v: string) => string
    readyTitle: string
    readyMessage: string
  }
  notifications: {
    /** OS tray toast title when a friend pushes a save while this device wasn't looking. */
    friendUploadedTitle: string
    /** OS tray toast body — who, which game. */
    friendUploadedBody: (login: string, game: string) => string
    /** Bell icon tooltip. */
    bellTooltip: string
    /** Bell panel header. */
    panelTitle: string
    /** Bell panel empty state. */
    empty: string
    markAllRead: string
    clearAll: string
    newGamesTitle: string
    newGamesBody: (names: string) => string
    friendAcceptedTitle: string
    friendAcceptedBody: (login: string) => string
    friendDeclinedTitle: string
    friendDeclinedBody: (login: string) => string
    /** Body reuses main.pushSkipped (prefixed with the game name in code). */
    syncConflictTitle: string
    accessRevokedTitle: string
    accessRevokedBody: (host: string) => string
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
    pendingInviteFrom: (host: string) => string
    youAreHost: string
    change: string
    hostLoginPlaceholder: string
    checking: string
    connect: string
    chooseOtherRole: string
    step3Title: string
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
    avatarUpdated: string
    cropTitle: string
    cropHint: string
    cropConfirm: string
    saveError: string
    githubUser: string
    logout: string
    storage: string
    privateRepo: string
    storageNotSet: string
    joinAccessLost: (host: string) => string
    friendPlaceholder: string
    invite: string
    members: (count: number) => string
    owner: string
    pendingConfirmation: string
    pendingBadge: string
    deleteRepoButton: string
    deleteRepoConfirmTitle: string
    deleteRepoConfirmDesc: string
    leaveRepoButton: string
    leaveRepoConfirmTitle: string
    leaveRepoConfirmDesc: string
    adoptRepoTitle: string
    adoptRepoDesc: string
    adoptRepoConfirm: string
    adoptRepoDecline: string
    cancel: string
    general: string
    language: string
    autostart: string
    startMinimized: string
    cloudWarningToggle: string
    autoCheckUpdatesToggle: string
    smartAppWarningTitle: string
    smartAppWarningText: string
    about: string
    version: (v: string) => string
    aboutDescription: string
    githubRepoLink: string
    checkForUpdates: string
    checkingForUpdates: string
    updateAvailable: (v: string) => string
    updateNotAvailable: string
    downloadUpdate: string
    updateDownloading: (percent: number) => string
    updateDownloaded: (v: string) => string
    restartToInstall: string
    updateCheckError: string
  }
  support: {
    tooltip: string
    title: string
    categoryBug: string
    categoryGame: string
    categoryIdea: string
    categoryOther: string
    placeholder: string
    messageRequired: string
    send: string
    sending: string
    success: string
    gameSearchPlaceholder: string
    gameSearchEmpty: string
    gameRequired: string
    commentOptionalPlaceholder: string
    maxGamesReached: (max: number) => string
    addAnotherGame: string
    removeGame: string
  }
  /** Локалізовані тексти для кодів помилок з main-процесу (shared/errors.ts). */
  errors: Record<ErrorCode, (params: Record<string, string>) => string>
}

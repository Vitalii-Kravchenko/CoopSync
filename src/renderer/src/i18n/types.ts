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
    refreshGames: string
    refreshSuccess: string
    refreshError: string
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
    pushSkippedNoChangeExit: string
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
    statusOrphaned: string
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
    /** Overlay badge on the poster when a mutual friend is playing this game right now. */
    friendPlayingBadge: (login: string) => string
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
    excludeStepTitle: string
    excludeStepDescription: string
    done: string
    stepSetupLabel: string
    stepExcludeLabel: string
    closeBlockedHint: string
    createdBanner: (name: string) => string
    coverHint: string
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
    onlineStatus: string
    offlineStatus: string
    /** Shown next to a friend's presence caption when they're currently
     *  playing something we both sync (see presenceService.ts's onPlaying). */
    playingLabel: (game: string) => string
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
    savePathNeedsSetupHint: string
    savePathLocked: string
    customGameWarning: string
    customGameBadge: string
    needsSetupTitle: string
    jumpToIt: string
    sectionWhereSavesLive: string
    sectionSyncBehavior: string
    dangerZoneTitle: string
    dangerZoneDesc: string
    autoSyncExeTitle: string
    autoSyncExeHint: string
    autoSyncNotSet: string
    removeCustomGame: string
    removeCustomGameConfirmTitle: string
    removeCustomGameConfirmDesc: (name: string) => string
    removeCustomGameError: string
    removeCustomGameSuccess: (name: string) => string
    changeCover: string
    renameGame: string
    renameGameError: string
    coverError: string
    coverUpdated: string
    coverSyncFailedBanner: string
    coverSyncRetrySuccess: string
    excludeFilesTitle: string
    excludeFilesHint: string
    excludeFilesEmpty: string
    excludeFilesRefresh: string
    extraFoldersTitle: string
    extraFoldersHint: string
    extraFoldersEmpty: string
    extraFoldersAdd: string
    extraFolderLabelPlaceholder: string
    extraFolderPathPlaceholder: string
    extraFolderBrowse: string
    extraFolderShared: string
    extraFolderPersonal: string
    extraFolderSharedHint: string
    extraFolderPersonalHint: string
    extraFolderSettings: string
    extraFolderNameLabel: string
    extraFolderPathLabel: string
    extraFolderVisibilityLabel: string
    extraFolderAddSave: string
    extraFolderAddCancel: string
    extraFolderAddError: string
    extraFolderNoPath: string
    extraFolderRemove: string
    extraFolderRemoveConfirmTitle: string
    extraFolderRemoveConfirmDesc: (label: string) => string
    extraFolderRemoveError: string
    extraFolderRenameError: string
    extraFolderShareToggleError: string
    extraFolderShareToggleSuccess: string
    extraFolderShareToggleBusy: string
    /** Sync-scope toggle on a game's own detail screen (any game, catalog or
     *  custom — not just extra folders) — reuses SharedToggle from
     *  ExtraFoldersSection.tsx, and its extraFolderShared/extraFolderPersonal/
     *  extraFolderShareToggleBusy labels, just with these game-level hints. */
    syncScopeTitle: string
    syncScopeSharedHint: string
    syncScopePersonalHint: string
    syncScopeToggleError: string
  }
  cloudWarning: {
    title: string
    message: string
    instructions: string
    settingsHint: string
    dismiss: string
  }
  oneDriveWarning: {
    title: string
    message: string
    /** Comma-joined affected game names, e.g. "Affected: Terraria, Stardew Valley". */
    gamesLabel: (games: string) => string
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
    gameRemovedTitle: string
    gameRemovedBody: (game: string) => string
    folderRemovedTitle: string
    folderRemovedBody: (game: string, folder: string) => string
    /** A mutual friend and I are playing the same game right now. alreadyPlaying
     *  is true when I'm the one joining and they were already there — the
     *  wording flips from "just started" to "is playing" since nothing just
     *  "happened" from my side of that. */
    friendPlayingTitle: string
    friendPlayingBody: (login: string, game: string, alreadyPlaying: boolean) => string
    /** Action button on the game-removed/folder-removed notification —
     *  keeps the local copy, re-syncs it just for the clicker (see
     *  CustomGame.orphaned/personal). */
    restoreAction: string
    restoring: string
    restored: string
    /** Action button on a sync-conflict-skipped notification that created a
     *  conflict branch (see sync.ts's pushConflictSnapshot) — pulls it out to
     *  a plain folder for the user to inspect/merge by hand. */
    downloadConflictAction: string
    downloadingConflict: string
    conflictDownloaded: string
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
    oneDriveWarningToggle: string
    autoCheckUpdatesToggle: string
    smartAppWarningTitle: string
    smartAppWarningText: string
    about: string
    version: (v: string) => string
    aboutDescription: string
    githubRepoLink: string
    privacyPolicyLink: string
    termsOfServiceLink: string
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

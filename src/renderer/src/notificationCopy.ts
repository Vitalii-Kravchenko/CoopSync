import { colors } from './theme'
import type { Translation } from './i18n'
import type { ToastKind } from '../../shared/types'
import {
  CheckIcon,
  TrashIcon,
  InfoIcon,
  LibraryIcon,
  AlertTriangleIcon,
  AlertCircleIcon,
  CloseIcon
} from './components/icons'

// Shared between NotificationBell (persisted bell panel) and the toast
// overlay window (src/renderer/src/toast/) — same event, same copy/color,
// just a different container. Single source so the two never drift apart.

export function describeNotification(
  kind: ToastKind,
  params: Record<string, string>,
  t: Translation
): { title: string; body: string } {
  switch (kind) {
    case 'save-uploaded':
      return {
        title: t.notifications.friendUploadedTitle,
        body: t.notifications.friendUploadedBody(params.login, params.game)
      }
    case 'update-available':
      return { title: t.updateBanner.title, body: t.updateBanner.message(params.version) }
    case 'new-games':
      return { title: t.notifications.newGamesTitle, body: t.notifications.newGamesBody(params.names) }
    case 'friend-accepted':
      return {
        title: t.notifications.friendAcceptedTitle,
        body: t.notifications.friendAcceptedBody(params.login)
      }
    case 'friend-declined':
      return {
        title: t.notifications.friendDeclinedTitle,
        body: t.notifications.friendDeclinedBody(params.login)
      }
    case 'sync-conflict-skipped':
      return { title: t.notifications.syncConflictTitle, body: `${params.game}: ${t.main.pushSkipped}` }
    case 'access-revoked':
      return {
        title: t.notifications.accessRevokedTitle,
        body: t.notifications.accessRevokedBody(params.host)
      }
    case 'game-removed':
      return {
        title: t.notifications.gameRemovedTitle,
        body: t.notifications.gameRemovedBody(params.game)
      }
    case 'folder-removed':
      return {
        title: t.notifications.folderRemovedTitle,
        body: t.notifications.folderRemovedBody(params.game, params.folder)
      }
  }
}

export type NotificationTone = 'success' | 'warning' | 'danger' | 'info' | 'neutral'

export interface KindStyle {
  Icon: (p: { size?: number; color?: string }) => React.JSX.Element
  tone: NotificationTone
  color: string
  bg: string
  bd: string
  /** Card border color while hovered — same hue, higher opacity (the toast
   *  card's only hover change, see ToastCard — no lift/transform). */
  bdHover: string
  /** Text color for a solid action button in this tone (e.g. "Restore"),
   *  matching this app's existing solid-button convention of a near-black
   *  shade of the button's own hue rather than plain white/black. */
  textOnTone: string
}

const TONE_COLORS: Record<
  Exclude<NotificationTone, 'neutral'>,
  { color: string; bg: string; bd: string; bdHover: string; textOnTone: string }
> = {
  success: {
    color: colors.success,
    bg: colors.successBg,
    bd: colors.successBd,
    bdHover: 'rgba(63,217,166,.75)',
    textOnTone: '#06140e'
  },
  warning: {
    color: colors.warning,
    bg: colors.warningBg,
    bd: colors.warningBd,
    bdHover: 'rgba(242,177,74,.75)',
    textOnTone: '#1a1206'
  },
  danger: {
    color: colors.danger,
    bg: colors.dangerBg,
    bd: colors.dangerBd,
    bdHover: 'rgba(255,107,124,.75)',
    textOnTone: '#1c0207'
  },
  info: {
    color: colors.info,
    bg: colors.infoBg,
    bd: colors.infoBd,
    bdHover: 'rgba(90,169,255,.75)',
    textOnTone: colors.textOnAccent
  }
}
// Neutral — "nothing to celebrate, but not a warning either" (declined an
// invite): the plain tx-3 gray scale, not a semantic color at all.
const NEUTRAL = {
  color: colors.text3,
  bg: 'rgba(255,255,255,.05)',
  bd: colors.borderDefault,
  bdHover: 'rgba(255,255,255,.22)',
  textOnTone: colors.textOnAccent
}

function style(tone: NotificationTone, Icon: KindStyle['Icon']): KindStyle {
  return { Icon, tone, ...(tone === 'neutral' ? NEUTRAL : TONE_COLORS[tone]) }
}

export const KIND_STYLE: Record<ToastKind, KindStyle> = {
  'save-uploaded': style('success', CheckIcon),
  'update-available': style('info', InfoIcon),
  'new-games': style('info', LibraryIcon),
  'friend-accepted': style('success', CheckIcon),
  'friend-declined': style('neutral', CloseIcon),
  'sync-conflict-skipped': style('warning', AlertTriangleIcon),
  'access-revoked': style('danger', AlertCircleIcon),
  'game-removed': style('warning', TrashIcon),
  'folder-removed': style('warning', TrashIcon)
}

/** Kinds whose toast carries an action button instead of a plain dismiss ×
 *  (see ToastCard — these also get a longer auto-dismiss timer, since this
 *  overlay sits above every window on screen and one sitting forever with
 *  no timer proved annoying in practice). */
export function toastAction(
  kind: ToastKind,
  t: Translation
): { label: string } | undefined {
  switch (kind) {
    case 'update-available':
      return { label: t.settings.downloadUpdate }
    case 'game-removed':
    case 'folder-removed':
      return { label: t.notifications.restoreAction }
    default:
      return undefined
  }
}

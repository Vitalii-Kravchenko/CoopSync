// Localized errors from the main process. Electron IPC serializes a thrown
// error only as a string (message) — all custom fields/classes are lost. So
// we encode the code+params directly in the message with a marker, and the
// renderer (which has Translation) decodes them and shows localized text via
// t.errors[code]. Unrecognized errors (e.g. an as-yet-unclassified git
// exception) are shown by the renderer as cleaned-up raw text — see
// describeError in renderer/src/errors.ts.

export type ErrorCode =
  | 'NOT_LOGGED_IN'
  | 'HOST_LOGIN_REQUIRED'
  | 'NO_ACCESS_TO_HOST_REPO'
  | 'IMAGE_FORMAT_UNSUPPORTED'
  | 'IMAGE_TOO_LARGE'
  | 'DEVICE_CODE_FAILED'
  | 'LOGIN_FAILED'
  | 'USER_FETCH_FAILED'
  | 'REPO_CHECK_FAILED'
  | 'REPO_CREATE_FAILED'
  | 'GITHUB_USER_NOT_FOUND'
  | 'REPO_NOT_FOUND'
  | 'INVITE_FAILED'
  | 'REPO_DELETE_NO_PERMISSION'
  | 'REPO_DELETE_FAILED'
  | 'NOT_REPO_OWNER'
  | 'REMOVE_COLLABORATOR_FAILED'
  | 'LEAVE_REPO_FAILED'
  | 'ENCRYPTION_UNAVAILABLE'
  | 'GAME_NOT_SUPPORTED'
  | 'SAVE_FOLDER_NOT_FOUND'
  | 'NO_CLOUD_SAVES'
  | 'NO_INTERNET'
  | 'GIT_AUTH_FAILED'
  | 'GIT_GENERIC'
  | 'GITHUB_RATE_LIMITED'
  | 'SUPPORT_SEND_FAILED'
  | 'SUPPORT_RATE_LIMITED'

const MARKER = 'app-error:'

/** Create an Error from which the renderer can decode the code + params. */
export function makeAppError(code: ErrorCode, params?: Record<string, string>): Error {
  return new Error(MARKER + JSON.stringify({ code, params }))
}

/**
 * Decode an error. Accepts both the raw Error.message from main (unwrapped)
 * and what arrives via ipcRenderer.invoke — Electron prepends
 * "Error invoking remote method 'x': Error: " before our marker, so we look
 * for the marker via indexOf instead of anchoring to the start of the string.
 */
export function parseAppError(message: string): { code: ErrorCode; params?: Record<string, string> } | null {
  const idx = message.indexOf(MARKER)
  if (idx === -1) return null
  try {
    const parsed = JSON.parse(message.slice(idx + MARKER.length)) as { code: ErrorCode; params?: Record<string, string> }
    return parsed
  } catch {
    return null
  }
}

import { GITHUB_CLIENT_ID, GITHUB_SCOPE, SAVES_REPO_NAME } from '../config'
import { makeAppError } from '../../shared/errors'
import type {
  DeviceCodeInfo,
  AuthUser,
  SavesRepo,
  PendingInvite,
  Collaborator
} from '../../shared/types'

const API = 'https://api.github.com'

// --- Device Flow: 3 steps ---
// 1) requestDeviceCode — ask GitHub for a code for the user
// 2) pollForToken      — wait for the user to confirm in the browser
// 3) fetchUser         — find out who logged in

interface DeviceCodeResponse {
  device_code: string
  user_code: string
  verification_uri: string
  expires_in: number
  interval: number
}

interface AccessTokenResponse {
  access_token?: string
  error?: string
  error_description?: string
}

/** Headers for authorized requests to the GitHub API. */
function authHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'Content-Type': 'application/json'
  }
}

// Wrapper around fetch: a raw network exception (no internet, DNS not
// resolving) would otherwise surface as untranslated technical text —
// unlike the git path (wrapGitError in sync.ts), where this is already handled.
async function githubFetch(url: string, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(url, init)
  } catch {
    throw makeAppError('NO_INTERNET')
  }
}

// Token expired/revoked (401) or GitHub API rate limit exhausted (403
// specifically with x-ratelimit-remaining: 0 — a plain "no permission" 403
// doesn't hit this) — recognized the same way for any REST call, instead of
// a bare status number in every individual *_FAILED code.
function checkAuthAndRateLimit(res: Response): void {
  if (res.status === 401) throw makeAppError('GIT_AUTH_FAILED')
  if (res.status === 403 && res.headers.get('x-ratelimit-remaining') === '0') {
    throw rateLimitError(res)
  }
}

function rateLimitError(res: Response): Error {
  const resetHeader = res.headers.get('x-ratelimit-reset')
  const time = resetHeader ? formatResetTime(Number(resetHeader) * 1000) : ''
  return makeAppError('GITHUB_RATE_LIMITED', { time })
}

// Local time in HH:MM format, rounded up to the next minute — the same
// approach used for SUPPORT_RATE_LIMITED in support.ts.
function formatResetTime(epochMs: number): string {
  const d = new Date(Math.ceil(epochMs / 60000) * 60000)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

/** Step 1: get the device code + the code shown to the user. */
export async function requestDeviceCode(): Promise<{
  deviceCode: string
  info: DeviceCodeInfo
}> {
  const res = await githubFetch('https://github.com/login/device/code', {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: GITHUB_CLIENT_ID, scope: GITHUB_SCOPE })
  })
  if (!res.ok) {
    throw makeAppError('DEVICE_CODE_FAILED', { status: String(res.status) })
  }
  const data = (await res.json()) as DeviceCodeResponse
  return {
    deviceCode: data.device_code,
    info: {
      userCode: data.user_code,
      verificationUri: data.verification_uri,
      expiresIn: data.expires_in,
      interval: data.interval
    }
  }
}

/** Step 2: poll GitHub until the user confirms (or time runs out). */
export async function pollForToken(deviceCode: string, interval: number): Promise<string> {
  let waitSeconds = interval
  // A single temporary network hiccup during the minutes of waiting
  // shouldn't kill the whole login — keep trying, and only if failures pile
  // up too many times in a row do we give up with a clear NO_INTERNET
  // instead of polling silently forever.
  let consecutiveNetworkFailures = 0
  const MAX_CONSECUTIVE_NETWORK_FAILURES = 5

  // eslint-disable-next-line no-constant-condition
  while (true) {
    await sleep(waitSeconds * 1000)

    let res: Response
    try {
      res = await fetch('https://github.com/login/oauth/access_token', {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id: GITHUB_CLIENT_ID,
          device_code: deviceCode,
          grant_type: 'urn:ietf:params:oauth:grant-type:device_code'
        })
      })
    } catch {
      consecutiveNetworkFailures++
      if (consecutiveNetworkFailures >= MAX_CONSECUTIVE_NETWORK_FAILURES) {
        throw makeAppError('NO_INTERNET')
      }
      continue
    }
    consecutiveNetworkFailures = 0
    const data = (await res.json()) as AccessTokenResponse

    if (data.access_token) return data.access_token

    // User hasn't entered the code yet — keep waiting.
    if (data.error === 'authorization_pending') continue
    // GitHub is asking us to poll less often.
    if (data.error === 'slow_down') {
      waitSeconds += 5
      continue
    }
    // Any other error is fatal (code expired, access denied, etc.).
    throw makeAppError('LOGIN_FAILED', { reason: data.error_description || data.error || '' })
  }
}

/** Step 3: find out the user's login from the token. */
export async function fetchUser(token: string): Promise<AuthUser> {
  const res = await githubFetch(`${API}/user`, { headers: authHeaders(token) })
  checkAuthAndRateLimit(res)
  if (!res.ok) {
    throw makeAppError('USER_FETCH_FAILED', { status: String(res.status) })
  }
  const data = (await res.json()) as { login: string; name: string | null }
  return { login: data.login, name: data.name ?? undefined }
}

// --- Shared saves repo ---

interface RepoResponse {
  full_name: string
  html_url: string
}

/** Check whether the saves repo exists. Returns its data or null. */
export async function getSavesRepo(token: string, owner: string): Promise<SavesRepo | null> {
  const res = await githubFetch(`${API}/repos/${owner}/${SAVES_REPO_NAME}`, {
    headers: authHeaders(token)
  })
  if (res.status === 404) return null
  checkAuthAndRateLimit(res)
  if (!res.ok) throw makeAppError('REPO_CHECK_FAILED', { status: String(res.status) })
  const data = (await res.json()) as RepoResponse
  return { fullName: data.full_name, url: data.html_url }
}

async function createRepoOnGitHub(token: string): Promise<SavesRepo> {
  const res = await githubFetch(`${API}/user/repos`, {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify({
      name: SAVES_REPO_NAME,
      private: true,
      auto_init: true, // include a README right away so the repo isn't empty
      description: 'CoopSync — спільне сховище сейвів'
    })
  })
  checkAuthAndRateLimit(res)
  if (!res.ok) throw makeAppError('REPO_CREATE_FAILED', { status: String(res.status) })
  const data = (await res.json()) as RepoResponse
  return { fullName: data.full_name, url: data.html_url }
}

/** Create a private saves repo. If it already exists — return the existing one. */
export async function createSavesRepo(token: string, owner: string): Promise<SavesRepo> {
  const existing = await getSavesRepo(token, owner)
  if (existing) return existing
  return createRepoOnGitHub(token)
}

// Used only by adoptLocalHistoryAsOwnRepo (sync.ts) — unlike createSavesRepo,
// this must NOT silently reuse an existing repo: that flow force-pushes a
// whole other history onto whatever it creates, which would destroy an
// existing repo's real content if one already existed under this owner.
export async function createFreshSavesRepo(token: string, owner: string): Promise<SavesRepo> {
  const existing = await getSavesRepo(token, owner)
  if (existing) throw makeAppError('HOST_REPO_ALREADY_EXISTS')
  return createRepoOnGitHub(token)
}

/** Invite a friend as a collaborator on the saves repo (push permission). */
export async function inviteCollaborator(
  token: string,
  owner: string,
  username: string
): Promise<void> {
  const res = await githubFetch(
    `${API}/repos/${owner}/${SAVES_REPO_NAME}/collaborators/${username}`,
    {
      method: 'PUT',
      headers: authHeaders(token),
      body: JSON.stringify({ permission: 'push' })
    }
  )
  // 201 — invitation created, 204 — already a collaborator.
  if (res.status === 201 || res.status === 204) return
  // GitHub returns 404 specifically when no user with that login exists
  // (verified empirically — not 422, which you might expect). By the time
  // this call runs, the repo's existence is already guaranteed (the UI only
  // shows the invite form after repoReady), so 404 here unambiguously means
  // "no such user", not "no such repo".
  if (res.status === 404) throw makeAppError('GITHUB_USER_NOT_FOUND', { username })
  checkAuthAndRateLimit(res)
  throw makeAppError('INVITE_FAILED', { status: String(res.status) })
}

/** List of invitations that haven't been accepted yet. */
export async function listInvitations(token: string, owner: string): Promise<PendingInvite[]> {
  const res = await githubFetch(`${API}/repos/${owner}/${SAVES_REPO_NAME}/invitations`, {
    headers: authHeaders(token)
  })
  if (!res.ok) return []
  const data = (await res.json()) as Array<{
    id: number
    created_at: string
    invitee: { login: string }
  }>
  return data.map((item) => ({ login: item.invitee.login, id: item.id, createdAt: item.created_at }))
}

/** Owner cancels a not-yet-accepted invitation. */
export async function cancelInvitation(
  token: string,
  owner: string,
  invitationId: number
): Promise<void> {
  const res = await githubFetch(
    `${API}/repos/${owner}/${SAVES_REPO_NAME}/invitations/${invitationId}`,
    { method: 'DELETE', headers: authHeaders(token) }
  )
  if (res.status === 204 || res.status === 404) return // 404 — already gone (accepted or cancelled)
  checkAuthAndRateLimit(res)
  throw makeAppError('CANCEL_INVITE_FAILED', { status: String(res.status) })
}

/** List of collaborators who already have access (excluding the owner). */
export async function listCollaborators(token: string, owner: string): Promise<Collaborator[]> {
  const res = await githubFetch(`${API}/repos/${owner}/${SAVES_REPO_NAME}/collaborators`, {
    headers: authHeaders(token)
  })
  if (!res.ok) return []
  const data = (await res.json()) as Array<{ login: string }>
  return data
    .filter((c) => c.login.toLowerCase() !== owner.toLowerCase())
    .map((c) => ({ login: c.login }))
}

/** Owner removes a friend's access to the shared repo (kick). */
export async function removeCollaborator(
  token: string,
  owner: string,
  username: string
): Promise<void> {
  const res = await githubFetch(
    `${API}/repos/${owner}/${SAVES_REPO_NAME}/collaborators/${username}`,
    { method: 'DELETE', headers: authHeaders(token) }
  )
  if (res.status === 204 || res.status === 404) return // 404 — already not a collaborator
  checkAuthAndRateLimit(res)
  throw makeAppError('REMOVE_COLLABORATOR_FAILED', { status: String(res.status) })
}

/** A collaborator leaves the host's shared repo (removes themselves) — the
 * same GitHub endpoint as removeCollaborator, GitHub allows a collaborator
 * with push access to remove themselves without needing admin rights. */
export async function leaveSharedRepo(
  token: string,
  hostOwner: string,
  selfLogin: string
): Promise<void> {
  const res = await githubFetch(
    `${API}/repos/${hostOwner}/${SAVES_REPO_NAME}/collaborators/${selfLogin}`,
    { method: 'DELETE', headers: authHeaders(token) }
  )
  if (res.status === 204 || res.status === 404) return
  checkAuthAndRateLimit(res)
  throw makeAppError('LEAVE_REPO_FAILED', { status: String(res.status) })
}

/** Delete the saves repo for good. Irreversible — confirmation is handled by the UI. */
export async function deleteSavesRepo(token: string, owner: string): Promise<void> {
  const res = await githubFetch(`${API}/repos/${owner}/${SAVES_REPO_NAME}`, {
    method: 'DELETE',
    headers: authHeaders(token)
  })
  if (res.status === 204) return
  if (res.status === 404) return // already deleted — treat as success
  checkAuthAndRateLimit(res)
  if (res.status === 403) {
    throw makeAppError('REPO_DELETE_NO_PERMISSION')
  }
  throw makeAppError('REPO_DELETE_FAILED', { status: String(res.status) })
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

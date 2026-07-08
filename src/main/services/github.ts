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

// --- Device Flow: 3 кроки ---
// 1) requestDeviceCode — попросити в GitHub код для користувача
// 2) pollForToken      — чекати, поки користувач підтвердить у браузері
// 3) fetchUser         — дізнатись, хто залогінився

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

/** Заголовки для авторизованих запитів до GitHub API. */
function authHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'Content-Type': 'application/json'
  }
}

/** Крок 1: отримати device code + код для користувача. */
export async function requestDeviceCode(): Promise<{
  deviceCode: string
  info: DeviceCodeInfo
}> {
  const res = await fetch('https://github.com/login/device/code', {
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

/** Крок 2: опитувати GitHub, поки користувач не підтвердить (або не вийде час). */
export async function pollForToken(deviceCode: string, interval: number): Promise<string> {
  let waitSeconds = interval

  // eslint-disable-next-line no-constant-condition
  while (true) {
    await sleep(waitSeconds * 1000)

    const res = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: GITHUB_CLIENT_ID,
        device_code: deviceCode,
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code'
      })
    })
    const data = (await res.json()) as AccessTokenResponse

    if (data.access_token) return data.access_token

    // Користувач ще не ввів код — чекаємо далі.
    if (data.error === 'authorization_pending') continue
    // GitHub просить опитувати рідше.
    if (data.error === 'slow_down') {
      waitSeconds += 5
      continue
    }
    // Будь-яка інша помилка — фатальна (код протух, доступ відхилено тощо).
    throw makeAppError('LOGIN_FAILED', { reason: data.error_description || data.error || '' })
  }
}

/** Крок 3: дізнатись логін користувача за токеном. */
export async function fetchUser(token: string): Promise<AuthUser> {
  const res = await fetch(`${API}/user`, { headers: authHeaders(token) })
  if (!res.ok) {
    throw makeAppError('USER_FETCH_FAILED', { status: String(res.status) })
  }
  const data = (await res.json()) as { login: string }
  return { login: data.login }
}

// --- Спільне сховище сейвів ---

interface RepoResponse {
  full_name: string
  html_url: string
}

/** Перевірити, чи існує репо сейвів. Повертає його дані або null. */
export async function getSavesRepo(token: string, owner: string): Promise<SavesRepo | null> {
  const res = await fetch(`${API}/repos/${owner}/${SAVES_REPO_NAME}`, {
    headers: authHeaders(token)
  })
  if (res.status === 404) return null
  if (!res.ok) throw makeAppError('REPO_CHECK_FAILED', { status: String(res.status) })
  const data = (await res.json()) as RepoResponse
  return { fullName: data.full_name, url: data.html_url }
}

/** Створити приватне репо сейвів. Якщо вже існує — повернути наявне. */
export async function createSavesRepo(token: string, owner: string): Promise<SavesRepo> {
  const existing = await getSavesRepo(token, owner)
  if (existing) return existing

  const res = await fetch(`${API}/user/repos`, {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify({
      name: SAVES_REPO_NAME,
      private: true,
      auto_init: true, // одразу з README, щоб репо не був порожній
      description: 'CoopSync — спільне сховище сейвів'
    })
  })
  if (!res.ok) throw makeAppError('REPO_CREATE_FAILED', { status: String(res.status) })
  const data = (await res.json()) as RepoResponse
  return { fullName: data.full_name, url: data.html_url }
}

/** Запросити друга у співавтори репо сейвів (право push). */
export async function inviteCollaborator(
  token: string,
  owner: string,
  username: string
): Promise<void> {
  const res = await fetch(
    `${API}/repos/${owner}/${SAVES_REPO_NAME}/collaborators/${username}`,
    {
      method: 'PUT',
      headers: authHeaders(token),
      body: JSON.stringify({ permission: 'push' })
    }
  )
  // 201 — запрошення створено, 204 — вже співавтор.
  if (res.status === 201 || res.status === 204) return
  // GitHub повертає 404 саме коли юзера з таким ніком не існує (перевірено емпірично —
  // не 422, як можна було б очікувати). До цього виклику наявність самого сховища вже
  // гарантована (UI показує форму запрошення лише після repoReady), тож 404 тут
  // однозначно означає "нема такого юзера", а не "нема сховища".
  if (res.status === 404) throw makeAppError('GITHUB_USER_NOT_FOUND', { username })
  throw makeAppError('INVITE_FAILED', { status: String(res.status) })
}

/** Список запрошень, які ще не прийняті. */
export async function listInvitations(token: string, owner: string): Promise<PendingInvite[]> {
  const res = await fetch(`${API}/repos/${owner}/${SAVES_REPO_NAME}/invitations`, {
    headers: authHeaders(token)
  })
  if (!res.ok) return []
  const data = (await res.json()) as Array<{ invitee: { login: string } }>
  return data.map((item) => ({ login: item.invitee.login }))
}

/** Список співавторів, які вже мають доступ (без власника). */
export async function listCollaborators(token: string, owner: string): Promise<Collaborator[]> {
  const res = await fetch(`${API}/repos/${owner}/${SAVES_REPO_NAME}/collaborators`, {
    headers: authHeaders(token)
  })
  if (!res.ok) return []
  const data = (await res.json()) as Array<{ login: string }>
  return data
    .filter((c) => c.login.toLowerCase() !== owner.toLowerCase())
    .map((c) => ({ login: c.login }))
}

/** Видалити репозиторій сейвів насовсім. Незворотно — підтвердження робить UI. */
export async function deleteSavesRepo(token: string, owner: string): Promise<void> {
  const res = await fetch(`${API}/repos/${owner}/${SAVES_REPO_NAME}`, {
    method: 'DELETE',
    headers: authHeaders(token)
  })
  if (res.status === 204) return
  if (res.status === 404) return // вже видалено — вважаємо успіхом
  if (res.status === 403) {
    throw makeAppError('REPO_DELETE_NO_PERMISSION')
  }
  throw makeAppError('REPO_DELETE_FAILED', { status: String(res.status) })
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

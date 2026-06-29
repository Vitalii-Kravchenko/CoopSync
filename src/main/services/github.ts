import { GITHUB_CLIENT_ID, GITHUB_SCOPE } from '../config'
import type { DeviceCodeInfo, AuthUser } from '../../shared/types'

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
    throw new Error(`GitHub відповів помилкою ${res.status} на запит device code`)
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
    throw new Error(data.error_description || data.error || 'Не вдалось завершити логін')
  }
}

/** Крок 3: дізнатись логін користувача за токеном. */
export async function fetchUser(token: string): Promise<AuthUser> {
  const res = await fetch('https://api.github.com/user', {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json'
    }
  })
  if (!res.ok) {
    throw new Error(`Не вдалось отримати дані користувача (${res.status})`)
  }
  const data = (await res.json()) as { login: string }
  return { login: data.login }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

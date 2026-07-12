import { app } from 'electron'
import { SUPPORT_ENDPOINT_URL } from '../config'
import { makeAppError } from '../../shared/errors'
import { readSettings } from './settingsStore'
import { loadToken } from './tokenStore'
import { fetchUser } from './github'
import type { SupportRequest } from '../../shared/types'

// Message length limit — matches what the Worker accepts
// (worker/support-mailer/src/index.ts), so long text doesn't get dropped
// or bloat the email.
const MAX_MESSAGE_LENGTH = 4000

/** Send a message from the "Support" button via the Worker proxy to my email. */
export async function sendSupportMessage(request: SupportRequest): Promise<void> {
  const message = request.message.trim().slice(0, MAX_MESSAGE_LENGTH)
  // For 'game-request' the message is optional (games are selected) — required for the other categories.
  if (!message && !request.games?.length) throw makeAppError('SUPPORT_SEND_FAILED')

  // Who's sending — so the email reads "Vitalii wants..." instead of the
  // generic "CoopSync wants...". If we can't determine this for some
  // reason, just skip the sender — the email still gets sent.
  const sender = await fetchSenderName()

  const res = await fetch(SUPPORT_ENDPOINT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      category: request.category,
      message,
      games: request.games,
      sender,
      // Context for diagnostics — no personal data, just version/platform.
      appVersion: app.getVersion(),
      platform: process.platform,
      language: readSettings().language
    })
  }).catch(() => null)

  if (!res) throw makeAppError('SUPPORT_SEND_FAILED')
  if (res.status === 429) {
    const body = (await res.json().catch(() => null)) as { resetAt?: number } | null
    const time = body?.resetAt ? formatTime(body.resetAt) : ''
    throw makeAppError('SUPPORT_RATE_LIMITED', { time })
  }
  if (!res.ok) throw makeAppError('SUPPORT_SEND_FAILED')
}

async function fetchSenderName(): Promise<string | undefined> {
  const token = loadToken()
  if (!token) return undefined
  try {
    const user = await fetchUser(token)
    return user.name || user.login
  } catch {
    return undefined
  }
}

/**
 * Local time in HH:MM format, rounded UP to the next minute — otherwise
 * we'd show a moment when the limit is technically still in effect (e.g.
 * resetAt at 12:00:45 would display "12:00", even though it's actually only
 * allowed from 12:01).
 */
function formatTime(epochMs: number): string {
  const d = new Date(Math.ceil(epochMs / 60000) * 60000)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

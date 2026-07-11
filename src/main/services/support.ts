import { app } from 'electron'
import { SUPPORT_ENDPOINT_URL } from '../config'
import { makeAppError } from '../../shared/errors'
import { readSettings } from './settingsStore'
import { loadToken } from './tokenStore'
import { fetchUser } from './github'
import type { SupportRequest } from '../../shared/types'

// Обмеження на довжину повідомлення — узгоджено з тим, що приймає Worker
// (worker/support-mailer/src/index.ts), щоб довгий текст не летів у нікуди
// і не роздував лист.
const MAX_MESSAGE_LENGTH = 4000

/** Надіслати звернення з кнопки "Підтримка" через Worker-проксі на пошту Віталія. */
export async function sendSupportMessage(request: SupportRequest): Promise<void> {
  const message = request.message.trim().slice(0, MAX_MESSAGE_LENGTH)
  // Для 'game-request' повідомлення необов'язкове (є обрані ігри) — для решти категорій обов'язкове.
  if (!message && !request.games?.length) throw makeAppError('SUPPORT_SEND_FAILED')

  // Хто звертається — щоб у листі було "Віталій хоче..." замість безликого
  // "CoopSync хоче...". Якщо з якоїсь причини не вдалось дізнатись — просто
  // не додаємо відправника, лист однаково піде.
  const sender = await fetchSenderName()

  const res = await fetch(SUPPORT_ENDPOINT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      category: request.category,
      message,
      games: request.games,
      sender,
      // Контекст для діагностики — не персональні дані, лише версія/платформа.
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
 * Локальний час у форматі HH:MM, округлений ВГОРУ до наступної хвилини —
 * інакше показуємо момент, коли ліміт технічно ще діє (напр. resetAt о
 * 12:00:45 показував би "12:00", хоча реально можна тільки з 12:01).
 */
function formatTime(epochMs: number): string {
  const d = new Date(Math.ceil(epochMs / 60000) * 60000)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

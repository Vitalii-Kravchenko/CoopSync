// Cloudflare Worker — приймає звернення з кнопки "Підтримка" в CoopSync і шле
// лист на пошту Віталія через Resend. Це єдине місце, де живе реальний секрет
// (RESEND_API_KEY, env-секрет Worker'а) — застосунок на комп'ютерах друзів
// стукається сюди звичайним POST без жодних кредів.

export interface Env {
  RESEND_API_KEY: string
  TO_EMAIL: string
  RATE_LIMIT: KVNamespace
}

interface SteamGame {
  appId?: string
  name?: string
  // Готове посилання від Steam search API — новіші ігри роздаються з
  // хеш-версіонованих шляхів, які неможливо зібрати самому з appId.
  imageUrl?: string
}

interface SupportPayload {
  category?: string
  message?: string
  games?: SteamGame[]
  sender?: string
  appVersion?: string
  platform?: string
  language?: string
}

const ALLOWED_CATEGORIES = new Set(['bug', 'game-request', 'idea', 'other'])
const MAX_MESSAGE_LENGTH = 4000
// Скільки ігор дозволено вибрати в одному зверненні "Хочу гру" — щоб пул
// кандидатів на майбутнє голосування не засипали за раз. Перевіряємо тут,
// а не тільки в UI застосунку, бо прямий POST в обхід застосунку теж можливий.
const MAX_GAME_REQUESTS = 3
// Скільки звернень дозволено з одного IP за вікно — щоб хтось не засипав
// пошту напряму, в обхід застосунку.
const RATE_LIMIT_MAX = 10
const RATE_LIMIT_WINDOW_SECONDS = 60 * 60

interface RateEntry {
  count: number
  /** Epoch ms, коли поточне вікно ліміту закінчується (і лічильник скидається). */
  resetAt: number
}

// Стара версія ліміту зберігала в KV просто число (лічильник) без resetAt —
// перевіряємо форму об'єкта, а не довіряємо JSON.parse наосліп, інакше запис
// зі старого формату (ще живий за TTL з попередньої версії) зламав би логіку.
function isRateEntry(value: unknown): value is RateEntry {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as RateEntry).count === 'number' &&
    typeof (value as RateEntry).resetAt === 'number'
  )
}

// Повертає resetAt завжди — щоб користувачу можна було показати, о котрій
// годині ліміт знову дозволить надсилати, навіть коли зараз дозволено.
async function checkRateLimit(env: Env, ip: string): Promise<{ allowed: boolean; resetAt: number }> {
  const key = `rl:${ip}`
  const raw = await env.RATE_LIMIT.get(key)
  const now = Date.now()

  let entry: RateEntry | null = null
  if (raw) {
    try {
      const parsed: unknown = JSON.parse(raw)
      if (isRateEntry(parsed)) entry = parsed
    } catch {
      entry = null
    }
  }
  if (!entry || entry.resetAt <= now) {
    entry = { count: 0, resetAt: now + RATE_LIMIT_WINDOW_SECONDS * 1000 }
  }

  if (entry.count >= RATE_LIMIT_MAX) {
    return { allowed: false, resetAt: entry.resetAt }
  }

  entry.count += 1
  // KV не дозволяє TTL менший за 60с — на випадок, якщо вікно от-от закінчиться.
  const ttlSeconds = Math.max(60, Math.ceil((entry.resetAt - now) / 1000))
  await env.RATE_LIMIT.put(key, JSON.stringify(entry), { expirationTtl: ttlSeconds })
  return { allowed: true, resetAt: entry.resetAt }
}

function categoryLabel(category: string): string {
  switch (category) {
    case 'bug':
      return 'Баг'
    case 'game-request':
      return 'Хоче гру'
    case 'idea':
      return 'Ідея'
    default:
      return 'Інше'
  }
}

// Максимум ігор — MAX_GAME_REQUESTS (3), тому досить форм для 1 і 2-4.
function pluralGames(n: number): string {
  return n === 1 ? `${n} гру` : `${n} ігри`
}

// Природне речення-заголовок листа — і для теми, і для тіла. sender —
// GitHub-нік/ім'я того, хто звернувся (може бути відсутнім, якщо main-процес
// не зміг його дізнатись — тоді просто "Хтось").
function actionHeadline(category: string, sender: string, games: SteamGame[]): string {
  switch (category) {
    case 'bug':
      return `${sender} знайшов баг`
    case 'game-request':
      return games.length === 1
        ? `${sender} хоче додати гру: ${games[0].name}`
        : `${sender} хоче додати ${pluralGames(games.length)}`
    case 'idea':
      return `${sender} має ідею`
    default:
      return `${sender} написав у підтримку`
  }
}

// Прибираємо переноси рядків з довільного тексту перед вставкою в заголовок
// листа (subject) — інакше можна "інʼєктнути" зайві email-заголовки.
function sanitizeHeader(value: string): string {
  return value.replace(/[\r\n]+/g, ' ').trim()
}

// Колір бейджа категорії — суто косметика в листі, узгоджено з палітрою
// застосунку (ціан/фіолет — фірмова пара, danger/warning — семантичні).
function categoryColor(category: string): { fg: string; bg: string } {
  switch (category) {
    case 'bug':
      return { fg: '#c1121f', bg: '#fde8ea' }
    case 'game-request':
      return { fg: '#5b3ec9', bg: '#efe9fd' }
    case 'idea':
      return { fg: '#0e7c82', bg: '#e2fafb' }
    default:
      return { fg: '#4a5063', bg: '#eef0f4' }
  }
}

// Текст (message/ім'я гри/sender) — недовірений ввід користувача, обов'язково
// екранувати перед вставкою в HTML листа.
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function gameBlockHtml(game: SteamGame): string {
  const posterUrl =
    game.imageUrl ?? `https://cdn.cloudflare.steamstatic.com/steam/apps/${encodeURIComponent(game.appId!)}/header.jpg`
  const safeName = escapeHtml(game.name!)
  const storeUrl = `https://store.steampowered.com/app/${encodeURIComponent(game.appId!)}`
  return `
    <div style="margin-bottom:14px;border:1px solid #e5e7eb;border-radius:10px;overflow:hidden">
      <img src="${posterUrl}" alt="${safeName}" width="460" style="width:100%;display:block">
      <div style="padding:12px 14px">
        <div style="font-family:Arial,Helvetica,sans-serif;font-size:16px;font-weight:700;color:#1a1a1a;margin-bottom:4px">${safeName}</div>
        <a href="${storeUrl}" style="font-family:Arial,Helvetica,sans-serif;font-size:12.5px;color:#5b3ec9;text-decoration:none">Переглянути в Steam →</a>
      </div>
    </div>`
}

// Підписана "цитата" коментаря — той самий прийом, що в самому застосунку
// (акцентна смужка зліва, як "The Seam" у дизайн-системі), тільки безпечними
// для email-клієнтів засобами (без градієнтів на бордері, без кастомних шрифтів).
function commentBlockHtml(message: string): string {
  if (!message) return ''
  return `
    <div style="margin-top:18px">
      <div style="font-family:'Courier New',monospace;font-size:10.5px;letter-spacing:.08em;text-transform:uppercase;color:#8a8f98;margin-bottom:6px">Коментар</div>
      <div style="padding:12px 14px;background:#f7f8fa;border-left:3px solid #36e2e8;border-radius:0 8px 8px 0;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.6;color:#3c4043;white-space:pre-wrap">${escapeHtml(message)}</div>
    </div>`
}

function buildEmailHtml(
  payload: SupportPayload,
  category: string,
  message: string,
  games: SteamGame[],
  sender: string
): string {
  const { fg, bg } = categoryColor(category)
  const badge = `<span style="display:inline-block;padding:4px 12px;border-radius:999px;font-size:12px;font-weight:700;letter-spacing:.03em;text-transform:uppercase;color:${fg};background:${bg};font-family:Arial,Helvetica,sans-serif">${categoryLabel(category)}</span>`
  const headline = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:18px;font-weight:700;color:#1a1a1a;margin:14px 0 4px">${escapeHtml(actionHeadline(category, sender, games))}</div>`
  const gamesHtml = games.length > 0 ? `<div style="margin-top:16px">${games.map(gameBlockHtml).join('')}</div>` : ''

  return `
  <div style="background:#f3f4f6;padding:32px 16px;font-family:Arial,Helvetica,sans-serif">
    <div style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e5e7eb;box-shadow:0 2px 14px rgba(20,20,30,.06)">
      <div style="height:4px;background:linear-gradient(90deg,#36e2e8,#8a6cff)"></div>
      <div style="padding:28px 32px">
        ${badge}
        ${headline}
        ${gamesHtml}
        ${commentBlockHtml(message)}
        <div style="height:1px;background:#eef0f2;margin:22px 0 16px"></div>
        <div style="font-family:'Courier New',monospace;font-size:11px;color:#8a8f98;line-height:1.7">
          CoopSync ${escapeHtml(payload.appVersion ?? '?')} · ${escapeHtml(payload.platform ?? '?')} · ${escapeHtml(payload.language ?? '?')}
        </div>
      </div>
    </div>
  </div>`
}

function buildEmailText(category: string, message: string, games: SteamGame[], sender: string): string {
  const lines = [actionHeadline(category, sender, games)]
  for (const g of games) {
    lines.push(`— ${g.name}: https://store.steampowered.com/app/${g.appId}`)
  }
  if (message) lines.push('', 'Коментар:', message)
  return lines.join('\n')
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method !== 'POST') {
      return new Response('Method not allowed', { status: 405 })
    }

    const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown'
    const { allowed, resetAt } = await checkRateLimit(env, ip)
    if (!allowed) {
      return new Response(JSON.stringify({ error: 'rate_limited', resetAt }), {
        status: 429,
        headers: { 'Content-Type': 'application/json' }
      })
    }

    let payload: SupportPayload
    try {
      payload = await request.json()
    } catch {
      return new Response(JSON.stringify({ error: 'invalid_json' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      })
    }

    const category = payload.category ?? ''
    const message = (payload.message ?? '').trim().slice(0, MAX_MESSAGE_LENGTH)
    const games = (payload.games ?? [])
      .filter((g) => !!g?.appId && !!g?.name)
      .slice(0, MAX_GAME_REQUESTS)

    const contentOk = category === 'game-request' ? games.length > 0 : !!message
    if (!ALLOWED_CATEGORIES.has(category) || !contentOk) {
      return new Response(JSON.stringify({ error: 'invalid_payload' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      })
    }

    const sender = sanitizeHeader(payload.sender ?? '') || 'Хтось'
    // Без префікса "[CoopSync]" — адреса-відправник (coopsync.support@...) і
    // так однозначно каже, звідки лист, дублювати назву в темі зайве.
    const subject = sanitizeHeader(actionHeadline(category, sender, games))

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: 'CoopSync <onboarding@resend.dev>',
        to: [env.TO_EMAIL],
        subject,
        html: buildEmailHtml(payload, category, message, games, sender),
        text: buildEmailText(category, message, games, sender)
      })
    })

    if (!res.ok) {
      return new Response(JSON.stringify({ error: 'send_failed' }), {
        status: 502,
        headers: { 'Content-Type': 'application/json' }
      })
    }

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    })
  }
}

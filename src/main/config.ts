// Конфіг застосунку.

// Client ID OAuth-застосунку GitHub. Це НЕ секрет — у device flow client_id
// публічний за дизайном (client_secret тут не використовується).
// Поки що пробуємо Client ID зі старого проекту Віталія. Якщо device flow
// для нього не ввімкнено — зареєструємо новий OAuth App для CoopSync.
export const GITHUB_CLIENT_ID = 'Ov23liThtglJqUxY4Kh0'

// Права, які запитуємо. 'repo' — щоб створювати приватні репо, пушити сейви
// і додавати друга у співавтори. 'delete_repo' — окремий скоуп, без нього
// GitHub відмовляє видаляти репозиторій навіть власнику.
// Увага: у користувачів, що вже залогінені зі старим токеном (без цього
// скоупу), кнопка "Видалити репозиторій" поверне 403 — тоді треба перелогінитись.
export const GITHUB_SCOPE = 'repo read:org delete_repo'

// Назва репозиторію для сейвів. Унікальність дає namespace (owner/назва),
// тому нік користувача в саму назву додавати не треба.
export const SAVES_REPO_NAME = 'coopsync-saves'

// Ендпоінт Cloudflare Worker, який пересилає звернення з кнопки "Підтримка"
// на пошту Віталія (через Resend). Це НЕ секрет — публічний URL, застосунок
// шле сюди лише POST з текстом звернення. Реальний секрет (ключ Resend API)
// живе тільки на самому Worker'і (env-секрет), сюди й у білд ніколи не потрапляє.
// Обмеження зловживань (rate limit) теж на боці Worker'а, не в застосунку.
export const SUPPORT_ENDPOINT_URL = 'https://coopsync-support.coopsync-support.workers.dev'

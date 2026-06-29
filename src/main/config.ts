// Конфіг застосунку.

// Client ID OAuth-застосунку GitHub. Це НЕ секрет — у device flow client_id
// публічний за дизайном (client_secret тут не використовується).
// Поки що пробуємо Client ID зі старого проекту Віталія. Якщо device flow
// для нього не ввімкнено — зареєструємо новий OAuth App для CoopSync.
export const GITHUB_CLIENT_ID = 'Ov23liThtglJqUxY4Kh0'

// Права, які запитуємо. 'repo' — щоб створювати приватні репо, пушити сейви
// і додавати друга у співавтори.
export const GITHUB_SCOPE = 'repo read:org'

// Назва репозиторію для сейвів. Унікальність дає namespace (owner/назва),
// тому нік користувача в саму назву додавати не треба.
export const SAVES_REPO_NAME = 'coopsync-saves'

// Спільні типи між main, preload і renderer.

/** Дані, які GitHub повертає для device flow — їх показуємо користувачу. */
export interface DeviceCodeInfo {
  /** Код, який користувач вводить на github.com (напр. "ABCD-1234"). */
  userCode: string
  /** Сторінка, куди йти вводити код (https://github.com/login/device). */
  verificationUri: string
  /** Скільки секунд код дійсний. */
  expiresIn: number
  /** Як часто (сек) можна опитувати GitHub про результат. */
  interval: number
}

/** Інформація про залогіненого користувача GitHub. */
export interface AuthUser {
  login: string
}

/** Поточний стан авторизації. */
export type AuthStatus =
  | { state: 'logged-out' }
  | { state: 'logged-in'; user: AuthUser }

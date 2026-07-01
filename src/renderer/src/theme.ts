// Дизайн-система CoopSync — "RIFT//SYNC" (кодова назва стилю Kinetic Edge).
// Єдине джерело кольорів/токенів для UI. Ніколи не хардкодити hex напряму в екранах.

export const colors = {
  // глибина / поверхні
  bgVoid: '#06080D',
  bgBase: '#0A0D14',
  bgSurface: '#10131C',
  bgRaised: '#171B27',
  bgOverlay: '#1E2433',
  bgInset: '#0B0E16',
  bgHover: '#1C2230',

  // межі
  borderSubtle: 'rgba(255,255,255,.06)',
  borderDefault: 'rgba(255,255,255,.10)',
  borderStrong: 'rgba(255,255,255,.16)',
  borderAccent: 'rgba(54,226,232,.45)',

  // енергетична пара
  cy: '#36E2E8',
  cyStrong: '#16C7CE',
  cyDeep: '#0B8E96',
  vi: '#8A6CFF',
  viStrong: '#6B4DF0',
  viDeep: '#4A33B8',

  // семантичні
  success: '#3FD9A6',
  successBg: 'rgba(63,217,166,.12)',
  successBd: 'rgba(63,217,166,.38)',
  warning: '#F2B14A',
  warningBg: 'rgba(242,177,74,.12)',
  warningBd: 'rgba(242,177,74,.38)',
  danger: '#FF6B7C',
  dangerBg: 'rgba(255,107,124,.12)',
  dangerBd: 'rgba(255,107,124,.40)',
  info: '#5AA9FF',
  infoBg: 'rgba(90,169,255,.12)',
  infoBd: 'rgba(90,169,255,.38)',

  // текст
  text1: '#EDF1FA',
  text2: '#B6BFD2',
  text3: '#79839A',
  textDisabled: '#474E60',
  textOnAccent: '#04141A'
} as const

export const gradients = {
  energy: 'linear-gradient(120deg,#36E2E8 0%,#5AB6F2 42%,#8A6CFF 100%)',
  energyHover: 'linear-gradient(120deg,#4cf0f6,#9a80ff)',
  energySoft: 'linear-gradient(120deg,rgba(54,226,232,.16),rgba(138,108,255,.16))'
} as const

export const radii = { sm: 5, md: 9, lg: 13, xl: 18, pill: 999 } as const

export const shadows = {
  sh1: '0 1px 2px rgba(0,0,0,.45)',
  sh2: '0 3px 10px rgba(0,0,0,.45)',
  sh3: '0 10px 28px rgba(0,0,0,.5)',
  sh4: '0 20px 52px rgba(0,0,0,.55)',
  sh5: '0 36px 90px rgba(0,0,0,.62)',
  sheen: 'inset 0 1px 0 rgba(255,255,255,.07)',
  glowCy: '0 0 22px rgba(54,226,232,.40)',
  glowVi: '0 0 22px rgba(138,108,255,.42)',
  glowEnergy: '0 0 26px rgba(54,226,232,.30), 0 0 48px rgba(138,108,255,.22)'
} as const

export const fonts = {
  display: "'Chakra Petch', sans-serif",
  body: "'Sora', system-ui, sans-serif",
  mono: "'JetBrains Mono', monospace"
} as const

/** Фірмовий кутовий зріз ("The Cut") — тільки для CTA й ключових поверхонь, не всюди. */
export function cutClip(px = 10): string {
  return `polygon(0 0, calc(100% - ${px}px) 0, 100% ${px}px, 100% 100%, ${px}px 100%, 0 calc(100% - ${px}px))`
}

/** URL вертикального постера гри зі Steam (2:3). */
export function steamPoster(appId: string): string {
  return `https://cdn.cloudflare.steamstatic.com/steam/apps/${appId}/library_600x900.jpg`
}

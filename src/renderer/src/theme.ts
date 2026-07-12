// CoopSync design system — "RIFT//SYNC" (code name for the Kinetic Edge style).
// The single source of colors/tokens for the UI. Never hardcode hex values directly in screens.

export const colors = {
  // depth / surfaces
  bgVoid: '#06080D',
  bgBase: '#0A0D14',
  bgSurface: '#10131C',
  bgRaised: '#171B27',
  bgOverlay: '#1E2433',
  bgInset: '#0B0E16',
  bgHover: '#1C2230',

  // borders
  borderSubtle: 'rgba(255,255,255,.06)',
  borderDefault: 'rgba(255,255,255,.10)',
  borderStrong: 'rgba(255,255,255,.16)',
  borderAccent: 'rgba(54,226,232,.45)',

  // energy pair
  cy: '#36E2E8',
  cyStrong: '#16C7CE',
  cyDeep: '#0B8E96',
  vi: '#8A6CFF',
  viStrong: '#6B4DF0',
  viDeep: '#4A33B8',

  // semantic
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

  // text
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

/**
 * Consistent transition durations — so effects of the same kind move the same
 * way across the whole app, instead of drifting apart on their own (.12s/.15s/.18s at random).
 * Values are duplicated as CSS variables in index.css (--t-fast/--t-hover/--t-fade) —
 * change both places together.
 */
export const transitions = {
  /** Instant color/background change with no motion (nav items, window buttons, table rows). */
  fast: '120ms ease',
  /** Hover highlight (border/shadow/background of cards, buttons, toggles, inputs). */
  hover: '150ms ease',
  /** Overlays appearing/disappearing (game card hover overlay). */
  fade: '200ms ease'
} as const

/** Brand corner cut ("The Cut") — only for CTAs and key surfaces, not everywhere. */
export function cutClip(px = 10): string {
  return `polygon(0 0, calc(100% - ${px}px) 0, 100% ${px}px, 100% 100%, ${px}px 100%, 0 calc(100% - ${px}px))`
}

// Chromium caches <img> on disk for essentially the whole local session
// (the app never reloads the page), so without changing the URL itself, a new
// CDN cover would never get picked up, even after Steam updates it.
// fetch() with cache:'no-cache' doesn't work here — cross-origin fetch requests
// are subject to CORS (unlike <img src>), and the CDN doesn't send the required
// headers, so the request just fails. The cache-buster instead changes once per
// renderer process start (not persisted) — this guarantees that every time
// CoopSync launches it pulls a fresh version from the CDN, with no CORS issues.
const POSTER_CACHE_BUST = Date.now()

/** URL of the vertical game poster from Steam (2:3). */
export function steamPoster(appId: string): string {
  return `https://cdn.cloudflare.steamstatic.com/steam/apps/${appId}/library_600x900.jpg?v=${POSTER_CACHE_BUST}`
}

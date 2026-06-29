// Палітра CoopSync (Catppuccin Mocha). Єдине джерело кольорів для UI.
export const colors = {
  bg: '#1e1e2e',
  bgDark: '#181825',
  bgDarker: '#11111b',
  surface: '#313244',
  border: '#45475a',
  accent: '#89b4fa',
  accentHover: '#a6c8ff',
  success: '#a6e3a1',
  warning: '#f9e2af',
  error: '#f38ba8',
  text: '#e8e8e8',
  muted: '#9399b2'
} as const

/** URL вертикального постера гри зі Steam (3:4). */
export function steamPoster(appId: string): string {
  return `https://cdn.cloudflare.steamstatic.com/steam/apps/${appId}/library_600x900.jpg`
}

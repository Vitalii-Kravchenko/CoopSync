// Невеликі SVG-іконки, які переюзуємо в UI. Лінійний стиль (stroke ~1.7) —
// узгоджено з дизайн-системою RIFT//SYNC.

export function GitHubIcon({ size = 16, color = '#cdd6f4' }: { size?: number; color?: string }): React.JSX.Element {
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} fill={color}>
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
    </svg>
  )
}

interface IconProps {
  size?: number
  color?: string
}

// Лого CoopSync: два кола (двоє друзів), що перетинаються, на темному тлі з
// фірмовою зрізаною фаскою (The Cut). Та сама форма, що й в іконці застосунку
// та треї (build/logo.svg, src/main/trayIcon.ts) — тримати проміжний колір
// перетину #5AB6F2 синхронним, якщо міняти градієнт.
export function Logo({ size = 24 }: { size?: number }): React.JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="logoBg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#171B27" />
          <stop offset="1" stopColor="#06080D" />
        </linearGradient>
        <clipPath id="logoLeftClip">
          <circle cx="36" cy="50" r="23" />
        </clipPath>
      </defs>
      <path d="M0,0 L82,0 L100,18 L100,100 L18,100 L0,82 Z" fill="url(#logoBg)" />
      <circle cx="36" cy="50" r="23" fill="#36E2E8" />
      <circle cx="64" cy="50" r="23" fill="#8A6CFF" />
      <circle cx="64" cy="50" r="23" fill="#5AB6F2" clipPath="url(#logoLeftClip)" />
    </svg>
  )
}

function base(size: number): React.SVGProps<SVGSVGElement> {
  return {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.7,
    strokeLinecap: 'round',
    strokeLinejoin: 'round'
  }
}

export function LibraryIcon({ size = 16, color }: IconProps): React.JSX.Element {
  return (
    <svg {...base(size)} style={{ color }}>
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
    </svg>
  )
}

export function SettingsIcon({ size = 16, color }: IconProps): React.JSX.Element {
  return (
    <svg {...base(size)} style={{ color }}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  )
}

export function SyncIcon({ size = 16, color }: IconProps): React.JSX.Element {
  return (
    <svg {...base(size)} style={{ color }}>
      <path d="M21 12a9 9 0 1 1-6.2-8.5" />
      <polyline points="21 4 21 10 15 10" />
    </svg>
  )
}

export function UploadIcon({ size = 16, color }: IconProps): React.JSX.Element {
  return (
    <svg {...base(size)} style={{ color }}>
      <path d="M12 19V5M5 12l7-7 7 7" />
    </svg>
  )
}

export function DownloadIcon({ size = 16, color }: IconProps): React.JSX.Element {
  return (
    <svg {...base(size)} style={{ color }}>
      <path d="M12 5v14M5 12l7 7 7-7" />
    </svg>
  )
}

export function SearchIcon({ size = 16, color }: IconProps): React.JSX.Element {
  return (
    <svg {...base(size)} style={{ color }}>
      <circle cx="11" cy="11" r="7" />
      <path d="m21 21-4.3-4.3" />
    </svg>
  )
}

export function CheckIcon({ size = 16, color }: IconProps): React.JSX.Element {
  return (
    <svg {...base(size)} style={{ color }}>
      <polyline points="20 6 9 17 4 12" />
    </svg>
  )
}

export function CrownIcon({ size = 16, color }: IconProps): React.JSX.Element {
  return (
    <svg {...base(size)} style={{ color }}>
      <path d="M4 18h16l1.4-9-5.1 3.2L12 6l-4.3 6.2L2.6 9 4 18Z" />
      <path d="M5 21h14" />
    </svg>
  )
}

export function CloseIcon({ size = 16, color }: IconProps): React.JSX.Element {
  return (
    <svg {...base(size)} style={{ color }}>
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  )
}

// Іконка "Друзі" для бічного меню — той самий силует, що й у дизайн-системі
// (docs/design-system.html, 4.12 Навігація): один більший силует + один менший.
export function FriendsIcon({ size = 16, color }: IconProps): React.JSX.Element {
  return (
    <svg {...base(size)} style={{ color }}>
      <circle cx="9" cy="7" r="4" />
      <path d="M2 21v-2a4 4 0 0 1 4-4h6a4 4 0 0 1 4 4v2" />
      <circle cx="18" cy="8" r="2.5" />
    </svg>
  )
}

export function HistoryIcon({ size = 16, color }: IconProps): React.JSX.Element {
  return (
    <svg {...base(size)} style={{ color }}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3.5 2" />
    </svg>
  )
}

export function DiskIcon({ size = 16, color }: IconProps): React.JSX.Element {
  return (
    <svg {...base(size)} style={{ color }}>
      <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2Z" />
      <polyline points="17 21 17 13 7 13 7 21" />
      <polyline points="7 3 7 8 15 8" />
    </svg>
  )
}

export function UsersIcon({ size = 16, color }: IconProps): React.JSX.Element {
  return (
    <svg {...base(size)} style={{ color }}>
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  )
}

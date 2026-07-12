import { colors } from '../theme'
import { GitHubIcon } from './icons'

interface Props {
  /** Фото (реальний аватар з GitHub / кастомний). Falsy → іконка GitHub. */
  src?: string | null
  size?: number
}

// Один компонент для TitleBar/Settings/Onboarding/Friends — раніше кожне
// місце малювало заглушку по-своєму (десь іконка GitHub, десь монограма),
// і це виглядало як різні системи в одному застосунку.
function Avatar({ src, size = 30 }: Props): React.JSX.Element {
  const base: React.CSSProperties = {
    width: size,
    height: size,
    borderRadius: '50%',
    border: `1px solid ${colors.borderDefault}`,
    flexShrink: 0,
    overflow: 'hidden'
  }

  if (src) {
    return <img src={src} alt="" style={{ ...base, objectFit: 'cover' }} />
  }

  return (
    <div
      style={{
        ...base,
        background: colors.bgInset,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center'
      }}
    >
      <GitHubIcon size={Math.round(size * 0.55)} />
    </div>
  )
}

export default Avatar

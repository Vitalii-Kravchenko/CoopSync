import { colors } from '../theme'
import { GitHubIcon } from './icons'

interface Props {
  /** Photo (real GitHub avatar / custom). Falsy -> GitHub icon. */
  src?: string | null
  size?: number
}

// A single component for TitleBar/Settings/Onboarding/Friends — previously each
// spot drew its own placeholder (a GitHub icon here, a monogram there),
// and it looked like different systems within one app.
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

import { useState } from 'react'
import { colors, radii } from '../theme'
import { LibraryIcon } from './icons'

interface Props {
  appId: string
  /** Ready-made horizontal image URL (tiny_image from the Steam search
   *  API) — a fallback at the end of the chain, not first: most games
   *  HAVE a vertical poster (the same one used elsewhere in the app), and we
   *  always try that first — the horizontal one only rescues brand-new games
   *  for which a vertical poster doesn't exist yet (e.g. Black Ops 7 at launch). */
  imageUrl?: string
  alt?: string
  style?: React.CSSProperties
}

// Not every game on Steam has a 600x900 poster (especially brand-new, not yet
// released games) — try the "correct" vertical one first, then
// standard sizes in order, and only as a last resort the ready-made horizontal
// URL from Steam search. If there's nothing at all — a placeholder instead of a
// broken image (the same pattern as the "placeholder" avatar in the
// design system, 4.8 Avatars).
function posterUrls(appId: string, imageUrl?: string): string[] {
  const base = `https://cdn.cloudflare.steamstatic.com/steam/apps/${encodeURIComponent(appId)}`
  const chain = [`${base}/library_600x900.jpg`, `${base}/header.jpg`, `${base}/capsule_231x87.jpg`]
  return imageUrl ? [...chain, imageUrl] : chain
}

function GamePoster({ appId, imageUrl, alt = '', style }: Props): React.JSX.Element {
  const [attempt, setAttempt] = useState(0)
  const urls = posterUrls(appId, imageUrl)

  if (attempt >= urls.length) {
    return (
      <div
        style={{
          ...style,
          background: colors.bgRaised,
          border: `1px solid ${colors.borderDefault}`,
          borderRadius: style?.borderRadius ?? radii.sm,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: colors.text3
        }}
      >
        <LibraryIcon size={14} />
      </div>
    )
  }

  return (
    <img
      src={urls[attempt]}
      alt={alt}
      style={style}
      onError={() => setAttempt((a) => a + 1)}
    />
  )
}

export default GamePoster

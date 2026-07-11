import { useState } from 'react'
import { colors, radii } from '../theme'
import { LibraryIcon } from './icons'

interface Props {
  appId: string
  /** Готове горизонтальне посилання на картинку (tiny_image зі Steam search
   *  API) — резервний варіант в кінці ланцюжка, не першим: більшість ігор
   *  МАЄ вертикальний постер (той самий, що й в решті застосунку), і його
   *  завжди пробуємо першим — горизонтальне лише рятує зовсім нові ігри,
   *  для яких вертикального ще не існує (напр. Black Ops 7 на релізі). */
  imageUrl?: string
  alt?: string
  style?: React.CSSProperties
}

// Не в кожної гри в Steam є постер 600x900 (особливо зовсім нові, ще не
// випущені ігри) — пробуємо спершу "правильний" вертикальний, потім
// стандартні розміри по черзі, і лише насамкінець — готове горизонтальне
// посилання від Steam-пошуку. Якщо взагалі нічого нема — заглушка замість
// поламаної картинки (той самий патерн, що й "заглушка"-аватар у
// дизайн-системі, 4.8 Аватари).
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

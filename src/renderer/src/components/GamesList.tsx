import { useEffect, useState } from 'react'
import type { DetectedGame } from '../../../shared/types'

function GamesList(): React.JSX.Element {
  const [games, setGames] = useState<DetectedGame[] | null>(null) // null = завантаження

  useEffect(() => {
    window.api.games.list().then(setGames)
  }, [])

  return (
    <div style={styles.box}>
      <h2 style={styles.heading}>Ігри</h2>

      {games === null && <p style={styles.muted}>Шукаю встановлені ігри…</p>}

      {games !== null && games.length === 0 && (
        <p style={styles.muted}>Підтримуваних ігор не знайдено.</p>
      )}

      {games !== null && games.length > 0 && (
        <ul style={styles.list}>
          {games.map((game) => (
            <li key={game.appId} style={styles.item}>
              <span>🎮 {game.name}</span>
              <span style={game.saveFound ? styles.ok : styles.warn}>
                {game.saveFound ? '✅ сейви знайдено' : '⚠️ папка сейвів не знайдена'}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  box: {
    marginTop: 28,
    paddingTop: 20,
    borderTop: '1px solid #313244',
    width: 420,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 8
  },
  heading: { margin: 0, fontSize: 20 },
  muted: { opacity: 0.7, margin: '4px 0' },
  list: { listStyle: 'none', padding: 0, margin: 0, width: '100%' },
  item: {
    display: 'flex',
    justifyContent: 'space-between',
    padding: '6px 0',
    borderBottom: '1px solid #313244'
  },
  ok: { color: '#a6e3a1', fontSize: 13 },
  warn: { color: '#f9e2af', fontSize: 13 }
}

export default GamesList

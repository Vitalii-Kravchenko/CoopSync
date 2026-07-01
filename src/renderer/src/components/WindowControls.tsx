import { useEffect, useState } from 'react'

// Кнопки керування вікном. Іконка середньої кнопки міняється:
// ▢ — розгорнути, ❐ — відновити (коли вікно вже на весь екран).
function WindowControls(): React.JSX.Element {
  const [maximized, setMaximized] = useState(false)

  useEffect(() => {
    window.api.window.isMaximized().then(setMaximized)
    return window.api.window.onMaximizeChange(setMaximized)
  }, [])

  return (
    <div style={{ display: 'flex', height: '100%' }}>
      <button className="win-ctrl" title="Згорнути" onClick={() => window.api.window.minimize()}>
        —
      </button>
      <button
        className="win-ctrl"
        title={maximized ? 'Відновити' : 'Розгорнути'}
        onClick={() => window.api.window.toggleMaximize()}
      >
        {maximized ? '❐' : '▢'}
      </button>
      <button
        className="win-ctrl win-close"
        title="Закрити"
        onClick={() => window.api.window.close()}
      >
        ✕
      </button>
    </div>
  )
}

export default WindowControls

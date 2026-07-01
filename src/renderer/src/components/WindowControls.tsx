import { useEffect, useState } from 'react'
import { useI18n } from '../i18n'

// Кнопки керування вікном. Іконка середньої кнопки міняється:
// ▢ — розгорнути, ❐ — відновити (коли вікно вже на весь екран).
function WindowControls(): React.JSX.Element {
  const { t } = useI18n()
  const [maximized, setMaximized] = useState(false)

  useEffect(() => {
    window.api.window.isMaximized().then(setMaximized)
    return window.api.window.onMaximizeChange(setMaximized)
  }, [])

  return (
    <div style={{ display: 'flex', height: '100%' }}>
      <button className="win-ctrl" title={t.windowControls.minimize} onClick={() => window.api.window.minimize()}>
        —
      </button>
      <button
        className="win-ctrl"
        title={maximized ? t.windowControls.restore : t.windowControls.maximize}
        onClick={() => window.api.window.toggleMaximize()}
      >
        {maximized ? '❐' : '▢'}
      </button>
      <button
        className="win-ctrl win-close"
        title={t.windowControls.close}
        onClick={() => window.api.window.close()}
      >
        ✕
      </button>
    </div>
  )
}

export default WindowControls

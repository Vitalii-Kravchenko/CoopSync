import React from 'react'
import ReactDOM from 'react-dom/client'
import ToastStack from './toast/ToastStack'
import './toast/toast.css'

ReactDOM.createRoot(document.getElementById('toast-root') as HTMLElement).render(
  <React.StrictMode>
    <ToastStack />
  </React.StrictMode>
)

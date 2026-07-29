import type { ToastApi } from './toast'

declare global {
  interface Window {
    toastApi: ToastApi
  }
}

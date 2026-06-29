import type { CoopSyncApi } from './index'

declare global {
  interface Window {
    api: CoopSyncApi
  }
}

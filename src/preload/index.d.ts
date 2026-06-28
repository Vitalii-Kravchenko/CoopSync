// Опис того, що preload прокидає у вікно (window.api).
// Поки порожньо — розширимо разом із логікою синку.
export interface CoopSyncApi {}

declare global {
  interface Window {
    api: CoopSyncApi
  }
}

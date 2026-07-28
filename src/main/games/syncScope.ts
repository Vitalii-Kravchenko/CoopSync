import { readSettings, writeSettings } from '../services/settingsStore'

// Per-game "only for me / for me and friends" toggle — applies uniformly to
// ANY game (built-in catalog or custom), see settingsStore.ts's
// personalGameIds doc comment and sync.ts's personalLoginFor (the actual
// sync-path routing this drives).

export function isGamePersonal(appId: string): boolean {
  return (readSettings().personalGameIds ?? []).includes(appId)
}

export function setGamePersonal(appId: string, personal: boolean): void {
  const current = readSettings().personalGameIds ?? []
  const has = current.includes(appId)
  if (personal === has) return
  writeSettings({
    personalGameIds: personal ? [...current, appId] : current.filter((id) => id !== appId)
  })
}

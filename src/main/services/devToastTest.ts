import { BrowserWindow } from 'electron'
import { showToast, dismissToastsOfKind } from './toastWindow'
import type { ToastKind, UpdateStatus } from '../../shared/types'

// TEMPORARY — visual QA only, fires every toast kind once, 6s apart, so all
// nine can be eyeballed against the reviewed design without waiting for the
// real events (they'll overlap in the stack a little since each lives 8s —
// see ToastCard's DURATION_MS — that's fine, it doubles as a stacking
// check). Called from index.ts ONLY when !app.isPackaged (dev builds). Safe
// to delete this whole file (and its one call site) once confirmed.
const SEQUENCE: Array<{ kind: ToastKind; params: Record<string, string> }> = [
  { kind: 'save-uploaded', params: { login: 'Yuliia', game: 'Stardew Valley', version: '1.042' } },
  { kind: 'update-available', params: { version: '2.5.0' } },
  { kind: 'new-games', params: { names: 'Subnautica 2, Core Keeper' } },
  { kind: 'friend-accepted', params: { login: 'Nova_K' } },
  { kind: 'friend-declined', params: { login: 'Nova_K' } },
  { kind: 'sync-conflict-skipped', params: { game: "Baldur's Gate 3" } },
  { kind: 'access-revoked', params: { host: 'Nova_K' } },
  { kind: 'game-removed', params: { game: 'Core Keeper', appId: 'test-appid-1' } },
  {
    kind: 'folder-removed',
    params: { game: 'Core Keeper', folder: 'Screenshots', appId: 'test-appid-1', folderId: 'test-folder-1' }
  }
]

export function scheduleDevToastTest(): void {
  SEQUENCE.forEach((entry, i) => {
    setTimeout(() => showToast(entry.kind, entry.params), (i + 1) * 6000)
  })
}

// Fakes the exact same 'updater:status' broadcast updater.ts's real send()
// does — every window (main's banner + the toast) reflects it exactly as it
// would for a genuine autoUpdater event.
function sendFakeUpdateStatus(status: UpdateStatus): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('updater:status', status)
  }
}

// TEMPORARY — visual QA for the update-available toast's live tracking
// (2026-07-30). Real electron-updater can't produce this in a dev build —
// checkForUpdates()/downloadUpdate() both no-op unless app.isPackaged (see
// updater.ts) — so this is the only way to eyeball the
// available -> downloading -> downloaded transition (and its longer
// READY_DURATION_MS timer) without a real packaged release. Called from
// index.ts ONLY when !app.isPackaged, same as scheduleDevToastTest. Safe to
// delete this whole function once confirmed.
export function scheduleUpdateFlowTest(): void {
  // Scenario 1 (starts at 30s, after scheduleDevToastTest's own
  // update-available toast at 12s has long since dismissed): the download
  // starts from the toast's OWN button while away from the app — it should
  // stay open, show progress, then switch to "Install" with the long timer.
  const v1 = '2.5.0'
  setTimeout(() => showToast('update-available', { version: v1 }), 30_000)
  setTimeout(() => sendFakeUpdateStatus({ state: 'downloading', percent: 25 }), 34_000)
  setTimeout(() => sendFakeUpdateStatus({ state: 'downloading', percent: 55 }), 36_000)
  setTimeout(() => sendFakeUpdateStatus({ state: 'downloading', percent: 85 }), 38_000)
  setTimeout(() => sendFakeUpdateStatus({ state: 'downloaded', version: v1 }), 40_000)

  // Scenario 2 (starts at 110s — well clear of scenario 1's own 60s "ready
  // to install" window either way it went): the download instead starts
  // from a DIFFERENT surface (Settings/the Games-tab banner) — exactly what
  // updater.ts's downloadUpdate('ui') calls dismissToastsOfKind for. This
  // toast should just vanish, never showing a downloading state at all.
  const v2 = '2.6.0'
  setTimeout(() => showToast('update-available', { version: v2 }), 110_000)
  setTimeout(() => dismissToastsOfKind('update-available'), 114_000)
}

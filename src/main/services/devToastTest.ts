import { showToast } from './toastWindow'
import type { ToastKind } from '../../shared/types'

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

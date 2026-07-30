import { existsSync, readFileSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'

import type { CloudSyncProvider } from '../../shared/types'

// Some players' save folders already sit inside a OneDrive/Dropbox-synced
// folder (Windows enrolls "Documents" into OneDrive by default on plenty of
// PCs, without the user ever choosing that). If CoopSync's own git-based sync
// also watches that same folder, the two syncs can race — OneDrive in
// particular ships Files-on-Demand placeholder files that read as "present"
// on disk but aren't actually downloaded yet, so a read at the wrong moment
// returns garbage. Detecting the overlap lets us warn instead of silently
// shipping a corrupted save.

function normalize(path: string): string {
  return path.replace(/\\/g, '/').toLowerCase().replace(/\/+$/, '')
}

function isInside(path: string, root: string): boolean {
  const p = normalize(path)
  const r = normalize(root)
  return r.length > 0 && (p === r || p.startsWith(r + '/'))
}

function getOneDriveRoots(): string[] {
  return [process.env.OneDrive, process.env.OneDriveConsumer, process.env.OneDriveCommercial].filter(
    (root): root is string => Boolean(root)
  )
}

// Dropbox has no env var pointing at its sync folder — its actual location
// (which the user can move) is recorded in %APPDATA%\Dropbox\info.json as
// { personal: { path }, business: { path } }. Fall back to the conventional
// ~\Dropbox if that file is missing or unreadable (e.g. a very old/new
// Dropbox version that changed the format) rather than detecting nothing.
function getDropboxRoots(): string[] {
  const roots: string[] = []
  try {
    const infoPath = join(process.env.APPDATA ?? '', 'Dropbox', 'info.json')
    const info = JSON.parse(readFileSync(infoPath, 'utf8')) as Record<string, { path?: string } | undefined>
    for (const entry of Object.values(info)) {
      if (entry?.path) roots.push(entry.path)
    }
  } catch {
    // Not installed, never signed in, or an unreadable/unexpected file — fall through.
  }
  if (roots.length === 0) {
    const fallback = join(homedir(), 'Dropbox')
    if (existsSync(fallback)) roots.push(fallback)
  }
  return roots
}

/** Which cloud-sync client (if any) is already syncing this absolute path.
 *  null = not inside a known OneDrive/Dropbox root. */
export function detectCloudSyncProvider(absolutePath: string): CloudSyncProvider | null {
  if (!absolutePath) return null
  if (getOneDriveRoots().some((root) => isInside(absolutePath, root))) return 'onedrive'
  if (getDropboxRoots().some((root) => isInside(absolutePath, root))) return 'dropbox'
  return null
}

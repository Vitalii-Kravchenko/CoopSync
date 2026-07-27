import { app } from 'electron'
import { join } from 'path'
import { appendFileSync, existsSync, statSync, truncateSync } from 'fs'

// A tiny persistent log file (userData/coopsync.log) — console.log in a
// packaged Electron app goes nowhere (no terminal attached), so the only way
// to actually look back at what happened during a background auto-sync
// (e.g. a "local save outdated" report) is a file written as it happens.

function logPath(): string {
  return join(app.getPath('userData'), 'coopsync.log')
}

// Cap so a long-lived tray session can't grow this forever — truncates back
// to empty rather than trying to keep a rolling tail (this is a debug aid,
// not an audit log; losing old entries once it's already this big is fine).
const MAX_BYTES = 2 * 1024 * 1024

export function log(message: string): void {
  const line = `${new Date().toISOString()} ${message}\n`
  // eslint-disable-next-line no-console
  console.log(line.trimEnd())
  try {
    const p = logPath()
    if (existsSync(p) && statSync(p).size > MAX_BYTES) truncateSync(p, 0)
    appendFileSync(p, line)
  } catch {
    // Best-effort — logging itself must never be why something else breaks.
  }
}

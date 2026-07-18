import { app } from 'electron'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'

// Per-game bookkeeping for the "friend uploaded a new save" feature:
// - seen: the remote version the local user has actually looked at (Games
//   tab open / statuses reloaded) — drives the Games nav badge.
// - notified: the remote version we already fired an OS notification for —
//   separate from `seen` so the badge can stay up until the user actually
//   looks, while the toast still only fires once per new version.
interface Entry {
  seen: number
  notified: number
}

type State = Record<string, Entry>

function statePath(): string {
  return join(app.getPath('userData'), 'notify-state.json')
}

let cache: State | null = null

function load(): State {
  if (cache) return cache
  try {
    const raw = readFileSync(statePath(), 'utf8').replace(/^﻿/, '')
    cache = JSON.parse(raw) as State
  } catch {
    cache = {}
  }
  return cache
}

function persist(): void {
  if (!cache) return
  writeFileSync(statePath(), JSON.stringify(cache, null, 2))
}

function entry(appId: string): Entry {
  const state = load()
  return state[appId] ?? { seen: 0, notified: 0 }
}

/** Mark a version as seen by the local user (clears the nav badge for it).
 * Also bumps `notified` — if the user already saw it there's no point
 * toasting about it too. */
export function markSeen(appId: string, version: number): void {
  const state = load()
  const e = entry(appId)
  if (version <= e.seen && version <= e.notified) return
  state[appId] = { seen: Math.max(e.seen, version), notified: Math.max(e.notified, version) }
  persist()
}

/** Mark a version as already toasted about, without touching `seen` (used
 * right after the background poll fires a notification). */
export function markNotified(appId: string, version: number): void {
  const state = load()
  const e = entry(appId)
  if (version <= e.notified) return
  state[appId] = { ...e, notified: Math.max(e.notified, version) }
  persist()
}

export function getSeen(appId: string): number {
  return entry(appId).seen
}

export function getNotified(appId: string): number {
  return entry(appId).notified
}

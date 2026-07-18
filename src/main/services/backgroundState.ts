import { app } from 'electron'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'

// Baselines the background checks (watcher.ts) diff against to notice a
// *change* worth a bell notification — new games in the catalog, an
// invitation that got accepted/declined, whether a 'join' member still has
// access. Separate from notifyState.ts (which tracks per-game save
// versions) — this is about the catalog/social side, not saves.
interface State {
  /** appIds in READY_GAMES the last time we checked — undefined until the
   *  first check ever runs (see checkNewGames: that first run only seeds
   *  this, it doesn't notify about the whole initial catalog as "new"). */
  knownGameIds?: string[]
  /** Logins with a not-yet-accepted invite, as of the last host-side check. */
  knownPending?: string[]
  /** Logins with accepted access, as of the last host-side check. */
  knownCollaborators?: string[]
  /** Whether a 'join' member could reach the host's repo last time we checked. */
  hadAccess?: boolean
}

function statePath(): string {
  return join(app.getPath('userData'), 'background-state.json')
}

let cache: State | null = null

function load(): State {
  if (cache) return cache
  try {
    if (!existsSync(statePath())) {
      cache = {}
      return cache
    }
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

export function getKnownGameIds(): string[] | undefined {
  return load().knownGameIds
}

export function setKnownGameIds(ids: string[]): void {
  load().knownGameIds = ids
  persist()
}

export function getKnownPending(): string[] | undefined {
  return load().knownPending
}

export function getKnownCollaborators(): string[] | undefined {
  return load().knownCollaborators
}

export function setKnownFriendState(pending: string[], collaborators: string[]): void {
  const s = load()
  s.knownPending = pending
  s.knownCollaborators = collaborators
  persist()
}

// Called right after the owner cancels an invitation themselves — removes it
// from the pending baseline immediately, so the next background check
// doesn't mistake "I cancelled it" for "they declined it".
export function forgetPending(login: string): void {
  const s = load()
  if (!s.knownPending) return
  s.knownPending = s.knownPending.filter((l) => l !== login)
  persist()
}

export function getHadAccess(): boolean | undefined {
  return load().hadAccess
}

export function setHadAccess(value: boolean): void {
  load().hadAccess = value
  persist()
}

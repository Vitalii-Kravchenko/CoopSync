import { app } from 'electron'
import { readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { notifyGameConfirmed } from './presenceService'

// Confirmation loop for games flagged `experimental` in catalog.ts (see its
// SupportedGame.experimental doc comment and ROADMAP.md's "Петля
// підтвердження"). After a real exit-time sync succeeds for an experimental
// game, watcher.ts shows a toast asking "did it work?" — this file owns the
// state that decides WHETHER to ask and what an answer means.
//
// Only an EXPLICIT answer (button click) ever touches this state. A toast
// that times out or gets ignored calls neither recordAnswer below nor
// anything else here — ToastStack's onDismiss (the timeout/ignore path) is
// wired to nothing but removing the card from the screen. That's the fix for
// a real bug Vitalii flagged (2026-07-30): an unanswered toast must NOT
// count as a "no" and must NOT reset progress toward the 3-in-a-row streak —
// it simply never happened, and the same question is asked again next launch.

interface Entry {
  /** Consecutive explicit "так" answers for this game, THIS install. Reset
   *  to 0 only by an explicit "є проблеми" answer — never by an ignored/
   *  timed-out toast (see this file's own doc comment above). */
  consecutiveYes: number
  /** True once this user has been counted server-side (3rd consecutive
   *  "так") — after this, shouldPrompt always returns false for this game;
   *  there's nothing left to ask. */
  submitted: boolean
}

type State = Record<string, Entry>

const CONFIRMATIONS_NEEDED = 3

function statePath(): string {
  return join(app.getPath('userData'), 'experimental-confirm.json')
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
  return load()[appId] ?? { consecutiveYes: 0, submitted: false }
}

// Shown-this-launch guard — in-memory only, deliberately never persisted:
// resets every app restart, so a user who ignored the toast last session
// gets asked again this session instead of being silently skipped forever.
// This is what actually implements "at most once per launch" (watcher.ts
// only ever calls markShown after actually deciding to show one).
const shownThisSession = new Set<string>()

export function shouldPromptExperimental(appId: string): boolean {
  if (shownThisSession.has(appId)) return false
  return !entry(appId).submitted
}

export function markExperimentalPromptShown(appId: string): void {
  shownThisSession.add(appId)
}

/** actor — this device's own GitHub login, forwarded to
 *  presenceService.notifyGameConfirmed only on the 3rd consecutive "так"
 *  (the server dedups per-user itself too — see CoopSync-Server's
 *  gameConfirmations.ts — this just avoids sending redundant traffic on
 *  every single "так" before the streak is actually complete). */
export function recordExperimentalAnswer(appId: string, answer: 'yes' | 'no'): void {
  const state = load()
  const e = entry(appId)
  if (e.submitted) return // nothing left to record — already counted server-side

  if (answer === 'no') {
    state[appId] = { consecutiveYes: 0, submitted: false }
    persist()
    return
  }

  const consecutiveYes = e.consecutiveYes + 1
  if (consecutiveYes >= CONFIRMATIONS_NEEDED) {
    state[appId] = { consecutiveYes, submitted: true }
    persist()
    notifyGameConfirmed(appId)
  } else {
    state[appId] = { consecutiveYes, submitted: false }
    persist()
  }
}

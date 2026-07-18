import { app, BrowserWindow } from 'electron'
import { randomUUID } from 'crypto'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import type { AppNotification, AppNotificationKind } from '../../shared/types'

// The notification bell's persisted history — unlike the transient sync
// toast/banner, these survive a restart and stay until the user reads/clears
// them. Capped so the file (and the panel) don't grow forever.
const MAX_NOTIFICATIONS = 30

function storePath(): string {
  return join(app.getPath('userData'), 'notifications.json')
}

let cache: AppNotification[] | null = null

function load(): AppNotification[] {
  if (cache) return cache
  try {
    if (!existsSync(storePath())) {
      cache = []
      return cache
    }
    const raw = readFileSync(storePath(), 'utf8').replace(/^﻿/, '')
    cache = JSON.parse(raw) as AppNotification[]
  } catch {
    cache = []
  }
  return cache
}

function persist(): void {
  if (!cache) return
  writeFileSync(storePath(), JSON.stringify(cache, null, 2))
}

// Broadcasts the current list to every window — same pattern as
// updater.ts's send(): a single-window app, so "all windows" is simplest.
function broadcast(): void {
  const list = load()
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('notifications:changed', list)
  }
}

export function getNotifications(): AppNotification[] {
  return load()
}

export function addNotification(kind: AppNotificationKind, params: Record<string, string>): void {
  const list = load()
  list.unshift({ id: randomUUID(), kind, createdAt: new Date().toISOString(), read: false, params })
  list.length = Math.min(list.length, MAX_NOTIFICATIONS)
  persist()
  broadcast()
}

export function markRead(ids: string[]): void {
  const set = new Set(ids)
  const list = load()
  let changed = false
  for (const n of list) {
    if (set.has(n.id) && !n.read) {
      n.read = true
      changed = true
    }
  }
  if (changed) {
    persist()
    broadcast()
  }
}

export function markAllRead(): void {
  const list = load()
  let changed = false
  for (const n of list) {
    if (!n.read) {
      n.read = true
      changed = true
    }
  }
  if (changed) {
    persist()
    broadcast()
  }
}

export function clearAll(): void {
  cache = []
  persist()
  broadcast()
}

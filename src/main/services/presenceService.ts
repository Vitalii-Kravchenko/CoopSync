import { SIGNALING_URL } from '../config'
import { log } from './logger'
import type { PresenceConnectionState } from '../../shared/types'

// Thin WebSocket client for coopsync-server (D:\Projects\CoopSync-Server,
// see its protocol.ts). A progressive enhancement (ROADMAP.md §1) — the app
// works fully without ever connecting here. Runs entirely in the MAIN
// process (never renderer — a minimized/backgrounded renderer throttles
// timers, which would silently kill the heartbeat and reconnect logic).
//
// Uses the global WebSocket built into Node (stable since Node 22, which
// Electron 42 bundles) — deliberately not the 'ws' package, to avoid adding
// a runtime dependency to the client just for this.

interface Callbacks {
  onConnectionChange: (state: PresenceConnectionState) => void
  onPresence: (id: number, online: boolean) => void
  onSavePushed: (fromId: number, fromLogin: string, gameId: string) => void
  /** A mutual friend started (gameId set) or stopped (gameId null) playing —
   *  fan-out from the server (see coopsync-server's hub.ts setPlaying), plus
   *  a one-time snapshot right after declaring friends (bootstrap). */
  onPlaying: (id: number, login: string, gameId: string | null) => void
  /** coopsync-server noticed a new GitHub release and pushed it out (see
   *  hub.ts's broadcastRelease, releaseWatcher.ts) — unlike everything else
   *  here, not friend-gated, every connected client gets this. Carries
   *  nothing but the tag; the caller just re-runs its OWN update check
   *  (electron-updater/GitHub Releases stays the actual source of truth for
   *  what's installable on this platform/channel). */
  onRelease: (version: string) => void
  /** Called periodically (and once right after auth) to get the current
   *  mutual-friend id list — covers invite accepted/kicked/role changed
   *  without every one of those call sites needing to remember to push an
   *  update here itself. */
  getFriendIds: () => Promise<number[]>
  /** Called before EVERY connect attempt — presence auths with a
   *  short-lived JWT (see presenceJwt.ts), so a reconnect after sitting
   *  disconnected for a while must mint a fresh one, not reuse a stale
   *  string captured at startPresence time. A throw here is treated like
   *  any other connection failure (backoff + retry). */
  getAuthToken: () => Promise<string>
}

const HEARTBEAT_MS = 30_000 // must stay well under Cloudflare's ~100s idle timeout
const FRIENDS_REFRESH_MS = 2 * 60_000 // matches watcher.ts's own background-check cadence
const MAX_BACKOFF_MS = 30_000

let ws: WebSocket | null = null
let callbacks: Callbacks | null = null
let stopped = true
let reconnectAttempt = 0
let reconnectTimer: ReturnType<typeof setTimeout> | null = null
let heartbeatTimer: ReturnType<typeof setInterval> | null = null
let friendsRefreshTimer: ReturnType<typeof setInterval> | null = null
// Last known online/offline per friend id — lets a screen that mounts AFTER
// presence already connected (and already got its one-time snapshot via the
// 'friends' declare, see coopsync-server's hub.ts setFriends) ask for the
// current picture instead of waiting up to FRIENDS_REFRESH_MS for the next one.
const knownPresence = new Map<number, boolean>()
// Same idea as knownPresence, one level down: friendId -> {login, gameId}
// currently playing (login carried along since a screen mounting fresh via
// getPlayingSnapshot has no other cheap way to resolve it). Absence means
// "not known to be playing anything" — cleared wholesale on stopPresence,
// same as knownPresence (a fresh connect gets a fresh bootstrap snapshot
// from the server for whoever's still playing).
const knownPlaying = new Map<number, { login: string; gameId: string }>()
// Bumped on every startPresence/stopPresence — connect() awaits a token
// mint before opening the socket, and anything captured before that await
// (or a close event from a previous session's socket) must not act on the
// session that replaced it. Same failure family as the renderer races in
// project memory: two overlapping "sessions" both driving reconnects.
let session = 0

/** Current known online/offline per friend id. */
export function getPresenceSnapshot(): Record<number, boolean> {
  return Object.fromEntries(knownPresence)
}

/** Current known {login, gameId} per friend id (only present while playing). */
export function getPlayingSnapshot(): Record<number, { login: string; gameId: string }> {
  return Object.fromEntries(knownPlaying)
}

export function startPresence(cb: Callbacks): void {
  stopPresence() // clears any previous connection/timers first
  session++
  stopped = false
  callbacks = cb
  reconnectAttempt = 0
  connect()
}

export function stopPresence(): void {
  session++
  stopped = true
  callbacks = null
  if (reconnectTimer) {
    clearTimeout(reconnectTimer)
    reconnectTimer = null
  }
  stopHeartbeat()
  stopFriendsRefresh()
  ws?.close()
  ws = null
  knownPresence.clear()
  knownPlaying.clear()
}

/** Tell the server we just pushed a save — a no-op if presence isn't connected. */
export function notifySavePushed(gameId: string): void {
  send({ t: 'save:pushed', gameId })
}

/** Tell the server what we're currently playing (or that we stopped, via
 *  null) — a no-op if presence isn't connected, same as notifySavePushed.
 *  See watcher.ts's launch/exit detection for the call sites. */
export function notifyPlayingState(gameId: string | null): void {
  send({ t: 'playing', gameId })
}

/** Tell the server this user confirmed an experimental game works for them
 *  (see experimentalConfirm.ts — only called once, on the 3rd consecutive
 *  "так"). Best-effort like the two above: if presence isn't connected right
 *  now this confirmation is simply lost, same tolerance the rest of this
 *  file already has for save:pushed/playing — not worth a retry queue for a
 *  progressive-enhancement counter. */
export function notifyGameConfirmed(gameId: string): void {
  send({ t: 'confirmGame', gameId })
}

function send(msg: Record<string, unknown>): void {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg))
  }
}

function connect(): void {
  if (stopped || !callbacks) return
  const mySession = session
  callbacks.onConnectionChange('connecting')
  void (async () => {
    let token: string
    try {
      token = await callbacks!.getAuthToken()
    } catch (e) {
      log(`presence: failed to mint auth token: ${e instanceof Error ? e.message : String(e)}`)
      if (session !== mySession) return
      callbacks?.onConnectionChange('error')
      scheduleReconnect()
      return
    }
    if (session !== mySession) return // stopped/restarted while minting
    openSocket(mySession, token)
  })()
}

function openSocket(mySession: number, token: string): void {
  try {
    ws = new WebSocket(SIGNALING_URL)
  } catch (e) {
    log(`presence: failed to open socket: ${e instanceof Error ? e.message : String(e)}`)
    scheduleReconnect()
    return
  }

  ws.addEventListener('open', () => {
    send({ t: 'auth', token })
  })

  ws.addEventListener('message', (event) => {
    if (session !== mySession) return
    let msg: Record<string, unknown>
    try {
      msg = JSON.parse(String(event.data))
    } catch {
      return
    }
    switch (msg['t']) {
      case 'auth:ok':
        reconnectAttempt = 0
        callbacks?.onConnectionChange('online')
        void refreshFriends()
        startHeartbeat()
        startFriendsRefresh()
        break
      case 'presence':
        if (typeof msg['id'] === 'number' && typeof msg['online'] === 'boolean') {
          knownPresence.set(msg['id'], msg['online'])
          callbacks?.onPresence(msg['id'], msg['online'])
        }
        break
      case 'save:pushed':
        if (typeof msg['from'] === 'number' && typeof msg['gameId'] === 'string') {
          callbacks?.onSavePushed(msg['from'], String(msg['fromLogin'] ?? ''), msg['gameId'])
        }
        break
      case 'playing':
        if (typeof msg['from'] === 'number' && (msg['gameId'] === null || typeof msg['gameId'] === 'string')) {
          const id = msg['from']
          const gameId = msg['gameId'] as string | null
          const login = String(msg['fromLogin'] ?? '')
          if (gameId === null) knownPlaying.delete(id)
          else knownPlaying.set(id, { login, gameId })
          callbacks?.onPlaying(id, login, gameId)
        }
        break
      case 'release':
        if (typeof msg['version'] === 'string') callbacks?.onRelease(msg['version'])
        break
      case 'error':
        log(`presence: server error ${JSON.stringify(msg['code'])}`)
        break
      // 'pong' — nothing to do, its arrival alone confirms the connection is alive.
    }
  })

  ws.addEventListener('close', (event) => {
    log(`presence: connection closed (code=${event.code})`)
    // A previous session's socket closing (stopPresence -> startPresence
    // already moved on) must not touch the live session's timers or
    // schedule a competing reconnect loop.
    if (session !== mySession) return
    stopHeartbeat()
    stopFriendsRefresh()
    callbacks?.onConnectionChange(stopped ? 'off' : 'error')
    scheduleReconnect()
  })

  // 'close' always follows 'error' for a WebSocket — no separate handling needed here.
  ws.addEventListener('error', () => {})
}

async function refreshFriends(): Promise<void> {
  if (!callbacks) return
  try {
    const ids = await callbacks.getFriendIds()
    send({ t: 'friends', ids })
  } catch {
    // Best-effort — try again on the next refresh tick.
  }
}

function startHeartbeat(): void {
  stopHeartbeat()
  heartbeatTimer = setInterval(() => send({ t: 'ping' }), HEARTBEAT_MS)
}

function stopHeartbeat(): void {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer)
    heartbeatTimer = null
  }
}

function startFriendsRefresh(): void {
  stopFriendsRefresh()
  friendsRefreshTimer = setInterval(() => void refreshFriends(), FRIENDS_REFRESH_MS)
}

function stopFriendsRefresh(): void {
  if (friendsRefreshTimer) {
    clearInterval(friendsRefreshTimer)
    friendsRefreshTimer = null
  }
}

// Exponential backoff WITH jitter (ROADMAP.md §1.4) — without the jitter, a
// server restart would make every connected client reconnect in perfect
// lockstep, hammering it the instant it comes back up.
function scheduleReconnect(): void {
  if (stopped) return
  reconnectAttempt++
  const base = Math.min(MAX_BACKOFF_MS, 1000 * 2 ** Math.min(reconnectAttempt, 5))
  const delay = base / 2 + Math.random() * (base / 2)
  reconnectTimer = setTimeout(connect, delay)
}

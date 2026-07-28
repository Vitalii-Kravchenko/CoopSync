import { PRESENCE_TOKEN_ENDPOINT } from '../config'

// Trades the main GitHub token for a short-lived presence JWT — see
// config.ts's PRESENCE_TOKEN_ENDPOINT doc comment for the security
// reasoning. Called right before every websocket connect (the JWT outlives
// a single handshake by minutes, not hours, so there's nothing to store).
//
// Failures throw plain Errors (no AppError codes): they never surface in
// the UI — presenceService just logs them and retries with backoff, same
// as any other connection trouble.

export async function mintPresenceToken(githubToken: string): Promise<string> {
  const res = await fetch(PRESENCE_TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { Authorization: `Bearer ${githubToken}` }
  })
  if (!res.ok) throw new Error(`presence-token endpoint responded ${res.status}`)
  const data = (await res.json()) as { token?: unknown }
  if (typeof data.token !== 'string' || data.token.length === 0) {
    throw new Error('presence-token endpoint returned an unexpected shape')
  }
  return data.token
}

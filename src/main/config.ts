// App config.

// GitHub OAuth app client ID. This is NOT a secret — in device flow the
// client_id is public by design (client_secret isn't used here).
// For now we reuse the client ID from an older project of mine. If device
// flow isn't enabled for it, we'll register a new OAuth App for CoopSync.
export const GITHUB_CLIENT_ID = 'Ov23liThtglJqUxY4Kh0'

// Scopes we request. 'repo' — to create private repos, push saves, and add
// a friend as a collaborator. 'delete_repo' — a separate scope; without it
// GitHub refuses to delete a repo even for the owner.
// Note: users already logged in with an old token (without this scope) will
// get a 403 from the "Delete repository" button — they'll need to re-login.
export const GITHUB_SCOPE = 'repo read:org delete_repo'

// Trades the main GitHub token for a short-lived presence JWT (id + login
// only, ~10 min TTL) minted by our own site Worker — so the signaling
// server below never sees a GitHub token, and there's no second login step.
// The GitHub token goes ONLY to this first-party endpoint over HTTPS, for a
// single GET /user, and is never stored there (replaces the separate
// zero-scope device flow that existed before 0.9.41 — Vitalii's call,
// 2026-07-28).
export const PRESENCE_TOKEN_ENDPOINT = 'https://coopsync.app/api/presence-token'

// Presence/signaling server (coopsync-server, D:\Projects\CoopSync-Server) —
// presence, "friend just pushed" instant notice, and (later) WebRTC signal
// relay. The app is fully usable without it; this is a progressive
// enhancement (see ROADMAP.md §1).
export const SIGNALING_URL = 'wss://signal.coopsync.app'

// Repo name used for saves. The owner/name namespace already guarantees
// uniqueness, so there's no need to add the username to the name itself.
export const SAVES_REPO_NAME = 'coopsync-saves'

// Cloudflare Worker endpoint that forwards messages from the "Support"
// button to my email (via Resend). This is NOT a secret — it's a public URL,
// the app only sends a POST with the message text here. The actual secret
// (Resend API key) lives only on the Worker itself (env secret) and never
// ends up here or in the build. Abuse protection (rate limiting) also lives
// on the Worker side, not in the app.
export const SUPPORT_ENDPOINT_URL = 'https://coopsync-support.coopsync-support.workers.dev'

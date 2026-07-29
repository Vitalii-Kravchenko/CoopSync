# Privacy Policy

_Last updated: 2026-07-29_

CoopSync is a free, hobby-developed application that syncs co-op game saves
between friends through each pair's own private GitHub repository. This
policy explains what personal data the CoopSync **online services**
(the signaling/presence server at `signal.coopsync.app` and the
`coopsync.app` website/Worker) process, and what the desktop **client**
does on your own machine.

## 1. Controller

The controller responsible for the data described below is:

Vitalii Kravchenko
Contact: vitalii.kravchenko.work@gmail.com

This is a solo hobby project, not a registered company. There is no
Data Protection Officer; use the contact above for any privacy request.
Operating without a registered business does not reduce or exempt these
obligations: because CoopSync's online services are offered publicly to
people outside the developer's own household, the GDPR "purely personal
or household activity" exemption does not apply here.

## 2. What CoopSync does NOT do

- CoopSync does not run its own save-file storage. Your game saves,
  version history, and chat (once implemented) live in a private GitHub
  repository that you and your friend own and control — GitHub is a
  separate controller for that data, governed by
  [GitHub's own Privacy Statement](https://docs.github.com/en/site-policy/privacy-policies/github-privacy-statement).
- The signaling server never receives your GitHub sync token (the one
  with repository access). It only ever receives a short-lived,
  purpose-limited credential described in section 4.
- No analytics, no advertising, no tracking cookies, no session
  recording, on the website or in the client.

## 3. What the signaling/presence service processes

When the desktop client connects to `signal.coopsync.app` to show which
of your friends are online and to relay WebRTC connection setup
(planned P2P features), the server processes:

| Data | Purpose | Where it lives | Retention |
|---|---|---|---|
| IP address of your connection | Per-IP connection-count limit (abuse/flood protection) | In server memory (RAM) only | Removed immediately when your connection closes; never written to disk |
| Your GitHub numeric ID and login | Identify you to your mutually-confirmed friends for presence/signaling | In server memory only | Cleared when you disconnect; nothing persists across server restarts |
| Presence-JWT / auth token (hashed) | Avoid re-validating on every message | In-memory cache, keyed by a SHA-256 hash of the token, never the raw token | Auto-expires after 15 minutes (successful auth) or 60 seconds (failed auth) |
| "Friend" list you declare, and WebRTC signaling payloads (offer/answer/ICE candidates) | Show online status and set up a direct peer-to-peer connection between mutual friends only | Relayed in memory; the server does not read or store the content, only forwards it | Not stored — exists only for the duration of the exchange |
| Game-ID strings sent with "I pushed a save" / "I'm playing" events | Trigger the instant new-save notification and "friend is playing" badge for your friends | In server memory only | Cleared on disconnect |

**Nothing above is ever written to a log file, database, or any
persistent storage**, with one exception described next.

### Registered-user counter

The first time your GitHub numeric ID connects to the signaling server,
that bare numeric ID (nothing else — no login, no token, no IP, no
timestamp) is appended to a small counter file so we can show "N
registered users" on the website. This is the only thing persisted by
the server. A bare numeric ID can still be resolved back to a GitHub
account, so it counts as personal data — currently there is no
automatic deletion, which we're aware is a retention gap. We're
evaluating switching this to a purely numeric counter that stores no
per-user identifier at all; until that ships, you can request removal
of your ID at any time (see section 6).

### `/healthz` and `/stats` endpoints

These return only aggregate numbers (uptime, total connection count,
registered-user count) — no personal data. They are polled by an
external uptime monitor (UptimeRobot) that only sees these aggregate
numbers, never your data.

## 4. The `coopsync.app` website/Worker (presence-token exchange)

Before connecting to the signaling server, the client sends your
GitHub sync token, over HTTPS, to `coopsync.app/api/presence-token`.
This Worker makes one `GET /user` call to GitHub's API to confirm your
identity, and returns a short-lived signed token (valid 10 minutes) —
**your GitHub sync token is not stored or logged anywhere in this
process**; it exists only for the duration of that single request.

Older client versions (≤0.9.40) instead send a separate, repository-less
GitHub token directly to the signaling server for the same one-time
identity check; that token is likewise never stored, only hashed for a
short-lived cache (see section 3).

The website also exposes `/api/geo`, which echoes back the country
Cloudflare detects for your connection (used to pick a display
language/region) — this is not stored anywhere.

## 5. Third parties / sub-processors

| Party | Role | What they see |
|---|---|---|
| **Cloudflare** | Reverse proxy / edge network in front of `coopsync.app` and `signal.coopsync.app`; hosts the presence-token Worker | Connection IP and metadata as any web host would see, per [Cloudflare's Privacy Policy](https://www.cloudflare.com/privacypolicy/) |
| **GitHub** (as our processor) | One-time identity check (`GET /user`) during the presence-token exchange | Your GitHub token for that single request; not stored or logged by us |
| **UptimeRobot** | External uptime monitoring of `/healthz` | Only aggregate, non-personal health data |

Separately, and **not** as our sub-processor: if you use CoopSync's save-sync
feature, your saves and version history live in a private GitHub repository
that you and your friend own directly. For that data, GitHub is your own,
independent controller — not a processor acting on our instructions — and
[GitHub's own Privacy Statement](https://docs.github.com/en/site-policy/privacy-policies/github-privacy-statement)
governs it, not this policy.

We do not sell or share your data with anyone else, and we do not use
any advertising or analytics service.

## 6. Your rights

Under GDPR you have the right to:

- **Access** the data we hold about you.
- **Rectify** inaccurate data.
- **Erase** your data (e.g., removal of your ID from the registered-user
  counter file described in section 3).
- **Restrict** processing.
- **Data portability**, where applicable.
- **Object** to processing based on legitimate interest, including presence
  and signaling (see section 7) — the app's save-sync features remain fully
  usable without them; only the online dot and instant notifications are
  affected.

To exercise any of these, email vitalii.kravchenko.work@gmail.com. As this
is a one-person project, requests are handled within one month; for complex
or numerous requests that period may be extended by up to two further
months, in which case we'll tell you within the first month. Responding to
your request is free, unless a request is manifestly unfounded or
excessive.

You also have the right to lodge a complaint with a supervisory
authority — in Poland, the
[Urząd Ochrony Danych Osobowych (UODO)](https://uodo.gov.pl/)
(ul. Stawki 2, 00-193 Warszawa), or the data protection authority in your
own country of residence.

## 7. Legal basis for processing

- Presence, signaling, the instant save-notification feature, and the
  one-time identity check (`GET /user`) are all processed on the basis
  of **legitimate interest** — providing the online-status/instant-
  notification feature to logged-in users, and confirming identity so
  presence and signaling only ever reach mutually-confirmed friends.
  Presence connects automatically as soon as you're logged in (it
  shares your login rather than having a separate toggle today); it
  is not the app's core function — save-sync works fully without it —
  so you can object to this processing at any time (section 6), and
  logging out stops it entirely.
- The short-lived connection-abuse protections (IP connection limits,
  rate limiting) are likewise processed on the basis of **legitimate
  interest** — keeping the service functioning and abuse-free for
  everyone using it.

## 8. Children

CoopSync is not directed at children. If you are under 16 (the digital
consent age under Polish/EU law), please only use CoopSync with a
parent or guardian's involvement, particularly for the GitHub account
required to use the sync features.

## 9. International data transfers

Cloudflare and GitHub (Microsoft) may process data outside the EU/EEA
(e.g., in the United States). Both participate in the EU-U.S. Data
Privacy Framework, which the European Commission recognizes as
providing an adequate level of protection (GDPR Article 45), and both
also offer Standard Contractual Clauses as a fallback safeguard — see
their respective privacy policies linked above for their current
certification status.

Poland's telecom data-retention rules (Prawo komunikacji elektronicznego)
apply to registered telecom operators, not to a non-commercial signaling
relay like this one — and in any case, as described in section 3, we
don't keep persistent IP logs regardless.

## 10. Changes to this policy

If what the service collects or how it's processed changes, this file
will be updated and the "Last updated" date at the top will change.
Since this file lives in the public GitHub repository, its full history
of changes is visible via `git log PRIVACY.md`.

## 11. Language

This policy is also available in the app's other interface languages on
[coopsync.app/privacy.html](https://coopsync.app/privacy.html). Those
translations are provided for convenience; in case of any conflict or
ambiguity, this English version is authoritative.

# Security Policy

CoopSync is a free, hobby-developed application. There's no security team and
no bug bounty budget behind it — just one person — but reports are taken
seriously and fixed as fast as possible.

## Reporting a vulnerability

**Please do not open a public GitHub issue for a security report.** Instead,
email:

**coopsync.support@gmail.com**

Include, if possible:

- What the issue is and why it matters (impact)
- Steps to reproduce, or a proof of concept
- Which part it affects — the desktop client, the signaling server
  (`signal.coopsync.app`), or the website (`coopsync.app`)

You'll get a reply within a few days. There's no fixed disclosure timeline
promised, but a genuine vulnerability gets prioritized over everything else
in the backlog, and you'll be credited (if you want) once it's fixed.

## Scope

In scope:

- The CoopSync desktop client (this repository)
- `coopsync-server` (the signaling/presence server)
- `coopsync.app` (the website)

Out of scope:

- Vulnerabilities in GitHub itself, or in your own private
  `coopsync-saves` repository's access controls — that's GitHub's security
  model, not CoopSync's. Report those to GitHub directly.
- Anything requiring physical access to a device that's already logged in,
  or a device the reporter doesn't own.

## What CoopSync does NOT store, for context

No password is ever handled by CoopSync — login is GitHub's own OAuth
Device Flow. The signaling server never sees your GitHub sync token (see
[PRIVACY.md](PRIVACY.md) for exactly what it does process). Keeping that
boundary intact is the single most security-sensitive property of the whole
project — a report touching it will always be treated as high priority.

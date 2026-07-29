# Terms of Service (Regulamin)

_Last updated: 2026-07-29_

This document is the Regulamin required under Polish law (Ustawa z dnia
18 lipca 2002 r. o świadczeniu usług drogą elektroniczną, Art. 8-9) for
services provided electronically. It covers the CoopSync desktop
application and the online services that support it
(`coopsync.app` and `signal.coopsync.app`). For what personal data is
processed and why, see [PRIVACY.md](PRIVACY.md) — this document covers
the rules of using the service, not data protection.

## 1. Service provider

Vitalii Kravchenko — the same controller identified in
[PRIVACY.md §1](PRIVACY.md#1-controller). Contact:
vitalii.kravchenko.work@gmail.com. CoopSync is a free, solo hobby
project, not a registered company.

## 2. What the service is (scope)

CoopSync is:

- A free Windows desktop application that detects your co-op game save
  folders and syncs them with a friend through **a private GitHub
  repository that the two of you own** — not a CoopSync-hosted server.
- A small always-on **signaling/presence service**
  (`signal.coopsync.app`) that shows which of your mutually-confirmed
  friends are online and relays connection setup for planned
  peer-to-peer features (chat, file transfer, calls) — described in
  full in PRIVACY.md §3-4.
- A **support channel**: an in-app form (the "Support" button in the
  app's title bar) for bug reports, game requests, ideas, or other
  feedback, which is emailed to the service provider.
- The **coopsync.app** website and its presence-token exchange used by
  the app during login.

CoopSync does **not** operate its own account system, its own save
storage, or any payment system. Your GitHub account and your GitHub
repository remain yours and are governed by GitHub's own terms, not by
this document.

## 3. Technical requirements

To use CoopSync you need:

- Windows 10 or 11.
- **Git for Windows** installed and available on your system PATH
  (this is the one dependency CoopSync does not bundle — everything
  else needed to run the app is included in the installer).
- A free GitHub account, used to authenticate (via GitHub's own OAuth
  Device Flow) and to host your private saves repository.
- An internet connection for sync, presence, and update checks.

## 4. Using the service / concluding and ending the "contract"

There is no sign-up on CoopSync's own systems and no fee. By installing
and using CoopSync, you agree to this Regulamin and to
[PRIVACY.md](PRIVACY.md); if you don't agree, simply don't use the
app. You can stop using the service at any time by uninstalling it —
nothing further is owed either way, since no ongoing account exists
with the service provider itself.

Uninstalling the app does not delete your GitHub repository or its
history — that's your own data, on your own GitHub account, and you
manage it directly through GitHub (including transferring, deleting, or
exporting it) independently of CoopSync.

Sharing a saves repository with a friend is an arrangement between the
two of you as GitHub collaborators; CoopSync facilitates the setup
(invitations, sync, conflict handling) but is not a party to that
arrangement and cannot resolve disputes between you and your friend
over shared save data.

## 5. Rules of use — no unlawful content

You agree not to use CoopSync, its signaling service, its planned P2P
features (chat/file transfer/calls), or its support form to create,
store, transmit, or relay content that is unlawful under applicable
law — including malware, content infringing someone else's rights, or
content that is illegal to possess or distribute. WebRTC signaling
payloads and any future P2P chat/file content are relayed between
mutually-confirmed friends only and are not read or moderated by the
service provider (see PRIVACY.md §3), which means responsibility for
what you send or receive through those channels rests with you and the
friend you're connected to, not with the service provider — but the
service provider reserves the right to block access to the online
services (presence/signaling) for an account clearly abusing them.

## 6. Availability and changes to the service

CoopSync's online services (signaling, presence, the website, the
support form) are a best-effort, solo-maintained hobby project with
**no uptime guarantee or SLA**. As documented in PRIVACY.md §7 and the
project's own design principle, the desktop app's core save-sync
function does not depend on these online services being available —
if `signal.coopsync.app` is down, you lose the online-status dot and
instant save notifications, nothing else.

The app checks for updates automatically (on startup and periodically,
unless you turn that off in Settings) but does not install them without
you choosing to. Features, this Regulamin, and PRIVACY.md may change
over time; material changes will be reflected here with an updated
"Last updated" date, and — since both files live in the public GitHub
repository — their full history is visible via `git log`. Continuing to
use CoopSync after a change means you accept the updated version; if a
change is significant, we'll flag it inside the app rather than let it
pass silently.

## 7. Warranty, liability

CoopSync is licensed under the
[PolyForm Noncommercial License 1.0.0](LICENSE), which already states
the software is provided "as-is," without warranty, and without
liability from the licensor (see LICENSE for the exact terms — this
Regulamin does not add to or reduce those terms). In plain terms: this
is a free hobby project maintained by one person, provided with no
guarantee that sync, backups, or any feature will always work
correctly. Given known past incidents where save-restore bugs could
overwrite local data (fixed as found, documented in the project's
release notes), keeping your own occasional backup of anything
irreplaceable is a sensible precaution regardless of what CoopSync
does on its end.

Nothing in this Regulamin excludes liability that cannot be excluded
under mandatory Polish or EU consumer-protection law.

## 8. Complaints (reklamacje)

To report a problem with the service (a bug, an outage, a sync issue,
or anything else covered by this Regulamin), use the **Support** button
in the app's title bar, or email vitalii.kravchenko.work@gmail.com
directly. Please describe what happened, when, and which game/version
if relevant. As a one-person project, complaints are reviewed and
responded to within 30 days.

This 30-day timeline is for complaints about the service itself. If
your request is instead about your personal data under GDPR (access,
erasure, etc.), the timelines in
[PRIVACY.md §6](PRIVACY.md#6-your-rights) apply instead, not this
section.

## 9. Governing law

This Regulamin is governed by Polish law, without prejudice to any
mandatory consumer-protection provisions of the law of your own country
of residence that apply regardless of choice of law. This choice of law
does not affect GDPR, which applies to the processing described in
PRIVACY.md regardless of which law governs this Regulamin.

## 10. Age

Same position as [PRIVACY.md §8](PRIVACY.md#8-children): CoopSync is
not directed at children. If you are under 16 (the digital consent age
under Polish/EU law), only use CoopSync with a parent or guardian's
involvement, particularly for the GitHub account required to use it.

## 11. Language

This Regulamin is also available in the app's other interface languages
on [coopsync.app/terms.html](https://coopsync.app/terms.html),
including a Polish-language version as required under the Ustawa o
języku polskim for consumer agreements performed in Poland. Those
translations are provided for convenience; in case of any conflict or
ambiguity, this English version is authoritative.

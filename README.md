<p align="center">
  <img src="build/logo.svg" width="88" alt="CoopSync">
</p>

<h1 align="center">CoopSync</h1>

<p align="center">🇺🇸 English · <a href="README.uk.md">🇺🇦 Українська</a></p>

<p align="center">
  <img src="https://img.shields.io/badge/version-0.9.16-8A6CFF?style=flat-square&labelColor=10131C" alt="Version">
  <img src="https://img.shields.io/badge/platform-Windows-36E2E8?style=flat-square&labelColor=10131C" alt="Platform">
  <img src="https://img.shields.io/badge/stack-Electron%20%2B%20TS-5AA9FF?style=flat-square&labelColor=10131C" alt="Stack">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-Noncommercial-79839A?style=flat-square&labelColor=10131C" alt="License"></a>
</p>

<p align="center">Free co-op save sync for games, through your own private GitHub repository.</p>

## Requirements

| | |
|---|---|
| 🪟 **OS** | Windows 10 or 11 |
| 🎮 **Steam** | CoopSync detects your installed Steam games |
| 🔧 **[Git for Windows](https://git-scm.com/download/win)** | Must be installed and available in `PATH` — see below |
| 🐙 **[GitHub account](https://github.com)** | Free — used as the sync backend |

> [!NOTE]
> **What do I actually need to install myself?** Just **[Git for Windows](https://git-scm.com/download/win)**, one time. Everything
> else — Electron, Node.js, all app dependencies — is bundled inside the CoopSync installer, so
> there's nothing else to set up. If `git --version` works in a terminal, you're covered.

## Idea

Two friends play the same game — together (host + client) or separately at different
times — and always have **the same, latest saves**. Every time you quit the game, saves
are automatically uploaded to GitHub; every time you launch it, the newest version is
pulled down first. No Steam Cloud, no subscription: log in to GitHub once, and it just
works.

## Installation

> [!WARNING]
> **Windows 11 (version 22H2 and later) may block CoopSync's installer or the app itself.**
> The reason is **Smart App Control** — a feature that's enabled by default on "clean"
> installs of Windows 11 22H2+ (not on systems upgraded from an older Windows) and blocks
> any unsigned application. CoopSync doesn't have a digital signature yet.
>
> **Before installing**, check and, if needed, turn it off: `Settings → Privacy & security
> → Windows Security → App & browser control → Smart App Control` → **Off**.
>
> This is safe and doesn't harm your system — since the April 2026 Windows update
> (KB5083769), you can freely turn it back on afterward, no Windows reinstall required.

> [!IMPORTANT]
> **Turn off Steam Cloud for any game you sync with CoopSync.**
> CoopSync manages saves for the games it syncs through its own GitHub-based system. If
> Steam Cloud is also syncing the same save folder, the two can conflict and overwrite
> each other's changes.
>
> In Steam: **Library → right-click the game → Properties → General → turn off "Steam
> Cloud synchronization"**.

Download the latest `CoopSync-Setup-x.x.x.exe` from [Releases](../../releases) and run the
installer — the same warning appears on the installer's first screen too.

## How it works (the idea)

1. Both players install CoopSync and sign in with GitHub right from the app.
2. The app creates a **private** repository and invites the friend as a collaborator.
3. CoopSync runs in the background (starts with Windows), detects installed Steam games.
4. Quit the game → saves get pushed to GitHub, but only if no one else already pushed a
   newer version while you were playing — CoopSync checks first, so a friend's progress is
   never silently overwritten. Launch the game → the latest version gets pulled first.

## Features

- 🔄 **Automatic sync** — push on quit, pull on launch, with a conflict check so a
  co-op friend's newer save is never overwritten by mistake.
- 👥 **Friends tab** — invite friends by GitHub username and see who's accepted, who's
  still pending.
- 🗑️ **Delete the shared storage** — a guarded, two-step confirmation (with a short
  countdown) if you ever want to start over.
- 💬 **Support button** — send bug reports, game requests (with a live Steam search),
  or ideas straight from the app, no need to email the developer directly.
- 🔔 **In-app updates** — checks for a new release in the background and lets you
  download and install it with one click, no manual downloads.
- 🌍 **10 languages** — English, French, German, Polish, Portuguese (Brazil), Russian,
  Chinese (Simplified), Spanish, Turkish, and Ukrainian.

## Stack

- Electron + TypeScript
- React (UI)
- electron-vite (build), electron-builder (installer)

## Scripts

```bash
npm run dev        # run in development mode
npm run build      # build
npm run typecheck  # type checking
npm run dist       # build the .exe installer
```

## Status

🚧 In development. MVP: GitHub login → Steam game detection → automatic save sync.

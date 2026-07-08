<p align="center">
  <img src="build/logo.svg" width="88" alt="CoopSync">
</p>

<h1 align="center">CoopSync</h1>

<p align="center">🇺🇸 English · <a href="README.uk.md">🇺🇦 Українська</a></p>

<p align="center">
  <span style="display:inline-flex;align-items:center;height:24px;padding:0 9px;margin:2px;font-family:'JetBrains Mono',monospace;font-size:11px;color:#8A6CFF;background:rgba(138,108,255,.12);border:1px solid rgba(138,108,255,.38);border-radius:5px;">v0.3.1</span>
  <span style="display:inline-flex;align-items:center;height:24px;padding:0 9px;margin:2px;font-family:'JetBrains Mono',monospace;font-size:11px;color:#36E2E8;background:rgba(54,226,232,.12);border:1px solid rgba(54,226,232,.38);border-radius:5px;">Windows</span>
  <span style="display:inline-flex;align-items:center;height:24px;padding:0 9px;margin:2px;font-family:'JetBrains Mono',monospace;font-size:11px;color:#5AA9FF;background:rgba(90,169,255,.12);border:1px solid rgba(90,169,255,.38);border-radius:5px;">Electron + TS</span>
  <a href="LICENSE"><span style="display:inline-flex;align-items:center;height:24px;padding:0 9px;margin:2px;font-family:'JetBrains Mono',monospace;font-size:11px;color:#79839A;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.10);border-radius:5px;">Noncommercial</span></a>
</p>

Free co-op save sync for games, through your own private GitHub repository.

## Requirements

- Windows 10 or 11
- Steam (CoopSync detects your installed Steam games)
- **[Git for Windows](https://git-scm.com/download/win)** installed and available in
  `PATH` — CoopSync uses your system's Git to push/pull saves, it isn't bundled with
  the app
- A free [GitHub](https://github.com) account

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
4. Quit the game → saves get pushed to GitHub. Launch the game → the latest version gets
   pulled first.

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

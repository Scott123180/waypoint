# waypoint

Local-first, plain-text capture and review. Your data is markdown on your disk,
readable and editable with no application running.

Governed by [the constitution](.specify/memory/constitution.md); planned in
[ROADMAP.md](ROADMAP.md).

## Status

Feature 1 (quick capture) is implemented: text and voice capture, transcript
review, and undo. 134 unit tests and 32 end-to-end tests.

## Requirements

- **Node 22** — managed with [nvm](https://github.com/nvm-sh/nvm). Run `nvm use`
  in the repo root; `.nvmrc` pins the version. The `node` on your default `PATH`
  may be older, so a shell that has not activated nvm will pick up the wrong one.
- **cmake** — needed by `scripts/fetch-whisper.sh` to build whisper.cpp
  (`sudo apt install cmake` on Ubuntu). Only required for voice capture.

## Setup

```bash
nvm use
npm install
./scripts/fetch-whisper.sh   # builds whisper.cpp + downloads the ~500MB model
```

`resources/` is gitignored — the binary and model are never committed.

## Commands

| Command | What it does |
|---|---|
| `npm test` | Core and adapter tests (fast; no Electron, no model) |
| `npm run test:e2e` | Playwright end-to-end tests against a real Electron window |
| `npm run test:whisper` | Opt-in integration test against the real whisper binary |
| `npm run typecheck` | Type checking without emit |
| `npm run build` | Compile core, main/preload, and renderer |
| `npm run dev` | Build and launch the app |
| `npm run package` | Build a distributable (normally done by CI) |

## Using it

The app runs in the background with no dock icon. Press
`Ctrl/Cmd+Shift+Space` — or use the tray/menu-bar icon — and the capture box
appears, ready to type. Enter saves and closes; Shift+Enter adds a line; Esc
dismisses. "Dictate" transcribes speech on-device and drops the text into the
box for you to check before saving. A dictated capture can be undone from the
tray until your next capture.

Everything lands in `~/waypoint/inbox.md`, one markdown list item per thought.
Edit it by hand whenever you like — captures only ever append, and never
rewrite what is already there.

Settings live in `~/.config/waypoint/config.json` (`inboxPath`, `hotkey`,
`whisperModelPath`); defaults apply when the file is absent.

## Structure

```text
packages/core/      All domain logic. Imports nothing from Electron.
packages/desktop/   Electron thin client: adapters, main, preload, renderer.
```

The split is enforced, not stylistic: clients hold no domain logic, so the same
core will serve the planned HTTP API and agent integration without reimplementation.

## Building releases

macOS builds are produced by GitHub Actions on a macOS runner and published as
release artifacts. Development happens on the Linux machine only — the work
MacBook downloads finished builds and never compiles or installs packages.

# waypoint

Local-first, plain-text capture and review. Your data is markdown on your disk,
readable and editable with no application running.

Governed by [the constitution](.specify/memory/constitution.md); planned in
[ROADMAP.md](ROADMAP.md).

## Status

Feature 1 (quick capture) is implemented: text and voice capture, transcript
review, and undo. 160 unit tests and 50 end-to-end tests.

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

The two halves are independent — `--model-only` needs no compiler, `--binary-only`
needs no download — so a missing toolchain never blocks the model and vice versa.

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

### A note on `--no-sandbox`

`npm run dev` passes `--no-sandbox`. On Ubuntu 23.10+ npm cannot set the SUID bit on
Electron's `chrome-sandbox` helper, and `kernel.apparmor_restrict_unprivileged_userns=1`
blocks the fallback, so Electron refuses to start without it. The alternative is
`sudo chown root:root node_modules/electron/dist/chrome-sandbox && sudo chmod 4755 …`,
which every `npm install` undoes. The flag applies to local development only — packaged
builds are unaffected.

## Using it

The app runs in the background with no dock icon. Two global hotkeys open the
capture box — or use the tray/menu-bar icon:

| Hotkey | What it does |
|---|---|
| `Ctrl/Cmd+Shift+Space` | Opens the box **already listening** — speak straight away |
| `Ctrl/Cmd+Shift+Enter` | Opens the box for typing |

Dictation gets the easier binding because it is the mode most reached for, and
it is the one that otherwise costs a keystroke *and* a click. Both are
configurable, and they are registered independently — if your window manager has
claimed one, the other still works.

Enter saves and closes; Shift+Enter adds a line; Esc dismisses. While dictating,
the footer shows which of three things is happening: **Starting microphone…**,
**Listening** with a live level meter and a timer, or **Transcribing…**. The
meter is driven by the same samples that get transcribed, so a meter that does
not move means the microphone is muted or the wrong input device is selected.
You can keep typing throughout — dictation never takes the keyboard away.

Transcription typically takes 3–5 seconds. There is deliberately no percentage:
whisper's own progress output reports 185% on a 16-second clip and 1090% on a
2.8-second one, so any number shown would be invented.

A dictated capture can be undone from the tray until your next capture.

Everything lands in `~/waypoint/inbox.md`, one markdown list item per thought.
Edit it by hand whenever you like — captures only ever append, and never
rewrite what is already there.

Settings live in `~/.config/waypoint/config.json` (`inboxPath`, `hotkey`,
`dictateHotkey`, `whisperModelPath`); defaults apply when the file is absent.

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

## License

[MIT](LICENSE) — chosen deliberately, not inherited. Contributions are welcome
under the same terms; see [CONTRIBUTING.md](CONTRIBUTING.md).

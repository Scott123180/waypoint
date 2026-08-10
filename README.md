# waypoint

Local-first, plain-text capture and review. Your data is markdown on your disk,
readable and editable with no application running.

Governed by [the constitution](.specify/memory/constitution.md); planned in
[ROADMAP.md](ROADMAP.md).

## Requirements

- **Node 22** — managed with [nvm](https://github.com/nvm-sh/nvm). Run `nvm use`
  in the repo root; `.nvmrc` pins the version. The `node` on your default `PATH`
  may be older, so a shell that has not activated nvm will pick up the wrong one.

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

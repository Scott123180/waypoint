# Contract: whisper.cpp Subprocess Adapter

**Feature**: 001-quick-capture | Implements `TranscriptionPort` from [core-api.md](core-api.md)

Bundled whisper.cpp binary, invoked as a subprocess, fully offline, no Python (ROADMAP decision).

---

## Invocation

```bash
whisper-cli \
  -m <resources>/whisper/ggml-small.en.bin \
  -f - \                      # WAV on stdin — audio never touches disk (FR-006a)
  --no-timestamps \
  --output-txt false \
  --language en \
  --threads <cpu count - 1>
```

Transcript is read from **stdout**; progress and diagnostics go to stderr and are ignored unless the
exit code is non-zero.

**Input format**: 16 kHz mono 16-bit PCM in a WAV container, written to stdin and the stream closed.
whisper requires 16 kHz; the renderer resamples so no transcoding dependency is needed (R1).

---

## Spike gate — RESOLVED (GO), confirmed against the real binary

Verified 2026-08-09 against tag **`v1.7.4`**: `read_wav()` in `examples/common.cpp:642` handles
`fname == "-"` by draining stdin into memory and calling `drwav_init_memory`. No disk write on that
path. Binary target is `whisper-cli`. The memory-backed fallback in R1 is **not needed**.

Two requirements this imposes on the adapter:

1. **Close the child's stdin after writing.** whisper reads until EOF; leaving the pipe open hangs
   the process indefinitely.
2. **Do not treat stderr output as failure.** whisper logs `read N bytes from stdin` and progress
   there on success. Only the exit code is authoritative.

**Build requirement**: compile with `BUILD_SHARED_LIBS=OFF`. The default build produces a
`whisper-cli` that cannot start without `libwhisper.so`/`libggml.so` beside it, so shipping the
executable alone yields a broken bundle. `scripts/fetch-whisper.sh` builds static and runs the
installed binary before declaring success.

---

## Failure handling

| Condition | Adapter behaviour |
|---|---|
| Exit code ≠ 0 | Throw `TranscriptionFailedError` with the last stderr line |
| Empty stdout | Return `''` — the core maps this to `no-speech` (FR-017a), not an error |
| Binary missing | Throw `TranscriptionFailedError`; the app stays usable for **typed** capture. Voice failing must never take text capture down with it. |
| Model file missing | Same as above, with a message naming the expected model path |
| Process exceeds timeout | Kill the child, throw. Prevents a wedged subprocess pinning CPU forever. |
| Renderer cancels dictation | Kill the child; discard audio |

The child is always killed on app quit. Audio buffers are released as soon as the call returns and
are never referenced afterwards.

---

## Testing

Per R9, the adapter's contract tests run against a **fake `whisper-cli` shell script** that echoes
canned output for given stdin, asserting: argv construction, stdin piping, stdout parsing, non-zero
exit handling, empty output handling, and timeout kill.

One **opt-in** integration test runs the real binary against a short fixture clip; it is skipped
unless the model is present, so the default suite never needs the ~500 MB download.

---

## Build and bundling

Compiled in GitHub Actions from a pinned tag per target (`macos-14` arm64 with Metal,
`ubuntu-latest` x64 CPU), model downloaded from Hugging Face with a **pinned SHA-256 checksum**,
both cached and injected via electron-builder `extraResources`. Neither is committed to git — a
public repo must not carry a half-gigabyte blob in its permanent history (R10).

`scripts/fetch-whisper.sh` reproduces the same pinned build locally on the Linux dev machine.

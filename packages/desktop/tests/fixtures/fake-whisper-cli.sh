#!/usr/bin/env bash
#
# Stands in for whisper-cli so the adapter's wiring can be tested without the
# real binary or the ~500MB model.
#
# Behaviour is driven by environment variables set by the test:
#   FAKE_WHISPER_OUTPUT    text to print on stdout
#   FAKE_WHISPER_EXIT      exit code (default 0)
#   FAKE_WHISPER_HANG      if "1", sleep forever so the timeout path can be tested
#   FAKE_WHISPER_ARGV_OUT  file to record argv into
#   FAKE_WHISPER_STDIN_OUT file to record the bytes received on stdin
#
set -u

if [[ -n "${FAKE_WHISPER_ARGV_OUT:-}" ]]; then
  printf '%s\n' "$@" > "${FAKE_WHISPER_ARGV_OUT}"
fi

# Always drain stdin: the real binary reads until EOF, and a test that never
# consumed it would deadlock rather than fail informatively.
if [[ -n "${FAKE_WHISPER_STDIN_OUT:-}" ]]; then
  cat > "${FAKE_WHISPER_STDIN_OUT}"
else
  cat > /dev/null
fi

if [[ "${FAKE_WHISPER_HANG:-0}" == "1" ]]; then
  # exec so this script's PID *becomes* the sleep. Without it, killing the shell
  # would orphan a child that keeps the stdio pipes open, which hangs the test
  # runner. The real whisper-cli is a single binary, so SIGKILL reaches it.
  exec sleep 300
fi

# The real binary logs progress here on success, so the adapter must not treat
# stderr output as a failure signal.
echo "fake-whisper: read stdin, transcribing" >&2

printf '%s' "${FAKE_WHISPER_OUTPUT:-}"
exit "${FAKE_WHISPER_EXIT:-0}"

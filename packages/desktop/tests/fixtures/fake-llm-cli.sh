#!/usr/bin/env bash
#
# Stands in for a command-line model tool so the command transport's wiring can
# be tested without one installed. Shaped like fake-whisper-cli.sh, because the
# transport is shaped like WhisperAdapter.
#
# Behaviour is driven by environment variables set by the test:
#   FAKE_LLM_OUTPUT     text to print on stdout (the response content)
#   FAKE_LLM_EXIT       exit code (default 0)
#   FAKE_LLM_HANG       if "1", sleep forever so the abort path can be tested
#   FAKE_LLM_ARGV_OUT   file to record argv into, one argument per line
#   FAKE_LLM_STDIN_OUT  file to record the bytes received on stdin
#
set -u

if [[ -n "${FAKE_LLM_ARGV_OUT:-}" ]]; then
  # One per line, so an argument containing a space is still one argument —
  # which is the property the `## Arguments` list exists to preserve.
  printf '%s\n' "$@" > "${FAKE_LLM_ARGV_OUT}"
fi

# Always drain stdin: the transport writes the request there and ends the
# stream, and a fixture that never consumed it would deadlock rather than fail
# informatively.
if [[ -n "${FAKE_LLM_STDIN_OUT:-}" ]]; then
  cat > "${FAKE_LLM_STDIN_OUT}"
else
  cat > /dev/null
fi

if [[ "${FAKE_LLM_HANG:-0}" == "1" ]]; then
  # exec so this script's PID *becomes* the sleep. Without it, killing the shell
  # would orphan a child that keeps the stdio pipes open, which hangs the test
  # runner. A real tool is a single process, so the kill reaches it.
  exec sleep 300
fi

# A real tool logs to stderr on a successful run, so the transport must not
# treat stderr output as a failure signal — only the exit code counts.
echo "fake-llm: read stdin, thinking" >&2

printf '%s' "${FAKE_LLM_OUTPUT:-}"
exit "${FAKE_LLM_EXIT:-0}"

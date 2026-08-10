#!/usr/bin/env bash
#
# Builds whisper.cpp from a pinned tag and downloads the pinned model into
# resources/whisper/. Used identically by local development and CI, so the
# dev machine matches the release artifact.
#
# Nothing this script produces is committed — resources/ is gitignored.
#
set -euo pipefail

WHISPER_TAG="${WHISPER_TAG:-v1.7.4}"
MODEL_NAME="${MODEL_NAME:-ggml-small.en.bin}"
MODEL_URL="${MODEL_URL:-https://huggingface.co/ggerganov/whisper.cpp/resolve/main/${MODEL_NAME}}"

# SHA-256 of the model this project has validated against. Pinning it stops a
# silently changed upstream artifact from entering the bundle.
#
# Verified 2026-08-09: this value matches the `lfs.oid` Hugging Face publishes
# for ggml-small.en.bin (size 487614201), cross-checked against the API rather
# than simply trusting whatever one download happened to produce.
MODEL_SHA256="${MODEL_SHA256:-c6138d6d58ecc8322097e0f987c32f1be8bb0a18532a3f88f734d1bbf9c41e5d}"

# Set to 1 in any build whose output ships to a user. Release CI sets it.
REQUIRE_PINNED_MODEL="${REQUIRE_PINNED_MODEL:-0}"

# The two halves are independent on purpose: the model is a plain download, and
# only the binary needs a C++ toolchain. Skipping one must never block the other.
#   ./scripts/fetch-whisper.sh --model-only    # no cmake required
#   ./scripts/fetch-whisper.sh --binary-only
DO_BINARY=1
DO_MODEL=1
for arg in "$@"; do
  case "${arg}" in
    --model-only)  DO_BINARY=0 ;;
    --binary-only) DO_MODEL=0 ;;
    -h|--help)
      echo "usage: fetch-whisper.sh [--model-only|--binary-only]"
      exit 0 ;;
    *)
      echo "unknown option: ${arg}" >&2
      exit 2 ;;
  esac
done

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RESOURCES="${REPO_ROOT}/resources/whisper"
BUILD_DIR="${REPO_ROOT}/.whisper-build"

mkdir -p "${RESOURCES}"

# ---------------------------------------------------------------- binary ----
if [[ "${DO_BINARY}" == "0" ]]; then
  echo "==> Skipping binary build (--model-only)"
elif ! command -v cmake >/dev/null 2>&1; then
  # Report and carry on to the model rather than aborting: a missing toolchain
  # should not also deny you the download.
  echo "WARNING: cmake not found, skipping the whisper-cli build." >&2
  echo "  Install it (e.g. sudo apt install cmake) and re-run to build the binary." >&2
  BINARY_SKIPPED=1
elif [[ -x "${RESOURCES}/whisper-cli" ]]; then
  echo "==> whisper-cli already present, skipping build"
else
  echo "==> Building whisper.cpp ${WHISPER_TAG}"
  rm -rf "${BUILD_DIR}"
  git clone --depth 1 --branch "${WHISPER_TAG}" \
    https://github.com/ggerganov/whisper.cpp.git "${BUILD_DIR}"

  CMAKE_FLAGS=(-DCMAKE_BUILD_TYPE=Release -DWHISPER_BUILD_TESTS=OFF -DWHISPER_BUILD_EXAMPLES=ON)
  if [[ "$(uname -s)" == "Darwin" ]]; then
    # Metal gives a large speedup on Apple Silicon for short capture clips.
    CMAKE_FLAGS+=(-DGGML_METAL=ON)
  fi

  cmake -S "${BUILD_DIR}" -B "${BUILD_DIR}/build" "${CMAKE_FLAGS[@]}"
  cmake --build "${BUILD_DIR}/build" --config Release -j "$(getconf _NPROCESSORS_ONLN)"

  # Upstream renamed `main` to `whisper-cli`; accept either so a tag bump does
  # not silently produce a bundle with no binary in it.
  BIN=""
  for candidate in \
    "${BUILD_DIR}/build/bin/whisper-cli" \
    "${BUILD_DIR}/build/bin/main" \
    "${BUILD_DIR}/build/whisper-cli" \
    "${BUILD_DIR}/build/main"; do
    if [[ -x "${candidate}" ]]; then BIN="${candidate}"; break; fi
  done
  if [[ -z "${BIN}" ]]; then
    echo "ERROR: no whisper binary found after build. Inspect ${BUILD_DIR}/build/bin" >&2
    exit 1
  fi

  cp "${BIN}" "${RESOURCES}/whisper-cli"
  # Metal builds load a companion shader file at runtime.
  if [[ -f "${BUILD_DIR}/build/bin/ggml-metal.metal" ]]; then
    cp "${BUILD_DIR}/build/bin/ggml-metal.metal" "${RESOURCES}/"
  fi
  chmod +x "${RESOURCES}/whisper-cli"
  rm -rf "${BUILD_DIR}"
  echo "==> Binary installed at ${RESOURCES}/whisper-cli"
fi

# ----------------------------------------------------------------- model ----
if [[ "${DO_MODEL}" == "0" ]]; then
  echo "==> Skipping model download (--binary-only)"
  if [[ "${BINARY_SKIPPED:-0}" == "1" ]]; then
  echo "==> Model ready, but whisper-cli is still missing — voice capture stays disabled."
else
  echo "==> resources/whisper ready"
fi
  exit 0
fi

MODEL_PATH="${RESOURCES}/${MODEL_NAME}"
if [[ -f "${MODEL_PATH}" ]]; then
  echo "==> ${MODEL_NAME} already present, skipping download"
else
  echo "==> Downloading ${MODEL_NAME} (~500MB)"
  curl -fL --progress-bar -o "${MODEL_PATH}.part" "${MODEL_URL}"
  mv "${MODEL_PATH}.part" "${MODEL_PATH}"
fi

ACTUAL_SHA="$(shasum -a 256 "${MODEL_PATH}" | awk '{print $1}')"
if [[ -z "${MODEL_SHA256}" ]]; then
  if [[ "${REQUIRE_PINNED_MODEL}" == "1" ]]; then
    echo "ERROR: MODEL_SHA256 is not pinned, and this is a release build." >&2
    echo "  Downloaded model SHA-256: ${ACTUAL_SHA}" >&2
    echo "  Pin it in scripts/fetch-whisper.sh (or set the WHISPER_MODEL_SHA256" >&2
    echo "  repository variable) so the bundled model is verifiable." >&2
    exit 1
  fi
  echo ""
  echo "WARNING: MODEL_SHA256 is not pinned."
  echo "  Downloaded model SHA-256: ${ACTUAL_SHA}"
  echo "  Pin it in this script (or export MODEL_SHA256) before building a release."
  echo ""
elif [[ "${ACTUAL_SHA}" != "${MODEL_SHA256}" ]]; then
  echo "ERROR: model checksum mismatch." >&2
  echo "  expected: ${MODEL_SHA256}" >&2
  echo "  actual:   ${ACTUAL_SHA}" >&2
  rm -f "${MODEL_PATH}"
  exit 1
else
  echo "==> Model checksum verified"
fi

if [[ "${BINARY_SKIPPED:-0}" == "1" ]]; then
  echo "==> Model ready, but whisper-cli is still missing — voice capture stays disabled."
else
  echo "==> resources/whisper ready"
fi

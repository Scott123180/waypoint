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
# TODO(waypoint): fill this in on the first successful local fetch — the script
# prints the computed hash below. Until it is set, RELEASE builds refuse to
# proceed (see REQUIRE_PINNED_MODEL); local development only warns.
MODEL_SHA256="${MODEL_SHA256:-}"

# Set to 1 in any build whose output ships to a user. Release CI sets it.
REQUIRE_PINNED_MODEL="${REQUIRE_PINNED_MODEL:-0}"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RESOURCES="${REPO_ROOT}/resources/whisper"
BUILD_DIR="${REPO_ROOT}/.whisper-build"

mkdir -p "${RESOURCES}"

# ---------------------------------------------------------------- binary ----
if [[ -x "${RESOURCES}/whisper-cli" ]]; then
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

echo "==> resources/whisper ready"

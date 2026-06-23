#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
DESKTOP="$(cd "$(dirname "$0")/.." && pwd)"
ENGINE="$ROOT/engine"
BIN_DIR="$DESKTOP/src-tauri/bin"
SPEC="$DESKTOP/scripts/blowmyjob-engine.spec"

OS="$(uname -s)"
ARCH="$(uname -m)"

echo "==> Build sidecar Python ($OS / $ARCH)"

if [[ ! -d "$ENGINE" ]]; then
  echo "engine/ introuvable: $ENGINE" >&2
  exit 1
fi

PYTHON=""
if [[ -x "$ENGINE/venv/bin/python" ]]; then
  PYTHON="$ENGINE/venv/bin/python"
elif [[ -x "$ENGINE/venv/Scripts/python.exe" ]]; then
  PYTHON="$ENGINE/venv/Scripts/python.exe"
elif command -v python3 >/dev/null 2>&1; then
  PYTHON="$(command -v python3)"
elif command -v python >/dev/null 2>&1; then
  PYTHON="$(command -v python)"
else
  echo "python introuvable" >&2
  exit 1
fi

"$PYTHON" -m pip install --upgrade pip pyinstaller -q
"$PYTHON" -m pip install -r "$ENGINE/requirements.txt" -q

mkdir -p "$BIN_DIR"
cd "$DESKTOP/scripts"
"$PYTHON" -m PyInstaller --noconfirm --clean "$SPEC"

OUT="$DESKTOP/scripts/dist/blowmyjob-engine"
if [[ "$OS" == "Darwin" ]]; then
  if [[ "$ARCH" == "arm64" ]]; then
    TARGET="$BIN_DIR/blowmyjob-engine-aarch64-apple-darwin"
  else
    TARGET="$BIN_DIR/blowmyjob-engine-x86_64-apple-darwin"
  fi
elif [[ "$OS" == MINGW* ]] || [[ "$OS" == MSYS* ]] || [[ "$OS" == CYGWIN* ]] || [[ "${OS:-}" == "Windows_NT" ]]; then
  OUT="$DESKTOP/scripts/dist/blowmyjob-engine.exe"
  TARGET="$BIN_DIR/blowmyjob-engine-x86_64-pc-windows-msvc.exe"
else
  TARGET="$BIN_DIR/blowmyjob-engine"
fi

cp "$OUT" "$TARGET"
chmod +x "$TARGET" 2>/dev/null || true

echo "==> Sidecar prêt: $TARGET"
ls -la "$TARGET"

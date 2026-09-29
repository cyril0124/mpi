#!/usr/bin/env bash
set -euo pipefail

# MixCode installer - build the workspace, compile a standalone binary, install as `mpi`.
# Usage: ./install.sh [--prefix ~/.local]
#
# Layout: the compiled binary reads its runtime files (themes, assets, export templates,
# docs, wasm, native prebuilds) from its own directory, so the binary lives in
# <prefix>/lib/mpi/ and <prefix>/bin/mpi is a wrapper that execs it.

INSTALL_NAME="mpi"
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# --- Helpers ---

info()  { printf '\033[1;34m[info]\033[0m %s\n' "$*"; }
warn()  { printf '\033[1;33m[warn]\033[0m %s\n' "$*" >&2; }
error() { printf '\033[1;31m[error]\033[0m %s\n' "$*" >&2; exit 1; }

command_exists() { command -v "$1" >/dev/null 2>&1; }

# --- Parse args ---

PREFIX="${MIXCODE_INSTALL_PREFIX:-$HOME/.local}"

while [ $# -gt 0 ]; do
  case "$1" in
    --prefix)
      [ $# -lt 2 ] && error "--prefix requires an argument"
      PREFIX="$2"; shift 2 ;;
    --prefix=*) PREFIX="${1#--prefix=}"
      [ -z "$PREFIX" ] && error "--prefix must not be empty"
      shift ;;
    -h|--help)
      cat <<EOF
Usage: install.sh [OPTIONS]

Options:
  --prefix <path>   Install wrapper to <path>/bin/mpi, runtime files to <path>/lib/mpi
                    (default: ~/.local)
  -h, --help        Show this help

Environment variables:
  MIXCODE_INSTALL_PREFIX  Same as --prefix

Requires bun (installed automatically if missing) and network access for the
first build. Builds all workspace packages, then compiles one standalone binary.
EOF
      exit 0
      ;;
    *) error "Unknown option: $1" ;;
  esac
done

# Strip trailing slashes for consistent PATH matching
PREFIX="${PREFIX%/}"
[ -n "$PREFIX" ] || error "--prefix must not be empty"
[ "$PREFIX" != "/" ] || error "--prefix must not be /"

# The wrapper below bakes this path in, so it must be absolute: resolve a
# relative prefix against the caller's cwd (before any cd) and expand a
# leading tilde that the --prefix= form leaves literal.
case "$PREFIX" in
  "~") PREFIX="$HOME" ;;
  "~"/*) PREFIX="$HOME/${PREFIX#"~/"}" ;;
  /*) ;;
  *) PREFIX="$(pwd)/$PREFIX" ;;
esac

BIN_DIR="$PREFIX/bin"
LIB_DIR="$PREFIX/lib/$INSTALL_NAME"

# --- Preflight ---

info "Checking prerequisites..."

# Prepend bun's default install dir so an existing bun is found even when the
# shell profile has not added it to PATH.
export BUN_INSTALL="${BUN_INSTALL:-$HOME/.bun}"
export PATH="$BUN_INSTALL/bin:$PATH"

if ! command_exists bun; then
  info "bun not found. Installing bun..."
  if command_exists curl; then
    curl -fsSL https://bun.sh/install | bash || error "Failed to install bun"
  elif command_exists wget; then
    wget -qO- https://bun.sh/install | bash || error "Failed to install bun"
  else
    error "Neither curl nor wget found. Please install curl or wget, or install bun manually: https://bun.sh"
  fi

  if ! command_exists bun; then
    error "bun was installed but is not found in PATH ($BUN_INSTALL/bin)"
  fi
fi

info "bun $(bun --version)"

# --- Platform ---

OS="$(uname -s)"
ARCH="$(uname -m)"
case "$OS/$ARCH" in
  Darwin/arm64)  PLATFORM="darwin-arm64" ;;
  Darwin/x86_64) PLATFORM="darwin-x64" ;;
  Linux/x86_64)  PLATFORM="linux-x64" ;;
  Linux/aarch64) PLATFORM="linux-arm64" ;;
  *) error "Unsupported platform: $OS $ARCH (supported: macOS/Linux on arm64 or x64)" ;;
esac

# Baseline x64 targets run on CPUs without AVX2.
BUN_TARGET="bun-$PLATFORM"
case "$PLATFORM" in
  *-x64) BUN_TARGET="$BUN_TARGET-baseline" ;;
esac

# --- Install deps ---

cd "$REPO_DIR"

info "Installing dependencies..."
# Same incantation as run.sh: --no-save keeps bun.lock untouched (npm owns the lockfiles).
bun install --force --ignore-scripts --no-save || error "bun install failed"

# --- Build ---

info "Building packages..."
# Offline build path with bundled model data; hydrate first when the check says
# the committed data is stale (mirrors run.sh).
if ! bun run check:model-data >/dev/null 2>&1; then
  bun run hydrate:model-data || error "Failed to hydrate model data"
fi
bun run build:offline || error "Package build failed"

# --- Compile ---

BUILD_TMPDIR=$(mktemp -d)
trap 'rm -rf "$BUILD_TMPDIR"' EXIT

info "Compiling standalone binary..."
# Mirrors scripts/build-binaries.sh: the worker must be an explicit entrypoint to
# be embedded, and bunfig autoload is disabled so preloads cannot crash the
# standalone binary (see #7684).
cd "$REPO_DIR/packages/coding-agent"
bun build --compile --no-compile-autoload-bunfig --target="$BUN_TARGET" \
  ./dist/bun/cli.js ./src/utils/image-resize-worker.ts \
  --outfile "$BUILD_TMPDIR/$INSTALL_NAME" || error "Compilation failed"

if [ ! -f "$BUILD_TMPDIR/$INSTALL_NAME" ]; then
  error "Compilation failed"
fi

# --- Install ---

info "Installing to $BIN_DIR/$INSTALL_NAME (runtime files in $LIB_DIR)..."

rm -rf "$LIB_DIR"
mkdir -p "$LIB_DIR" "$BIN_DIR"

# The compiled binary resolves runtime files relative to itself, so it lives in
# LIB_DIR and the bin entry is a wrapper that execs it.
mv -f "$BUILD_TMPDIR/$INSTALL_NAME" "$LIB_DIR/$INSTALL_NAME" 2>/dev/null \
  || cp "$BUILD_TMPDIR/$INSTALL_NAME" "$LIB_DIR/$INSTALL_NAME"
chmod +x "$LIB_DIR/$INSTALL_NAME"

# Runtime files read from the binary's directory (set mirrors scripts/build-binaries.sh).
cp package.json README.md CHANGELOG.md "$LIB_DIR/"
cp "$REPO_DIR/node_modules/@silvia-odwyer/photon-node/photon_rs_bg.wasm" "$LIB_DIR/"
mkdir -p "$LIB_DIR/theme" "$LIB_DIR/assets"
cp dist/modes/interactive/theme/*.json "$LIB_DIR/theme/"
cp dist/modes/interactive/assets/* "$LIB_DIR/assets/"
cp -R dist/core/export-html "$LIB_DIR/export-html"
cp -R docs "$LIB_DIR/docs"
cp -R examples "$LIB_DIR/examples"

# Native pi-tui platform helper for this machine's architecture.
NATIVE_OS="${PLATFORM%%-*}"
NATIVE_PREBUILDS="native/$NATIVE_OS/prebuilds"
mkdir -p "$LIB_DIR/$NATIVE_PREBUILDS"
cp -R "$REPO_DIR/packages/tui/$NATIVE_PREBUILDS/$PLATFORM" "$LIB_DIR/$NATIVE_PREBUILDS/"

# Bin wrapper: exec the real binary so process.execPath points next to its runtime files.
WRAPPER="$BIN_DIR/$INSTALL_NAME"
{
  printf '#!/bin/sh\n'
  printf 'exec "%s/%s" "$@"\n' "$LIB_DIR" "$INSTALL_NAME"
} > "$WRAPPER"
chmod +x "$WRAPPER"

# --- PATH check ---

if ! echo "$PATH" | tr ':' '\n' | grep -qxF "$BIN_DIR"; then
  warn "$BIN_DIR is not in your PATH."
  echo ""
  echo "  Add to your shell profile:"
  echo ""
  echo "    export PATH=\"$BIN_DIR:\$PATH\""
  echo ""
fi

# --- Done ---

info "Done! $BIN_DIR/$INSTALL_NAME (runtime files in $LIB_DIR)"

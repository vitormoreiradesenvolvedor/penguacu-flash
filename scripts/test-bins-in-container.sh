#!/usr/bin/env bash
# Runs test/bins-compat.test.js inside a glibc 2.31 container — the same glibc
# level as Ubuntu 20.04, where the bundled binaries used to fail to load.
# Falls back to running on the host (weaker check) when no container engine exists.
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$SCRIPT_DIR/.." && pwd)"
IMAGE="${PENGUACU_TEST_IMAGE:-docker.io/library/node:16-bullseye}"

[ -f "$REPO/bin/mkntfs" ] || { echo "bin/mkntfs ausente — execute: npm run prepare-bins"; exit 1; }

ENGINE=""
for E in podman docker; do
  if command -v "$E" &>/dev/null; then ENGINE="$E"; break; fi
done

if [ -z "$ENGINE" ]; then
  echo "⚠ Nenhum container engine encontrado — testando no host (glibc atual)."
  echo "  A falha de carregamento em glibc antiga NÃO é coberta assim."
  exec node "$REPO/test/bins-compat.test.js"
fi

MOUNT_OPT=""
[ "$ENGINE" = "podman" ] && MOUNT_OPT=":z"

echo "=== Testando compatibilidade dos binários em $IMAGE ($ENGINE) ==="
"$ENGINE" run --rm -v "$REPO:/app${MOUNT_OPT}" "$IMAGE" bash -euc '
  export DEBIAN_FRONTEND=noninteractive
  # ntfs-3g gives the test a real system binary to fall back to
  apt-get update -qq >/dev/null 2>&1 && apt-get install -y -qq ntfs-3g >/dev/null 2>&1 || true
  node /app/test/bins-compat.test.js
'

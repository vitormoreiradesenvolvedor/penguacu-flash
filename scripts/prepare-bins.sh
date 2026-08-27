#!/usr/bin/env bash
# Prepares bundled binaries for the standalone AppImage.
# Run once before "npm run dist" on the BUILD machine.
# End users run the resulting AppImage without installing anything.
#
# COMPATIBILITY RULE — read before changing anything here:
#   These binaries run on the USER's machine, not ours. Copying mkntfs/ms-sys from
#   a modern build system produces an AppImage that dies on older distros:
#     mkntfs: error while loading shared libraries: libntfs-3g.so.89
#     ms-sys: /lib/x86_64-linux-gnu/libc.so.6: version `GLIBC_2.34' not found
#   (both reproduced on Ubuntu 20.04, glibc 2.31 — it could not create a USB drive).
#   So we build them inside a Debian 11 container (glibc 2.31) with libntfs-3g
#   linked *into* mkntfs, which makes them work on any distro with glibc >= 2.17.
#
# Set PENGUACU_NO_CONTAINER=1 to skip the container and copy from the build system
# instead — faster for local development, but the result is NOT portable.
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BIN_DIR="$SCRIPT_DIR/../bin"
mkdir -p "$BIN_DIR"

# Debian 11 = glibc 2.31, same level as Ubuntu 20.04, and still has working apt
# repositories (Ubuntu 20.04's have moved to old-releases).
BUILDER_IMAGE="${PENGUACU_BUILDER_IMAGE:-docker.io/library/debian:11}"
NTFS3G_VERSIONS="2022.10.3 2021.8.22"
MSSYS_VERSIONS="2.7.0 2.6.0"

ok()   { printf "  \033[32m✓\033[0m %s\n" "$*"; }
warn() { printf "  \033[33m⚠\033[0m %s\n" "$*"; }
err()  { printf "  \033[31m✗\033[0m %s\n" "$*"; exit 1; }

echo "=== Preparando binários para AppImage standalone ==="
echo ""

# ── Highest glibc version a binary requires (empty when static) ──────────────
max_glibc() {
  objdump -T "$1" 2>/dev/null | grep -o "GLIBC_[0-9.]*" | sed 's/GLIBC_//' | sort -V | tail -1
}

# A bundled binary is portable when it needs no glibc newer than 2.31 (Ubuntu
# 20.04 / Debian 11) and links no library that ships only on modern systems.
# libuuid.so.1 and libc.so.6 are fine — every distro has them with stable sonames.
is_portable() {
  local f="$1" v
  [ -f "$f" ] || return 1
  if ldd "$f" 2>/dev/null | grep -qE "libntfs-3g|libfuse|not found"; then return 1; fi
  v=$(max_glibc "$f")
  [ -z "$v" ] && return 0                                  # fully static
  [ "$(printf '%s\n2.31\n' "$v" | sort -V | head -1)" = "$v" ]
}

report() {
  local f="$1" v deps
  v=$(max_glibc "$f"); deps=$(ldd "$f" 2>/dev/null | grep -oE "lib[a-z0-9._+-]+\.so\.[0-9]+" | sort -u | tr '\n' ' ')
  printf "      glibc: %s | libs: %s\n" "${v:-nenhuma (estático)}" "${deps:-nenhuma}"
}

# ── Container engine detection ──────────────────────────────────────────────
CONTAINER_ENGINE=""
if [ "${PENGUACU_NO_CONTAINER:-0}" != "1" ]; then
  for E in podman docker; do
    if command -v "$E" &>/dev/null; then CONTAINER_ENGINE="$E"; break; fi
  done
fi

# podman on SELinux hosts needs the :z mount label; docker does not use it here
MOUNT_OPT=""
[ "$CONTAINER_ENGINE" = "podman" ] && MOUNT_OPT=":z"

# ── 7zzs — official static binary, portable by construction ─────────────────
if [ ! -f "$BIN_DIR/7zzs" ]; then
  echo "→ Baixando 7-Zip static binary..."
  TMP=$(mktemp -d)
  DOWNLOADED=false
  for VER in 2602 2501 2500 2409 2408 2407; do
    URL="https://www.7-zip.org/a/7z${VER}-linux-x64.tar.xz"
    if curl -fsSL --connect-timeout 15 "$URL" -o "$TMP/7z.tar.xz" 2>/dev/null; then
      DOWNLOADED=true
      break
    fi
  done
  $DOWNLOADED || err "Falha ao baixar 7-Zip. Verifique a conexão com a internet."
  tar -xJf "$TMP/7z.tar.xz" -C "$TMP" 2>/dev/null || err "Falha ao extrair arquivo 7-Zip"
  [ -f "$TMP/7zzs" ] || err "7zzs não encontrado no arquivo baixado"
  cp "$TMP/7zzs" "$BIN_DIR/7zzs"
  chmod +x "$BIN_DIR/7zzs"
  rm -rf "$TMP"
  ok "7zzs baixado e pronto"
else
  ok "7zzs já existe ($(du -sh "$BIN_DIR/7zzs" | cut -f1))"
fi
report "$BIN_DIR/7zzs"

# ── mkntfs + ms-sys — built in the compatibility container ──────────────────
NEED_BUILD=false
is_portable "$BIN_DIR/mkntfs" || NEED_BUILD=true
is_portable "$BIN_DIR/ms-sys" || NEED_BUILD=true

if [ "$NEED_BUILD" = "false" ]; then
  ok "mkntfs e ms-sys já presentes e portáveis"
  report "$BIN_DIR/mkntfs"
  report "$BIN_DIR/ms-sys"
elif [ -n "$CONTAINER_ENGINE" ]; then
  echo "→ Compilando mkntfs e ms-sys em $BUILDER_IMAGE via $CONTAINER_ENGINE (glibc 2.31)..."
  echo "  (leva alguns minutos na primeira execução; a imagem fica em cache depois)"

  "$CONTAINER_ENGINE" run --rm \
    -v "$BIN_DIR:/out${MOUNT_OPT}" \
    -e "NTFS3G_VERSIONS=$NTFS3G_VERSIONS" \
    -e "MSSYS_VERSIONS=$MSSYS_VERSIONS" \
    "$BUILDER_IMAGE" bash -euc '
      export DEBIAN_FRONTEND=noninteractive
      apt-get update -qq >/dev/null
      apt-get install -y -qq build-essential curl ca-certificates uuid-dev pkg-config \
                             gettext file binutils >/dev/null
      echo "  → dependências de build instaladas (glibc $(ldd --version | head -1 | grep -oE "[0-9]+\.[0-9]+$"))"

      cd /tmp
      # ── mkntfs: --disable-library links libntfs-3g INTO the binaries, so the
      #    user does not need a matching libntfs-3g.so.NN installed.
      BUILT=false
      for V in $NTFS3G_VERSIONS; do
        echo "  → baixando ntfs-3g $V..."
        curl -fsSL --connect-timeout 30 --retry 2 \
             "https://tuxera.com/opensource/ntfs-3g_ntfsprogs-${V}.tgz" -o ntfs.tgz || continue
        tar xzf ntfs.tgz || continue
        cd "ntfs-3g_ntfsprogs-${V}" || continue
        echo "  → compilando ntfsprogs $V..."
        if ./configure --disable-shared --enable-static --disable-library \
                       --disable-ntfs-3g --enable-really-static \
                       --disable-mount-helper --disable-ldconfig >/tmp/conf.log 2>&1 \
           && make -j"$(nproc)" >/tmp/make.log 2>&1; then
          B=$(find . -type f -name mkntfs -perm -u+x | head -1)
          if [ -n "$B" ]; then
            strip "$B" 2>/dev/null || true
            cp "$B" /out/mkntfs && chmod 755 /out/mkntfs
            echo "  ✓ mkntfs $V compilado"
            BUILT=true
            break
          fi
        fi
        echo "  ⚠ falha ao compilar ntfs-3g $V"
        tail -5 /tmp/conf.log /tmp/make.log 2>/dev/null || true
        cd /tmp
      done
      $BUILT || { echo "  ✗ nenhuma versão do ntfs-3g compilou"; exit 1; }

      # ── ms-sys: only needs libc → link fully static, zero runtime deps.
      cd /tmp
      BUILT=false
      for V in $MSSYS_VERSIONS; do
        echo "  → baixando ms-sys $V..."
        curl -fsSL -L --connect-timeout 30 --max-redirs 10 --retry 2 \
             "https://downloads.sourceforge.net/ms-sys/ms-sys-${V}.tar.gz" -o ms.tgz || continue
        [ -s ms.tgz ] || continue
        tar xzf ms.tgz || continue
        SRC=$(find /tmp -maxdepth 2 -type d -name "ms-sys-${V}" | head -1)
        [ -n "$SRC" ] || continue
        echo "  → compilando ms-sys $V (estático)..."
        if make -C "$SRC" LDFLAGS=-static >/tmp/ms.log 2>&1; then
          B=$(find "$SRC" -type f -name ms-sys -perm -u+x | head -1)
          if [ -n "$B" ] && file "$B" | grep -q ELF; then
            strip "$B" 2>/dev/null || true
            cp "$B" /out/ms-sys && chmod 755 /out/ms-sys
            echo "  ✓ ms-sys $V compilado (estático)"
            BUILT=true
            break
          fi
        fi
        echo "  ⚠ falha ao compilar ms-sys $V"
        tail -5 /tmp/ms.log 2>/dev/null || true
      done
      $BUILT || { echo "  ✗ nenhuma versão do ms-sys compilou"; exit 1; }
    ' || err "Falha na compilação dentro do container. Verifique a saída acima."

  is_portable "$BIN_DIR/mkntfs" || err "mkntfs compilado mas não passou na verificação de portabilidade"
  is_portable "$BIN_DIR/ms-sys" || err "ms-sys compilado mas não passou na verificação de portabilidade"
  ok "mkntfs portável (libntfs-3g embutida)"
  report "$BIN_DIR/mkntfs"
  ok "ms-sys portável — UEFI + BIOS habilitado"
  report "$BIN_DIR/ms-sys"

else
  # ── Fallback: no container engine (or PENGUACU_NO_CONTAINER=1) ────────────
  warn "Nenhum engine de container disponível (podman/docker) — copiando do sistema."
  warn "O AppImage resultante pode NÃO funcionar em distros mais antigas que a sua."
  warn "Para um build portável, instale podman ou docker e execute novamente."

  if [ ! -f "$BIN_DIR/mkntfs" ]; then
    for CMD in mkntfs mkfs.ntfs; do
      if P=$(command -v "$CMD" 2>/dev/null); then
        cp "$P" "$BIN_DIR/mkntfs"; chmod +x "$BIN_DIR/mkntfs"
        ok "mkntfs copiado de $P"
        break
      fi
    done
    [ -f "$BIN_DIR/mkntfs" ] || err "mkntfs não encontrado. Instale ntfsprogs/ntfs-3g e execute novamente."
  fi
  report "$BIN_DIR/mkntfs"
  is_portable "$BIN_DIR/mkntfs" || warn "mkntfs NÃO é portável — falhará em distros com glibc antiga"

  if [ ! -f "$BIN_DIR/ms-sys" ]; then
    if P=$(command -v ms-sys 2>/dev/null); then
      cp "$P" "$BIN_DIR/ms-sys"; chmod +x "$BIN_DIR/ms-sys"
      ok "ms-sys copiado de $P — UEFI + BIOS habilitado"
    else
      warn "ms-sys não encontrado no sistema — o pendrive suportará apenas UEFI"
    fi
  fi
  if [ -f "$BIN_DIR/ms-sys" ]; then
    report "$BIN_DIR/ms-sys"
    is_portable "$BIN_DIR/ms-sys" || warn "ms-sys NÃO é portável — falhará em distros com glibc antiga"
  fi
fi

echo ""
echo "Binários em bin/:"
ls -lh "$BIN_DIR/"
echo ""
echo "=== Pronto! Execute npm run dist para gerar o AppImage ==="

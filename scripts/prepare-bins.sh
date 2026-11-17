#!/usr/bin/env bash
# Prepares bundled binaries for the standalone AppImage.
# Run once before "npm run dist" on the BUILD machine.
# End users run the resulting AppImage without installing anything.
#
# OFFLINE BY DESIGN — nothing is downloaded, by the app or by the build:
#   vendor/bin/  ready-to-ship portable binaries (+ SHA256SUMS), committed to git
#   vendor/src/  the source tarballs they were built from (+ SHA256SUMS)
# Default mode copies vendor/bin/ into bin/ after verifying checksums and
# portability — no network, no container. Upstream sites (tuxera, sourceforge,
# GNU, Debian mirrors, 7-zip.org, GitHub) going away cannot break the build.
#
#   bash scripts/prepare-bins.sh             # offline: vendor/bin → bin
#   bash scripts/prepare-bins.sh --rebuild   # recompile vendor/src in a container
#
# COMPATIBILITY RULE — read before changing anything here:
#   These binaries run on the USER's machine, not ours. Copying mkntfs/ms-sys from
#   a modern build system produces an AppImage that dies on older distros:
#     mkntfs: error while loading shared libraries: libntfs-3g.so.89
#     ms-sys: /lib/x86_64-linux-gnu/libc.so.6: version `GLIBC_2.34' not found
#   (both reproduced on Ubuntu 20.04, glibc 2.31 — it could not create a USB drive).
#   So --rebuild compiles them inside a Debian 11 container (glibc 2.31): mkntfs
#   with libntfs-3g linked in, ms-sys/parted/partprobe fully static. The result
#   runs on any distro with glibc >= 2.17.
#
# --rebuild is the only mode that needs the network (container image + Debian
# build packages); its sources still come from vendor/src. It rewrites
# vendor/bin/ and its SHA256SUMS — commit both afterwards.
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
BIN_DIR="$ROOT/bin"
VENDOR_BIN="$ROOT/vendor/bin"
VENDOR_SRC="$ROOT/vendor/src"
mkdir -p "$BIN_DIR"

# Every file the AppImage ships in resources/bin/
BUNDLED="7zzs mkntfs ms-sys parted partprobe uefi-ntfs.img"
# Of those, the ELF executables that must pass the portability check
EXECUTABLES="7zzs mkntfs ms-sys parted partprobe"

# Debian 11 = glibc 2.31, same level as Ubuntu 20.04
BUILDER_IMAGE="${PENGUACU_BUILDER_IMAGE:-docker.io/library/debian:11}"
NTFS3G_VERSION="2022.10.3"
MSSYS_VERSION="2.7.0"
PARTED_VERSION="3.6"

ok()   { printf "  \033[32m✓\033[0m %s\n" "$*"; }
warn() { printf "  \033[33m⚠\033[0m %s\n" "$*"; }
err()  { printf "  \033[31m✗\033[0m %s\n" "$*"; exit 1; }

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
  if ldd "$f" 2>/dev/null | grep -qE "libntfs-3g|libfuse|libparted|libreadline|libdevmapper|not found"; then return 1; fi
  v=$(max_glibc "$f")
  [ -z "$v" ] && return 0                                  # fully static
  [ "$(printf '%s\n2.31\n' "$v" | sort -V | head -1)" = "$v" ]
}

report() {
  local f="$1" v deps
  v=$(max_glibc "$f"); deps=$(ldd "$f" 2>/dev/null | grep -oE "lib[a-z0-9._+-]+\.so\.[0-9]+" | sort -u | tr '\n' ' ')
  printf "      glibc: %s | libs: %s\n" "${v:-nenhuma (estático)}" "${deps:-nenhuma}"
}

# ── --rebuild: compile vendor/src inside the compatibility container ─────────
rebuild() {
  echo "=== Recompilando binários a partir de vendor/src ==="
  (cd "$VENDOR_SRC" && sha256sum -c --quiet SHA256SUMS) || err "vendor/src/SHA256SUMS não confere — fontes alteradas"
  ok "fontes conferidas (vendor/src/SHA256SUMS)"

  local engine="" src_opt=":ro" out_opt=""
  for E in podman docker; do
    if command -v "$E" &>/dev/null; then engine="$E"; break; fi
  done
  [ -n "$engine" ] || err "--rebuild precisa de podman ou docker"
  # podman on SELinux hosts needs the :z mount label; docker does not use it here
  [ "$engine" = "podman" ] && { src_opt=":ro,z"; out_opt=":z"; }

  local out; out=$(mktemp -d)
  echo "→ Compilando em $BUILDER_IMAGE via $engine (glibc 2.31)..."
  "$engine" run --rm \
    -v "$VENDOR_SRC:/src${src_opt}" \
    -v "$out:/out${out_opt}" \
    -e "NTFS3G_VERSION=$NTFS3G_VERSION" -e "MSSYS_VERSION=$MSSYS_VERSION" -e "PARTED_VERSION=$PARTED_VERSION" \
    "$BUILDER_IMAGE" bash -euc '
      export DEBIAN_FRONTEND=noninteractive
      PKGS="build-essential uuid-dev pkg-config gettext file binutils xz-utils"
      # Debian 11 left LTS: its packages moved from deb.debian.org to
      # archive.debian.org (the index may still download while the .debs 404).
      if ! { apt-get update -qq >/dev/null && apt-get install -y -qq $PKGS >/dev/null 2>&1; }; then
        echo "  → espelho padrão do Debian 11 indisponível — usando archive.debian.org"
        rm -f /etc/apt/sources.list.d/*
        printf "%s\n" "deb http://archive.debian.org/debian bullseye main" \
                      "deb http://archive.debian.org/debian-security bullseye-security main" \
          > /etc/apt/sources.list
        apt-get -o Acquire::Check-Valid-Until=false update -qq >/dev/null
        apt-get install -y -qq $PKGS >/dev/null
      fi
      echo "  → dependências de build instaladas (glibc $(ldd --version | head -1 | grep -oE "[0-9]+\.[0-9]+$"))"

      # ── mkntfs: --disable-library links libntfs-3g INTO the binaries, so the
      #    user does not need a matching libntfs-3g.so.NN installed.
      cd /tmp && tar xzf "/src/ntfs-3g_ntfsprogs-${NTFS3G_VERSION}.tgz" && cd "ntfs-3g_ntfsprogs-${NTFS3G_VERSION}"
      echo "  → compilando ntfsprogs $NTFS3G_VERSION..."
      ./configure --disable-shared --enable-static --disable-library \
                  --disable-ntfs-3g --enable-really-static \
                  --disable-mount-helper --disable-ldconfig >/tmp/conf.log 2>&1 \
        && make -j"$(nproc)" >/tmp/make.log 2>&1 \
        || { tail -20 /tmp/conf.log /tmp/make.log; exit 1; }
      cp "$(find . -type f -name mkntfs -perm -u+x | head -1)" /out/mkntfs

      # ── ms-sys: only needs libc → link fully static, zero runtime deps.
      cd /tmp && tar xzf "/src/ms-sys-${MSSYS_VERSION}.tar.gz"
      echo "  → compilando ms-sys $MSSYS_VERSION (estático)..."
      make -C "/tmp/ms-sys-${MSSYS_VERSION}" LDFLAGS=-static >/tmp/ms.log 2>&1 || { tail -20 /tmp/ms.log; exit 1; }
      cp "$(find "/tmp/ms-sys-${MSSYS_VERSION}" -type f -name ms-sys -perm -u+x | head -1)" /out/ms-sys

      # ── parted + partprobe: libparted linked in, fully static. No device-mapper
      #    or readline — the app only runs parted in script mode (-s).
      cd /tmp && tar xJf "/src/parted-${PARTED_VERSION}.tar.xz" && cd "parted-${PARTED_VERSION}"
      echo "  → compilando parted $PARTED_VERSION (estático)..."
      ./configure --disable-shared --enable-static --disable-device-mapper \
                  --without-readline --disable-nls >/tmp/pconf.log 2>&1 \
        && make -j"$(nproc)" LDFLAGS=-all-static >/tmp/pmake.log 2>&1 \
        || { tail -20 /tmp/pconf.log /tmp/pmake.log; exit 1; }
      cp parted/parted partprobe/partprobe /out/

      strip /out/* && chmod 755 /out/*
      echo "  ✓ mkntfs, ms-sys, parted e partprobe compilados"
    ' || err "Falha na compilação dentro do container. Verifique a saída acima."

  for f in mkntfs ms-sys parted partprobe; do
    is_portable "$out/$f" || err "$f compilado mas não passou na verificação de portabilidade"
    cp "$out/$f" "$VENDOR_BIN/$f"
  done
  rm -rf "$out"
  (cd "$VENDOR_BIN" && sha256sum $BUNDLED > SHA256SUMS)
  ok "vendor/bin/ e vendor/bin/SHA256SUMS atualizados — faça commit de ambos"
  echo ""
}

[ "${1:-}" = "--rebuild" ] && rebuild

# ── Offline copy: vendor/bin → bin ───────────────────────────────────────────
echo "=== Preparando binários para AppImage standalone (offline) ==="
echo ""
(cd "$VENDOR_BIN" && sha256sum -c --quiet SHA256SUMS) \
  || err "vendor/bin/SHA256SUMS não confere — binários alterados ou incompletos"
ok "vendor/bin conferido (SHA256SUMS)"

for f in $BUNDLED; do
  cp "$VENDOR_BIN/$f" "$BIN_DIR/$f"
done
chmod 755 $(printf "$BIN_DIR/%s " $EXECUTABLES)
chmod 644 "$BIN_DIR/uefi-ntfs.img"

for f in $EXECUTABLES; do
  is_portable "$BIN_DIR/$f" || err "$f não é portável — execute com --rebuild"
  ok "$f"
  report "$BIN_DIR/$f"
done
ok "uefi-ntfs.img (UEFI:NTFS — boot UEFI a partir do NTFS)"

echo ""
echo "Binários em bin/:"
ls -lh "$BIN_DIR/"
echo ""
echo "=== Pronto! Execute npm run dist para gerar o AppImage ==="

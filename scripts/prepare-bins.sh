#!/usr/bin/env bash
# Prepares bundled binaries for the standalone AppImage.
# Run once before "npm run dist" on the BUILD machine.
# End users run the resulting AppImage without installing anything.
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BIN_DIR="$SCRIPT_DIR/../bin"
mkdir -p "$BIN_DIR"

ok()   { printf "  \033[32m✓\033[0m %s\n" "$*"; }
warn() { printf "  \033[33m⚠\033[0m %s\n" "$*"; }
err()  { printf "  \033[31m✗\033[0m %s\n" "$*"; exit 1; }

echo "=== Preparando binários para AppImage standalone ==="
echo ""

# ── 7zzs — static 7-Zip binary (official download, no compilation needed)
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

# ── mkntfs — copied from the build system
# Requires ntfsprogs on the build machine: sudo dnf install ntfsprogs
if [ ! -f "$BIN_DIR/mkntfs" ]; then
  for CMD in mkntfs mkfs.ntfs; do
    if P=$(command -v "$CMD" 2>/dev/null); then
      cp "$P" "$BIN_DIR/mkntfs"
      chmod +x "$BIN_DIR/mkntfs"
      ok "mkntfs copiado de $P"
      break
    fi
  done
  if [ ! -f "$BIN_DIR/mkntfs" ]; then
    echo ""
    err "mkntfs não encontrado na máquina de build.
       Instale: sudo dnf install ntfsprogs
       Depois execute novamente: npm run prepare-bins"
  fi
else
  ok "mkntfs já existe ($(du -sh "$BIN_DIR/mkntfs" | cut -f1))"
fi

# ── ms-sys — build from source for BIOS legacy boot support
# Tries: 1) already in bin/, 2) system ms-sys, 3) build from SourceForge tarball
if [ ! -f "$BIN_DIR/ms-sys" ]; then
  if P=$(command -v ms-sys 2>/dev/null); then
    cp "$P" "$BIN_DIR/ms-sys"
    chmod +x "$BIN_DIR/ms-sys"
    ok "ms-sys copiado de $P — UEFI + BIOS habilitado"
  else
    echo "→ ms-sys não encontrado — compilando do fonte..."
    # Check build deps
    for DEP in gcc make curl; do
      command -v "$DEP" &>/dev/null || { warn "Dependência de build ausente: $DEP — ms-sys não será compilado"; SKIP_MSSYS=true; break; }
    done
    if [ "${SKIP_MSSYS:-false}" = "true" ]; then
      warn "ms-sys ignorado — o pendrive suportará apenas UEFI"
    else
      TMP=$(mktemp -d)
      BUILT=false
      for VER in 2.7.0 2.6.0 2.5.0; do
        # Direct SourceForge CDN URL — avoids the browser-redirect wrapper
        URL="https://downloads.sourceforge.net/ms-sys/ms-sys-${VER}.tar.gz"
        echo "  → Baixando ms-sys ${VER}..."
        if curl -fsSL -L --connect-timeout 30 --max-redirs 10 --retry 2 "$URL" \
               -o "$TMP/ms-sys.tar.gz" 2>/dev/null \
           && [ -s "$TMP/ms-sys.tar.gz" ] \
           && tar -xzf "$TMP/ms-sys.tar.gz" -C "$TMP" 2>/dev/null; then
          # Find the directory that contains the Makefile
          SRC=$(find "$TMP" -maxdepth 3 -name Makefile | head -1 | xargs -I{} dirname {})
          if [ -n "$SRC" ]; then
            echo "  → Compilando ms-sys ${VER}..."
            # Dynamic link is fine — ms-sys only needs libc which every distro ships
            if make -C "$SRC" 2>/dev/null; then
              # Makefile puts binary at build/bin/ms-sys (depth 3 from source root)
              MSSYS_BIN=$(find "$SRC" -maxdepth 4 -type f -name "ms-sys" \
                          ! -name "*.c" ! -name "*.h" ! -name "*.o" | head -1)
              if [ -n "$MSSYS_BIN" ] && file "$MSSYS_BIN" 2>/dev/null | grep -q "ELF"; then
                cp "$MSSYS_BIN" "$BIN_DIR/ms-sys"
                chmod +x "$BIN_DIR/ms-sys"
                ok "ms-sys ${VER} compilado e pronto — UEFI + BIOS habilitado"
                BUILT=true
                break
              else
                echo "  ⚠ Binário ELF não encontrado após make em $SRC"
              fi
            else
              echo "  ⚠ make falhou para ms-sys ${VER}"
            fi
          fi
        else
          echo "  ⚠ Download falhou para ms-sys ${VER}"
        fi
      done
      rm -rf "$TMP"
      if ! $BUILT; then
        warn "Não foi possível compilar ms-sys — o pendrive suportará apenas UEFI"
        warn "Para BIOS legado, instale via COPR e reexecute prepare-bins:"
        warn "  sudo dnf copr enable tuxfixup/ms-sys && sudo dnf install ms-sys"
        warn "  npm run prepare-bins"
      fi
    fi
  fi
else
  ok "ms-sys já existe — UEFI + BIOS habilitado"
fi

echo ""
echo "Binários em bin/:"
ls -lh "$BIN_DIR/"
echo ""
echo "=== Pronto! Execute npm run dist para gerar o AppImage ==="

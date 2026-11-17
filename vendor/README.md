# vendor/

Everything the AppImage bundles in `resources/bin/`, committed so the build is
**offline**: `npm run prepare-bins` only copies `vendor/bin/` into `bin/` after
checking `SHA256SUMS`. No upstream site (tuxera, SourceForge, GNU, Debian
mirrors, 7-zip.org, GitHub) needs to be reachable to build or run the app.

## bin/ — shipped as-is

| File | Version | Origin | License |
|---|---|---|---|
| `7zzs` | 7-Zip 26.02 | official static build, `7z2602-linux-x64.tar.xz` from 7-zip.org | LGPL + unRAR restriction |
| `mkntfs` | ntfs-3g 2022.10.3 | built from `src/ntfs-3g_ntfsprogs-2022.10.3.tgz` (libntfs-3g linked in) | GPLv2 |
| `ms-sys` | 2.7.0 | built from `src/ms-sys-2.7.0.tar.gz`, static | GPLv2 |
| `parted`, `partprobe` | GNU parted 3.6 | built from `src/parted-3.6.tar.xz`, static, no device-mapper/readline | GPLv3 |
| `uefi-ntfs.img` | Rufus v4.16 | `res/uefi/uefi-ntfs.img` of github.com/pbatard/rufus — source: github.com/pbatard/uefi-ntfs | GPLv2+ |

The compiled tools were built in a Debian 11 container (glibc 2.31): they run
on Ubuntu 20.04 and anything newer. `prepare-bins` rejects any binary that
needs a newer glibc or a library users may not have.

## src/ — sources of the compiled tools

Exact upstream tarballs (checksums in `src/SHA256SUMS`). They are the input of
`bash scripts/prepare-bins.sh --rebuild`, and the source offer for the GPL
binaries the AppImage distributes.

## Updating a component

1. Replace the tarball in `src/` and update `src/SHA256SUMS`
   (`cd vendor/src && sha256sum *.tgz *.tar.* > SHA256SUMS`).
2. Bump the matching `*_VERSION` in `scripts/prepare-bins.sh`.
3. `bash scripts/prepare-bins.sh --rebuild` — recompiles, checks portability and
   rewrites `bin/` + `bin/SHA256SUMS`. Needs podman/docker and network for the
   container image and Debian build packages; nothing else.
4. Commit `vendor/`. 7zzs and uefi-ntfs.img are replaced by hand (then rerun
   `sha256sum` in `bin/`).

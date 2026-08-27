/**
 * Resolution of external binaries (mkntfs, ms-sys, parted, 7z, xorriso).
 *
 * Extracted from main.js so it can be exercised outside Electron — the whole
 * point of this module is behaviour on OTHER distros than the build machine's,
 * which is only verifiable by running it inside a container of that distro.
 *
 * Background: a bundled binary can be present and +x yet still be unusable —
 * the dynamic loader refuses it when the host's glibc is older than the build
 * machine's, or when a library it was linked against is missing. Both happened
 * on Ubuntu 20.04 (glibc 2.31):
 *
 *   mkntfs: error while loading shared libraries: libntfs-3g.so.89
 *   ms-sys: /lib/x86_64-linux-gnu/libc.so.6: version `GLIBC_2.34' not found
 *
 * accessSync(X_OK) does NOT catch that — only running the binary does.
 */

const path       = require('path')
const fsSync     = require('fs')
const { spawnSync, execSync } = require('child_process')

// Messages the dynamic loader (not the program) prints when it refuses to start.
// A non-zero exit from the program itself is fine — some tools exit non-zero for
// --version — so only these signatures mark a binary as broken.
const LOADER_ERROR = /(error while loading shared libraries|cannot open shared object file|GLIBC_[0-9.]+' not found|version `GLIBC|Exec format error)/i

// Probes a binary by actually executing it. `--version` is accepted by every
// tool we bundle and never touches a device.
function binRuns(cmdPath) {
  try {
    const r = spawnSync(cmdPath, ['--version'], { timeout: 5000, encoding: 'utf8' })
    if (r.error) return false                       // ENOENT / EACCES / spawn failure
    // 127 = command/library not found, 126 = found but not executable. None of the
    // tools we bundle uses those codes for --version, so they always mean the
    // binary did not start. Note execvp falls back to /bin/sh for non-ELF files,
    // which turns garbage into a shell error with status 127 rather than ENOEXEC.
    if (r.status === 126 || r.status === 127) return false
    // Loader messages can also appear while the process still exits 0-ish.
    return !LOADER_ERROR.test(String(r.stderr || ''))
  } catch { return false }
}

function systemPath(name) {
  try {
    const p = execSync(`command -v ${name}`, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()
    return p || null
  } catch { return null }
}

/**
 * @param {string} binDir            directory holding the bundled binaries
 * @param {(msg: string) => void} [onWarn]  called when a bundled binary is rejected
 */
function createBinResolver(binDir, onWarn = () => {}) {
  // Cached so each probe runs at most once per app session — binCmd is called on
  // every dependency check and every build.
  const cache = new Map()

  /**
   * Path of the first candidate that actually EXECUTES on this host:
   * 1. bundled binary in binDir, 2. same name on the system PATH.
   * @returns {string|null} null when nothing usable is found
   */
  function binCmd(...names) {
    const key = names.join('|')
    if (cache.has(key)) return cache.get(key)

    let resolved = null
    for (const name of names) {
      const bundled = path.join(binDir, name)
      let bundledExists = false
      try { fsSync.accessSync(bundled, fsSync.constants.X_OK); bundledExists = true } catch {}
      if (bundledExists && binRuns(bundled)) { resolved = bundled; break }

      // Bundled copy missing or unusable on this distro → try the system's own.
      const sysPath = systemPath(name)
      if (sysPath && binRuns(sysPath)) {
        if (bundledExists) onWarn(`binário embarcado "${name}" não é executável neste sistema — usando ${sysPath}`)
        resolved = sysPath
        break
      }
    }

    cache.set(key, resolved)
    return resolved
  }

  const cmdExists = (...names) => binCmd(...names) !== null

  return { binCmd, cmdExists, clearCache: () => cache.clear() }
}

// Package names differ per distro, so a generic "sudo dnf install X" hint is
// useless to most users. Detect the package manager once and name the right package.
const PKG_MANAGERS = [
  { bin: 'apt',    cmd: 'sudo apt install',    names: { 'ntfs-3g': 'ntfs-3g',   'p7zip-full': 'p7zip-full' } },
  { bin: 'dnf',    cmd: 'sudo dnf install',    names: { 'ntfs-3g': 'ntfsprogs', 'p7zip-full': 'p7zip'      } },
  { bin: 'pacman', cmd: 'sudo pacman -S',      names: { 'ntfs-3g': 'ntfs-3g',   'p7zip-full': 'p7zip'      } },
  { bin: 'zypper', cmd: 'sudo zypper install', names: { 'ntfs-3g': 'ntfsprogs', 'p7zip-full': 'p7zip'      } },
  { bin: 'apk',    cmd: 'sudo apk add',        names: { 'ntfs-3g': 'ntfs-3g',   'p7zip-full': 'p7zip'      } },
]

let pkgManager
function installHint(pkg) {
  if (pkgManager === undefined) {
    pkgManager = PKG_MANAGERS.find(m => systemPath(m.bin)) || null
  }
  if (!pkgManager) return `instale o pacote "${pkg}" pelo gerenciador da sua distribuição`
  return `${pkgManager.cmd} ${pkgManager.names[pkg] || pkg}`
}

module.exports = { createBinResolver, binRuns, installHint }

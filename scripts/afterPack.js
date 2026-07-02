/**
 * afterPack hook — runs after files are staged in appOutDir, before the AppImage
 * squashfs is assembled.
 *
 * We replace the Electron binary entry point with a shell wrapper that:
 *   1. Sets GTK/IBus/Vulkan env vars BEFORE Electron's C runtime initialises them
 *      (process.env assignments in main.js are too late — GTK loads before Node.js runs)
 *   2. Filters known noisy lines from stderr as belt-and-suspenders
 *
 * GTK_IM_MODULE notes:
 *   - GTK_IM_MODULE=""  → empty means "use default", default is often IBus → warning still appears
 *   - GTK_IM_MODULE=gtk-im-context-simple → explicit built-in method, no IBus loaded
 */

const path = require('path')
const fs   = require('fs')

exports.default = async function afterPack({ appOutDir, electronPlatformName }) {
  if (electronPlatformName !== 'linux') return

  const binaryName = 'win10-iso-builder'
  const binaryPath = path.join(appOutDir, binaryName)

  if (!fs.existsSync(binaryPath)) {
    console.warn('[afterPack] Electron binary not found at:', binaryPath)
    return
  }

  const realBinaryPath = path.join(appOutDir, binaryName + '.bin')
  fs.renameSync(binaryPath, realBinaryPath)

  const wrapper = `#!/bin/bash
# ── Suppress GTK / IBus / Vulkan terminal noise ──────────────────────────────
# Set BEFORE the Electron binary starts — GTK/IBus/Vulkan initialise in the
# C runtime, before Node.js is running, so process.env changes in main.js are
# too late to affect them.

export IBUS_DISABLE_SNOOPER=1

# gtk-im-context-simple = built-in minimal IM, no IBus loaded.
# "" means "use default" which is often IBus → warning still fires.
export GTK_IM_MODULE=gtk-im-context-simple

export GTK_USE_PORTAL=0
export GTK_RECENT_FILES_LIMIT=0
export VK_LOADER_DEBUG=none
# Lock Vulkan loader to bundled SwiftShader — prevents ELFCLASS32 warning from
# /usr/lib/libGLX_nvidia.so.0 (32-bit NVIDIA ICD that appears on some Fedora systems).
export VK_ICD_FILENAMES="\${APPDIR}/vk_swiftshader_icd.json"
# ─────────────────────────────────────────────────────────────────────────────

# Belt-and-suspenders: filter any remaining known-noisy lines from stderr.
# exec 2>(...) redirects this shell's fd2 BEFORE exec replaces the process,
# so the Electron binary inherits the filtered stderr file descriptor.
exec 2> >(grep -Ev "(IBUS-WARNING|GLib-GObject.*invalid cast|GLib-GObject.*no handler|libGLX_nvidia|loader_icd_scan|terminator_CreateInstance)" >&2)

exec "\${APPDIR}/${binaryName}.bin" "$@"
`

  fs.writeFileSync(binaryPath, wrapper, { encoding: 'utf8', mode: 0o755 })
  console.log('[afterPack] Wrapped Electron binary with env + stderr filter')
}

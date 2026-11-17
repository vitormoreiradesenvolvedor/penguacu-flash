/**
 * Partition layout of the bootable USB drive.
 *
 * Kept out of main.js so it can be tested without Electron or root — the
 * commands it builds are exercised against a plain image file in
 * test/usb-layout.test.js.
 *
 * Background: Windows media needs NTFS when install.wim is larger than 4 GiB
 * (the FAT32 file-size limit), but UEFI firmware only reads FAT. A drive with a
 * single NTFS partition therefore boots in BIOS/CSM mode only — on a UEFI
 * machine the firmware silently skips it and starts the next boot entry.
 *
 * Fix (same layout Rufus uses): MBR with
 *   p1  NTFS, active        — Windows files; BIOS boots it via ms-sys boot code
 *   p2  FAT, type 0xEF, 1 MiB at the end of the disk — UEFI:NTFS
 * UEFI:NTFS (github.com/pbatard/uefi-ntfs) is a tiny EFI loader that carries an
 * NTFS driver: the firmware boots it from the FAT partition, it mounts p1 and
 * chain-loads \efi\boot\bootx64.efi from there.
 */

const MiB = 1024 * 1024

/** /dev/sdb → /dev/sdb2, but /dev/nvme0n1 or /dev/mmcblk0 → p2 suffix */
function partitionPath(device, n) {
  return /\d$/.test(device) ? `${device}p${n}` : `${device}${n}`
}

/**
 * @param {number} diskBytes   size of the whole USB device
 * @param {number} [espBytes]  size of the UEFI:NTFS image; 0 = no UEFI partition
 * @returns {{ ntfsStartMiB: number, ntfsEndMiB: number, espStartMiB: number|null, espEndMiB: number|null }}
 *          MiB boundaries (end exclusive) — partitions are MiB-aligned
 */
function computeLayout(diskBytes, espBytes = 0) {
  const diskMiB = Math.floor(Number(diskBytes) / MiB)
  const espMiB  = espBytes > 0 ? Math.ceil(espBytes / MiB) : 0
  // 1 MiB for the MBR/alignment gap + at least 1 MiB of NTFS + the ESP
  if (!Number.isFinite(diskMiB) || diskMiB < 2 + espMiB)
    throw new Error(`dispositivo pequeno demais (${diskBytes} bytes)`)

  const espStartMiB = espMiB ? diskMiB - espMiB : null
  return {
    ntfsStartMiB: 1,
    ntfsEndMiB:   espMiB ? espStartMiB : diskMiB,
    espStartMiB,
    espEndMiB:    espMiB ? diskMiB : null,
  }
}

// parted's end position is INCLUSIVE and must lie inside the device: "64MiB" as
// the end of a disk of exactly 64 MiB is rejected as out of range. Byte units
// with end = boundary - 1 are exact whatever the drive's size.
const range = (startMiB, endMiB) => [`${startMiB * MiB}B`, `${endMiB * MiB - 1}B`]

/** parted arguments that write the MBR layout returned by computeLayout */
function partedArgs(layout) {
  const args = ['mklabel', 'msdos',
    'mkpart', 'primary', 'ntfs', ...range(layout.ntfsStartMiB, layout.ntfsEndMiB)]
  if (layout.espStartMiB !== null)
    args.push('mkpart', 'primary', 'fat16', ...range(layout.espStartMiB, layout.espEndMiB))
  args.push('set', '1', 'boot', 'on')
  // "esp" on an msdos label sets partition type 0xEF (EFI System Partition)
  if (layout.espStartMiB !== null) args.push('set', '2', 'esp', 'on')
  return args
}

module.exports = { MiB, partitionPath, computeLayout, partedArgs }

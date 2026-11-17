/**
 * Regression test for the UEFI boot failure: the USB drive was a single NTFS
 * partition on MBR, which UEFI firmware cannot read — UEFI machines skipped it
 * silently and booted the next entry (e.g. the GRUB of the internal disk).
 *
 * Checks the layout math and, when parted is installed, applies the exact
 * parted arguments + dd offset used by main.js to a plain image file (no root,
 * no real device needed):
 *   npm run test:layout
 */

const fs   = require('fs')
const os   = require('os')
const path = require('path')
const { execFileSync } = require('child_process')
const { MiB, partitionPath, computeLayout, partedArgs } = require('../lib/usb-layout')

let pass = 0, fail = 0
function check(name, got, want) {
  const okay = JSON.stringify(got) === JSON.stringify(want)
  okay ? pass++ : fail++
  console.log(`${okay ? '  ✓' : '  ✗'} ${name}`)
  if (!okay) console.log(`      esperado: ${JSON.stringify(want)}\n      obtido:   ${JSON.stringify(got)}`)
}
const has = cmd => { try { execFileSync('sh', ['-c', `command -v ${cmd}`], { stdio: 'ignore' }); return true } catch { return false } }

// 1. Partition device names
check('sdb → sdb2',           partitionPath('/dev/sdb', 2),     '/dev/sdb2')
check('nvme0n1 → nvme0n1p2',  partitionPath('/dev/nvme0n1', 2), '/dev/nvme0n1p2')
check('mmcblk0 → mmcblk0p1',  partitionPath('/dev/mmcblk0', 1), '/dev/mmcblk0p1')

// 2. Layout math — 28.7 GB SanDisk Cruzer Blade from the bug report
{
  const disk = 30752636928
  const l = computeLayout(disk, MiB)
  const diskMiB = Math.floor(disk / MiB)
  check('ESP ocupa o último MiB inteiro', [l.espStartMiB, l.espEndMiB], [diskMiB - 1, diskMiB])
  check('NTFS vai de 1 MiB até o início da ESP', [l.ntfsStartMiB, l.ntfsEndMiB], [1, diskMiB - 1])
}
check('sem imagem UEFI → só NTFS', computeLayout(64 * MiB, 0),
  { ntfsStartMiB: 1, ntfsEndMiB: 64, espStartMiB: null, espEndMiB: null })
check('imagem de 1,5 MiB → ESP de 2 MiB', computeLayout(64 * MiB, 1.5 * MiB).espStartMiB, 62)
check('dispositivo pequeno demais → erro', (() => { try { computeLayout(2 * MiB, MiB); return 'ok' } catch { return 'erro' } })(), 'erro')
check('ESP recebe tipo 0xEF (esp)', partedArgs(computeLayout(64 * MiB, MiB)).join(' ').endsWith('set 2 esp on'), true)

// 3. Real partition table on an image file, exactly as main.js writes it.
//    Two disk sizes: an exact multiple of 1 MiB (the 28.7 GB drive of the report
//    is one — parted rejects an end "at" the disk size) and an odd one.
const IMG = path.join(__dirname, '..', 'bin', 'uefi-ntfs.img')
if (has('parted') && has('sfdisk')) {
  for (const size of [64 * MiB, 64 * MiB + 7 * 512]) {
    console.log(`  disco de ${size} bytes:`)
    const tmp  = fs.mkdtempSync(path.join(os.tmpdir(), 'penguacu-layout-'))
    const disk = path.join(tmp, 'disk.img')
    fs.writeFileSync(disk, ''); fs.truncateSync(disk, size)
    const espImg = fs.existsSync(IMG) ? IMG : null
    const layout = computeLayout(size, espImg ? fs.statSync(espImg).size : MiB)

    execFileSync('parted', ['-s', disk, ...partedArgs(layout)])
    const { partitiontable: pt } = JSON.parse(execFileSync('sfdisk', ['--json', disk]).toString())
    const [p1, p2] = pt.partitions
    check('tabela MBR (dos) com 2 partições', [pt.label, pt.partitions.length], ['dos', 2])
    check('p1 começa em 1 MiB e é ativa', [p1.start * 512, !!p1.bootable], [MiB, true])
    check('p1 termina onde p2 começa', p1.start + p1.size, p2.start)
    check('p2 tipo EF (EFI System)', p2.type.toLowerCase(), 'ef')
    check('p2 começa onde o dd grava (seek em MiB)', p2.start * 512, layout.espStartMiB * MiB)
    check('p2 tem o tamanho da imagem e cabe no disco',
      [p2.size * 512, (p2.start + p2.size) * 512 <= size], [MiB, true])

    if (espImg && has('dd') && has('mdir')) {
      execFileSync('dd', [`if=${espImg}`, `of=${disk}`, 'bs=1M', `seek=${layout.espStartMiB}`, 'conv=notrunc,fsync', 'status=none'])
      const dir = execFileSync('mdir', ['-b', '-/', '-i', `${disk}@@${layout.espStartMiB * MiB}`, '::/EFI/Boot'],
        { env: { ...process.env, MTOOLS_SKIP_CHECK: '1' } }).toString()
      check('p2 contém EFI/Boot/bootx64.efi (UEFI:NTFS)', /bootx64\.efi/i.test(dir), true)
    } else {
      console.log('  - bin/uefi-ntfs.img ou mtools ausente — conteúdo da ESP não verificado')
    }
    fs.rmSync(tmp, { recursive: true, force: true })
  }
} else {
  console.log('  - parted/sfdisk ausente — tabela de partições real não verificada')
}

console.log(`\n${pass} ok, ${fail} falha(s)`)
process.exit(fail ? 1 : 0)

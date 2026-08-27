/**
 * Regression test for the Ubuntu 20.04 failure: bundled binaries built on a
 * modern distro could not be loaded on older ones, and the app never fell back
 * to the system's own copy, so creating a bootable USB died with "código 127".
 *
 * Run it INSIDE a glibc 2.31 container (same level as Ubuntu 20.04):
 *   npm run test:bins
 *
 * Running it on a modern host still checks resolution order, but not the
 * loader-failure path that only reproduces on old glibc.
 */

const fs   = require('fs')
const os   = require('os')
const path = require('path')
const { execSync } = require('child_process')
const { createBinResolver, binRuns, installHint } = require('../lib/bins')

let pass = 0, fail = 0
function check(name, got, want) {
  const okay = JSON.stringify(got) === JSON.stringify(want)
  okay ? pass++ : fail++
  console.log(`${okay ? '  ✓' : '  ✗'} ${name}`)
  if (!okay) console.log(`      esperado: ${want}\n      obtido:   ${got}`)
}

const REPO       = path.join(__dirname, '..')
const BUNDLED    = path.join(REPO, 'bin', 'mkntfs')
const sysMkntfs  = (() => {
  try { return execSync('command -v mkntfs || command -v mkfs.ntfs').toString().trim() } catch { return null }
})()

if (!fs.existsSync(BUNDLED)) {
  console.error('bin/mkntfs ausente — execute "npm run prepare-bins" antes do teste.')
  process.exit(1)
}

console.log(`glibc do host: ${(() => { try { return execSync('ldd --version').toString().split('\n')[0] } catch { return '?' } })()}`)
console.log(`mkntfs do sistema: ${sysMkntfs || '(nenhum)'}\n`)

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'penguacu-bins-'))

// 1. The bundled binary produced by prepare-bins must load on this system.
check('bin/mkntfs executa neste sistema', binRuns(BUNDLED), true)

// 2. A loadable bundled binary is preferred over the system copy.
{
  fs.copyFileSync(BUNDLED, path.join(tmp, 'mkntfs'))
  fs.chmodSync(path.join(tmp, 'mkntfs'), 0o755)
  const { binCmd } = createBinResolver(tmp)
  check('bundled utilizável é preferido', binCmd('mkntfs', 'mkfs.ntfs'), path.join(tmp, 'mkntfs'))
}

// 3. A bundled binary the loader rejects must fall back to the system copy.
//    Simulated with a text file marked executable → ENOEXEC, the same class of
//    failure as a missing libntfs-3g.so or a too-new GLIBC requirement.
if (sysMkntfs) {
  const broken = path.join(tmp, 'mkntfs')
  fs.writeFileSync(broken, 'not a real ELF binary\n')
  fs.chmodSync(broken, 0o755)
  const warnings = []
  const { binCmd } = createBinResolver(tmp, m => warnings.push(m))
  check('bundled inutilizável cai para o sistema', binCmd('mkntfs', 'mkfs.ntfs'), sysMkntfs)
  check('avisa que ignorou o bundled', warnings.length > 0, true)
} else {
  console.log('  – fallback não testado: nenhum mkntfs/mkfs.ntfs no sistema')
}

// 4. Nothing bundled and nothing installed → null, so the caller can show a hint.
{
  const { binCmd } = createBinResolver(tmp)
  check('nenhum candidato → null', binCmd('ferramenta-que-nao-existe'), null)
}

// 5. The install hint must name a package, never an empty command.
check('installHint devolve texto útil', /\S/.test(installHint('ntfs-3g')), true)

fs.rmSync(tmp, { recursive: true, force: true })

console.log(`\n${pass} passaram, ${fail} falharam`)
process.exit(fail ? 1 : 0)

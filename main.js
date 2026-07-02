// ── Noise suppression — must run BEFORE require('electron') so that the
// GPU helper subprocess inherits these values before initialising Vulkan/GL ──

// IBus: prevent GTK from loading IBus as an input method → no "Unable to connect" warning
process.env.IBUS_DISABLE_SNOOPER   = '1'
process.env.GTK_IM_MODULE          = ''

// GTK file-chooser: prevent use of portal/native dialogs that cause GLib cast errors
process.env.GTK_USE_PORTAL         = '0'
process.env.GTK_RECENT_FILES_LIMIT = '0'

// Vulkan: restrict loader to ONLY the bundled SwiftShader ICD.
// Without this the loader scans /usr/share/vulkan/icd.d/ and finds
// libGLX_nvidia.so.0 (32-bit, ELFCLASS32) → emits warnings.
// APPDIR is set by the AppImage runtime when running packaged.
process.env.VK_ICD_FILENAMES = process.env.APPDIR
  ? process.env.APPDIR + '/vk_swiftshader_icd.json'
  : '/dev/null'
process.env.VK_LOADER_DEBUG  = 'none'

const { app, BrowserWindow, ipcMain, dialog, shell, nativeImage } = require('electron')
const path    = require('path')
const fs      = require('fs').promises
const fsSync  = require('fs')
const { spawn, execSync } = require('child_process')
const os      = require('os')

// Bundled binaries: resources/bin/ when packaged, ./bin/ in dev mode.
// npm run prepare-bins populates ./bin/ before building the AppImage.
const BIN_DIR = app.isPackaged
  ? path.join(process.resourcesPath, 'bin')
  : path.join(__dirname, 'bin')

// Returns the path of the first resolvable candidate:
// 1. bundled binary in BIN_DIR, 2. system PATH.  Returns null if not found.
function binCmd(...names) {
  for (const name of names) {
    const bundled = path.join(BIN_DIR, name)
    try { fsSync.accessSync(bundled, fsSync.constants.X_OK); return bundled } catch {}
    try { execSync(`which ${name}`, { stdio: 'pipe' }); return name } catch {}
  }
  return null
}

// ── XML generation ────────────────────────────────────────────

function x(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

// Generic setup keys published by Microsoft — KMS client keys (GVLKs) and
// OEM default keys for editions without a GVLK. They select the edition during
// setup but do NOT activate Windows — activation happens separately.
// Win10 and Win11 share the same GVLKs.
const GENERIC_KEYS = {
  '7': {
    HomePremium: 'RHPQ2-RMFJH-74XYM-BH4JX-XM76F',
    Pro:         'FJ82H-XT6CR-J8D7P-XQJJ2-GPDD4',
    Ultimate:    'D4F6K-QK3RD-TMVMJ-BBMRX-3MBMV',
    Enterprise:  '33PXH-7Y6KF-2VJC9-XBBR8-HVTHH',
  },
  '8': {
    Core:       'M9Q9P-WNJJT-6PXPY-DWX8H-6XWKK',
    Pro:        'GCRJD-8NW9H-F2CX8-KCB7C-73FF8',
    Enterprise: 'MHF9N-XY6XB-WVXMC-BTDCT-MKKG7',
  },
  '10': {
    Home:       'TX9XD-98N7V-6WMQ6-BX7FG-H8Q99',
    HomeN:      '3KHY7-WNT83-DGQKR-F7HPR-844BM',
    Pro:        'W269N-WFGWX-YVC9B-4J6C9-T83GX',
    ProN:       'MH37W-N47XK-V7XM9-C7227-GCQG9',
    Education:  'NW6C2-QMPVW-D7KKK-3GKT6-VCFB2',
    Enterprise: 'NPPR9-FWDCX-D2C8J-H872K-2YT43',
  },
}
GENERIC_KEYS['11'] = GENERIC_KEYS['10']

function generateXML(cfg) {
  const { username, password, hostname, timezone, productKey, edition, checks: c } = cfg
  // winVersion: '7' | '8' | '10' | '11' — controls schema-sensitive blocks.
  // Win7 setup REJECTS the whole answer file if it contains OOBE elements that
  // only exist in later versions (e.g. HideLocalAccountScreen is Win8+).
  const v = String(cfg.winVersion || '10')
  const isWin7  = v === '7'
  const isWin8  = v === '8'
  const isWin11 = v === '11'
  const cmds = []
  let n = 1

  // Win11 22H2+ demands internet + Microsoft account in OOBE; BypassNRO restores
  // the "I don't have internet" path so the local account from this file is used.
  if (isWin11 && c.localAccount)
    cmds.push([n++, 'Allow OOBE without internet (BypassNRO)',
      'reg add "HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\OOBE" /v BypassNRO /t REG_DWORD /d 1 /f'])

  if (c.bitlocker)
    cmds.push([n++, 'Disable BitLocker auto-encryption',
      'reg add "HKLM\\SYSTEM\\CurrentControlSet\\Control\\BitLocker" /v PreventDeviceEncryption /t REG_DWORD /d 1 /f'])
  if (c.telemetry)
    cmds.push([n++, 'Disable telemetry',
      'reg add "HKLM\\SOFTWARE\\Policies\\Microsoft\\Windows\\DataCollection" /v AllowTelemetry /t REG_DWORD /d 0 /f'])
  if (c.cortana)
    cmds.push([n++, 'Disable Cortana',
      'reg add "HKLM\\SOFTWARE\\Policies\\Microsoft\\Windows\\Windows Search" /v AllowCortana /t REG_DWORD /d 0 /f'])
  if (c.defenderSamples)
    cmds.push([n++, 'Disable Defender sample submission',
      'reg add "HKLM\\SOFTWARE\\Policies\\Microsoft\\Windows Defender\\Spynet" /v SubmitSamplesConsent /t REG_DWORD /d 2 /f'])
  if (c.noAutoUpdate)
    cmds.push([n++, 'Disable automatic Windows Update',
      'reg add "HKLM\\SOFTWARE\\Policies\\Microsoft\\Windows\\WindowsUpdate\\AU" /v AUOptions /t REG_DWORD /d 2 /f'])
  if (c.noConsumerFeatures)
    cmds.push([n++, 'Disable consumer features',
      'reg add "HKLM\\SOFTWARE\\Policies\\Microsoft\\Windows\\CloudContent" /v DisableWindowsConsumerFeatures /t REG_DWORD /d 1 /f'])
  if (c.noActivityHistory)
    cmds.push([n++, 'Disable activity history',
      'reg add "HKLM\\SOFTWARE\\Policies\\Microsoft\\Windows\\System" /v EnableActivityFeed /t REG_DWORD /d 0 /f'])

  const firstLogon = cmds.length === 0 ? '' : `\n      <FirstLogonCommands>\n` +
    cmds.map(([order, desc, cmd]) =>
`        <SynchronousCommand wcm:action="add">
          <Order>${order}</Order>
          <Description>${x(desc)}</Description>
          <CommandLine>${x(cmd)}</CommandLine>
        </SynchronousCommand>`).join('\n\n') +
    `\n      </FirstLogonCommands>`

  const account = !c.localAccount ? '' :
`      <UserAccounts>
        <LocalAccounts>
          <LocalAccount wcm:action="add">
            <Name>${x(username)}</Name>
            <Group>Administrators</Group>
            <Password>
              <Value>${x(password)}</Value>
              <PlainText>true</PlainText>
            </Password>
          </LocalAccount>
        </LocalAccounts>
      </UserAccounts>\n`

  // Version-aware OOBE: only emit elements the target version's schema knows.
  // Win7: no HideLocalAccountScreen/HideOnlineAccountScreens (Win8+), has NetworkLocation.
  const oobeLines = ['        <HideEULAPage>true</HideEULAPage>']
  if (!isWin7 && !isWin8)
    oobeLines.push('        <HideOEMRegistrationScreen>true</HideOEMRegistrationScreen>')
  if (!isWin7) {
    oobeLines.push(`        <HideLocalAccountScreen>${c.localAccount ? 'true' : 'false'}</HideLocalAccountScreen>`)
    oobeLines.push(`        <HideOnlineAccountScreens>${c.localAccount ? 'true' : 'false'}</HideOnlineAccountScreens>`)
  }
  oobeLines.push('        <HideWirelessSetupInOOBE>true</HideWirelessSetupInOOBE>')
  if (isWin7)
    oobeLines.push('        <NetworkLocation>Home</NetworkLocation>')
  oobeLines.push('        <ProtectYourPC>3</ProtectYourPC>')
  oobeLines.push('        <SkipMachineOOBE>true</SkipMachineOOBE>')
  oobeLines.push('        <SkipUserOOBE>true</SkipUserOOBE>')
  const oobe = !c.oobe ? '' : `      <OOBE>\n${oobeLines.join('\n')}\n      </OOBE>\n`

  // Win11 hardware-requirements bypass — runs in the windowsPE pass BEFORE the
  // compatibility check, so machines without TPM 2.0 / Secure Boot / 4GB+ RAM install normally.
  const win11Bypass = (isWin11 && c.win11Bypass) ? `
      <RunSynchronous>
${['BypassTPMCheck', 'BypassSecureBootCheck', 'BypassRAMCheck', 'BypassStorageCheck', 'BypassCPUCheck']
  .map((k, i) => `        <RunSynchronousCommand wcm:action="add">
          <Order>${i + 1}</Order>
          <Path>reg add HKLM\\SYSTEM\\Setup\\LabConfig /v ${k} /t REG_DWORD /d 1 /f</Path>
        </RunSynchronousCommand>`).join('\n')}
      </RunSynchronous>` : ''


  return `<?xml version="1.0" encoding="utf-8"?>
<!-- win10-iso-builder:v1 -->
<unattend xmlns="urn:schemas-microsoft-com:unattend">

  <settings pass="windowsPE">
    <component name="Microsoft-Windows-International-Core-WinPE"
               processorArchitecture="amd64" publicKeyToken="31bf3856ad364e35"
               language="neutral" versionScope="nonSxS"
               xmlns:wcm="http://schemas.microsoft.com/WMIConfig/2002/State">
      <SetupUILanguage><UILanguage>pt-BR</UILanguage></SetupUILanguage>
      <InputLocale>pt-BR</InputLocale><SystemLocale>pt-BR</SystemLocale>
      <UILanguage>pt-BR</UILanguage><UserLocale>pt-BR</UserLocale>
    </component>
    <component name="Microsoft-Windows-Setup"
               processorArchitecture="amd64" publicKeyToken="31bf3856ad364e35"
               language="neutral" versionScope="nonSxS"
               xmlns:wcm="http://schemas.microsoft.com/WMIConfig/2002/State">
      <UserData>
        <AcceptEula>true</AcceptEula>
        <ProductKey>
          <Key>${x(productKey || (GENERIC_KEYS[v] || GENERIC_KEYS['10'])[edition] || (GENERIC_KEYS[v] || GENERIC_KEYS['10']).Pro)}</Key>
          <WillShowUI>${productKey ? 'Never' : 'OnError'}</WillShowUI>
        </ProductKey>
      </UserData>${win11Bypass}
    </component>
  </settings>

  <settings pass="specialize">
    <component name="Microsoft-Windows-Shell-Setup"
               processorArchitecture="amd64" publicKeyToken="31bf3856ad364e35"
               language="neutral" versionScope="nonSxS"
               xmlns:wcm="http://schemas.microsoft.com/WMIConfig/2002/State">
      <ComputerName>${x(hostname)}</ComputerName>
      <TimeZone>${x(timezone)}</TimeZone>
      <RegisteredOwner>${x(username)}</RegisteredOwner>
    </component>
  </settings>

  <settings pass="oobeSystem">
    <component name="Microsoft-Windows-Shell-Setup"
               processorArchitecture="amd64" publicKeyToken="31bf3856ad364e35"
               language="neutral" versionScope="nonSxS"
               xmlns:wcm="http://schemas.microsoft.com/WMIConfig/2002/State">
${account}${oobe}${firstLogon}
    </component>
    <component name="Microsoft-Windows-International-Core"
               processorArchitecture="amd64" publicKeyToken="31bf3856ad364e35"
               language="neutral" versionScope="nonSxS"
               xmlns:wcm="http://schemas.microsoft.com/WMIConfig/2002/State">
      <InputLocale>pt-BR</InputLocale><SystemLocale>pt-BR</SystemLocale>
      <UILanguage>pt-BR</UILanguage><UserLocale>pt-BR</UserLocale>
    </component>
  </settings>

</unattend>`
}

// ── ISO 9660 minimal reader ───────────────────────────────────
// Reads a single file from the root directory of an ISO 9660 image.
// Avoids spawning any external process — only reads the relevant sectors.
async function readFileFromISO(isoPath, targetName) {
  const SECTOR = 2048
  let fh
  try {
    fh = await fs.open(isoPath, 'r')  // inside try so EACCES is caught silently

    const pvd = Buffer.alloc(SECTOR)
    await fh.read(pvd, 0, SECTOR, 16 * SECTOR)

    if (pvd[0] !== 1 || pvd.slice(1, 6).toString() !== 'CD001') return null

    const rootLBA  = pvd.readUInt32LE(158)
    const rootSize = pvd.readUInt32LE(166)
    if (!rootLBA || rootSize > 10 * 1024 * 1024) return null

    const dir = Buffer.alloc(rootSize)
    await fh.read(dir, 0, rootSize, rootLBA * SECTOR)

    const upper = targetName.replace(/^\//, '').toUpperCase()
    let off = 0
    while (off < rootSize) {
      const recLen = dir[off]
      if (recLen === 0) {
        off = Math.ceil((off + 1) / SECTOR) * SECTOR
        continue
      }
      const fileLBA  = dir.readUInt32LE(off + 2)
      const fileSize = dir.readUInt32LE(off + 10)
      const nameLen  = dir[off + 32]
      const rawName  = dir.slice(off + 33, off + 33 + nameLen).toString('ascii')
      const name     = rawName.split(';')[0]

      if (name === upper) {
        const content = Buffer.alloc(fileSize)
        await fh.read(content, 0, fileSize, fileLBA * SECTOR)
        return content.toString('utf8')
      }
      off += recLen
    }
    return null
  } catch {
    return null  // EACCES, corrupt ISO, anything — return null silently
  } finally {
    if (fh) await fh.close().catch(() => {})
  }
}

// ── Process helpers ───────────────────────────────────────────

function cmdExists(...names) {
  return binCmd(...names) !== null
}

// Runs a command, calls onLine for each complete log line.
// Optional onProgress(pct: number) receives percentages parsed from 7z-style
// "\r  47%\r  48%…" carriage-return progress written to stdout.
function runProc(cmd, args, onLine, onProgress) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { env: process.env })
    let partial = ''
    const feed = data => {
      partial += data.toString()
      // Extract latest percentage from 7z-style CR progress (e.g. "\r  47%")
      if (onProgress) {
        const m = partial.match(/(\d+)%/)
        if (m) onProgress(parseInt(m[1], 10))
      }
      // Emit complete newline-delimited log lines; strip trailing CR from each
      const parts = partial.split('\n')
      partial = parts.pop()
      for (const raw of parts) {
        const line = raw.split('\r').pop().trim()
        if (line) onLine(line)
      }
    }
    p.stdout.on('data', feed)
    p.stderr.on('data', d => {
      d.toString().split('\n').map(l => l.trim()).filter(Boolean).forEach(onLine)
    })
    p.on('close', code => {
      if (partial.trim()) onLine(partial.trim())
      code === 0 ? resolve() : reject(new Error(`${cmd} saiu com código ${code}`))
    })
    p.on('error', reject)
  })
}

// Async alternative to execSync: runs a command and resolves with stdout string.
// Prevents blocking the main-process event loop during long operations.
function runCmd(cmd, args = []) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ['pipe', 'pipe', 'pipe'] })
    const out = []
    p.stdout.on('data', d => out.push(d))
    p.on('close', code => code === 0
      ? resolve(Buffer.concat(out).toString())
      : reject(Object.assign(new Error(`${cmd} exited ${code}`), { code })))
    p.on('error', reject)
  })
}

// Total sectors physically written to a block device (512-byte units).
// Read from /sys/block/<dev>/stat — field 7 is "sectors written".
// This is the ONLY honest progress source for USB writes: file-level progress
// (7z %) measures writes to the page cache, which can be GBs ahead of the disk.
async function sectorsWritten(devBase) {
  try {
    const stat = await fs.readFile(`/sys/block/${devBase}/stat`, 'utf8')
    return parseInt(stat.trim().split(/\s+/)[6], 10) || 0
  } catch { return 0 }
}

// AppImage binaries live inside a FUSE mount owned by the launching user.
// When pkexec escalates to root, root cannot access that FUSE mount and gets EPERM.
// Copy the binary to /tmp first so the root subprocess can execute it.
// Detection: use app.isPackaged + BIN_DIR prefix — more reliable than process.env.APPDIR
// which Electron does not always inherit from the AppImage AppRun environment.
async function stageForPriv(binPath) {
  if (!binPath) return null
  // Only bundled binaries (under BIN_DIR when packaged) live in the FUSE mount
  if (!app.isPackaged || !binPath.startsWith(BIN_DIR)) return binPath
  const dir  = path.join(os.tmpdir(), 'gaussfleet-privbins')
  await fs.mkdir(dir, { recursive: true })
  const dest = path.join(dir, path.basename(binPath))
  await fs.copyFile(binPath, dest)
  await fs.chmod(dest, 0o755)
  return dest
}

// App identity — must be set before the window opens. On Linux this becomes the
// window's WM_CLASS, which the desktop's app-switcher/dock matches against the
// .desktop file's StartupWMClass to show the correct icon for the running app.
app.setName('Penguaçu-Flash')

// --disable-gpu: use SwiftShader CPU renderer — prevents the black-screen
// "GetVSyncParametersIfAvailable failed" cascade on 32/64-bit mixed GL stacks.
app.commandLine.appendSwitch('disable-gpu')
// Disable GTK portal and native file chooser to avoid GLib invalid-cast noise
app.commandLine.appendSwitch('disable-features', 'GtkFileChooserNative,GtkFileChooserPortal')

// ── Electron window ───────────────────────────────────────────

let win

// App icon — bundled in the asar at build/icon.png (see package.json "files").
// Setting it on the BrowserWindow writes _NET_WM_ICON, which most Linux desktops
// read directly for the title bar and the open-apps switcher/taskbar.
const APP_ICON = nativeImage.createFromPath(path.join(__dirname, 'build', 'icon.png'))

function createWindow() {
  win = new BrowserWindow({
    width: 640, height: 760,
    minWidth: 560, minHeight: 640,
    backgroundColor: '#F0F4F8',
    autoHideMenuBar: true,
    icon: APP_ICON,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })
  if (!APP_ICON.isEmpty()) win.setIcon(APP_ICON)
  win.loadFile('index.html')
}

app.whenReady().then(async () => {
  // Create empty window_decorations.css to silence GTK "Failed to import" warning.
  // The file is expected by some Fedora/GNOME themes; an empty file is valid CSS.
  const wcss = path.join(os.homedir(), '.config', 'gtk-3.0', 'window_decorations.css')
  try { await fs.access(wcss) } catch {
    await fs.mkdir(path.dirname(wcss), { recursive: true }).catch(() => {})
    await fs.writeFile(wcss, '', 'utf8').catch(() => {})
  }

  // Ensure bundled binaries are executable (AppImage might drop execute bit on some systems)
  const binEntries = await fs.readdir(BIN_DIR).catch(() => [])
  for (const b of binEntries) {
    await fs.chmod(path.join(BIN_DIR, b), 0o755).catch(() => {})
  }

  createWindow()
})
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })

// ── IPC handlers ──────────────────────────────────────────────

ipcMain.handle('dialog:openISO', () =>
  dialog.showOpenDialog(win, {
    title: 'Selecionar ISO do Windows 10',
    filters: [{ name: 'Imagens ISO', extensions: ['iso'] }],
    properties: ['openFile'],
  }).then(r => r.filePaths[0] || null))

ipcMain.handle('dialog:saveISO', (_, name) =>
  dialog.showSaveDialog(win, {
    title: 'Salvar ISO Personalizada',
    defaultPath: name || 'win10-custom.iso',
    filters: [{ name: 'Imagens ISO', extensions: ['iso'] }],
  }).then(r => r.filePath || null))

ipcMain.handle('check:deps', () => ({
  xorriso: cmdExists('xorriso'),
  parted:  cmdExists('parted'),
  mkntfs:  cmdExists('mkntfs', 'mkfs.ntfs'),
  p7zip:   cmdExists('7zzs', '7z'),
  mssys:   cmdExists('ms-sys'),
}))

ipcMain.handle('xml:generate', (_, cfg) => generateXML(cfg))

ipcMain.handle('xml:save', async (_, cfg) => {
  const { filePath } = await dialog.showSaveDialog(win, {
    title: 'Salvar autounattend.xml',
    defaultPath: 'autounattend.xml',
    filters: [{ name: 'XML', extensions: ['xml'] }],
  })
  if (!filePath) return { success: false }
  await fs.writeFile(filePath, generateXML(cfg), 'utf8')
  return { success: true, path: filePath }
})

// Two-step approach:
// 1. cp --reflink=auto: full clone (instant on btrfs/XFS CoW, normal copy otherwise)
// 2. xorriso -dev: modify the clone in-place — preserves all boot sectors unchanged
ipcMain.on('iso:process', async (event, cfg) => {
  const log  = (msg, type = 'info') => event.sender.send('iso:log', { msg, type })
  const done = (ok)                  => event.sender.send('iso:done', { success: ok })
  const tmp  = path.join(os.tmpdir(), `win10iso-${Date.now()}`)

  try {
    log('Verificando dependências...')
    if (!cmdExists('xorriso')) {
      log('xorriso não encontrado', 'error')
      log('Instale: sudo dnf install xorriso', 'warn')
      return done(false)
    }
    log('xorriso OK', 'ok')

    await fs.mkdir(tmp, { recursive: true })

    log('Gerando autounattend.xml...')
    const xmlPath = path.join(tmp, 'autounattend.xml')
    await fs.writeFile(xmlPath, generateXML(cfg), 'utf8')
    log('autounattend.xml gerado', 'ok')

    // Step 1 — full copy of the source ISO
    // --reflink=auto uses CoW on btrfs/XFS (near-instant); falls back to normal copy
    log('Copiando ISO original... (instantâneo em btrfs, alguns minutos em HDD/SSD)')
    await runProc('cp', ['--reflink=auto', cfg.isoPath, cfg.outputPath], l => log(l, 'dim'))
    log('Cópia concluída', 'ok')

    // Step 2 — inject autounattend.xml in-place; -dev opens for read+write
    // so xorriso never discards the El-Torito/EFI boot sectors
    log('Injetando autounattend.xml...')
    await runProc('xorriso', [
      '-dev',  cfg.outputPath,
      '-map',  xmlPath, '/autounattend.xml',
      '-commit',
    ], l => log(l, 'dim'))

    log(`ISO salva: ${cfg.outputPath}`, 'ok')
    await fs.rm(tmp, { recursive: true, force: true })
    log('Concluído!', 'ok')
    done(true)

  } catch (err) {
    log(`Erro: ${err.message}`, 'error')
    // Clean up partial output on failure
    fs.rm(cfg.outputPath, { force: true }).catch(() => {})
    fs.rm(tmp, { recursive: true, force: true }).catch(() => {})
    done(false)
  }
})

// Reads /autounattend.xml from the ISO and checks for our signature.
// Returns { found: bool, ours: bool }
ipcMain.handle('iso:hasUnattend', async (_, isoPath) => {
  try {
    const content = await readFileFromISO(isoPath, '/autounattend.xml')
    if (content === null) return { found: false, ours: false }
    return { found: true, ours: content.includes('win10-iso-builder:v1') }
  } catch {
    return { found: false, ours: false }
  }
})

ipcMain.handle('shell:openFolder', (_, filePath) => {
  shell.showItemInFolder(filePath)
})

ipcMain.handle('app:quit', () => {
  app.quit()
})

// List removable USB disks (not partitions) for bootable USB creation
ipcMain.handle('usb:listDisks', async () => {
  try {
    const raw = await runCmd('lsblk', ['-J', '-o', 'NAME,TYPE,TRAN,LABEL,SIZE,RM,MODEL'])
    const { blockdevices = [] } = JSON.parse(raw)
    return blockdevices
      .filter(d => {
        const isUSB = d.tran === 'usb'
        const isRM  = d.rm === true || d.rm === '1' || d.rm === 1
        return (isUSB || isRM) && d.type === 'disk'
      })
      .map(d => ({
        device:     `/dev/${d.name}`,
        label:      d.label || d.model || null,
        size:       d.size  || '?',
        partitions: (d.children || []).map(c => ({
          device:     `/dev/${c.name}`,
          mountpoint: c.mountpoint || null,
        })),
      }))
  } catch { return [] }
})

// Create a bootable Windows USB from ISO: partition → format NTFS → extract → inject XML → write boot sectors
ipcMain.on('usb:createBootable', async (event, cfg) => {
  const log  = (msg, type = 'info') => event.sender.send('iso:log', { msg, type })
  const done = (ok, extra = {})     => event.sender.send('iso:done', { success: ok, ...extra })
  // Sends a progress update without a log line.  stage is the label shown in the progress bar.
  const prog = (pct, stage)         => event.sender.send('iso:log', { type: 'progress', progress: pct, stage })

  const { device, isoPath, xmlContent, volumeLabel, winVersion } = cfg
  // /dev/sdb → /dev/sdb1, but /dev/mmcblk0 or /dev/nvme0n1 → p1 suffix
  const partition = /\d$/.test(device) ? `${device}p1` : `${device}1`
  const devBase   = device.split('/').pop()  // "sdb" — for /sys/block/<dev>/stat
  // Volume label goes into a root bash -c string → whitelist strictly (no shell
  // metacharacters possible) and cap at NTFS's 32-char label limit.
  const volLabel = (String(volumeLabel || '').replace(/[^A-Za-z0-9._ -]/g, '').trim().slice(0, 32).toUpperCase())
    || 'WIN10USB'

  function runPriv(cmdStr, onLine = () => {}) {
    if (process.getuid() === 0) return runProc('bash', ['-c', cmdStr], onLine)
    return runProc('pkexec', ['bash', '-c', cmdStr], onLine)
  }

  try {
    // 1. Verify deps (prefer bundled binaries in BIN_DIR, fall back to system PATH)
    prog(0)
    log('Verificando dependências...')
    const partedExe  = binCmd('parted')
    const mkntfsExe  = binCmd('mkntfs', 'mkfs.ntfs')
    const sevenZExe  = binCmd('7zzs', '7z')
    const msSysExe   = binCmd('ms-sys')

    if (!partedExe)  throw new Error('parted não encontrado — instale: sudo dnf install parted')
    if (!mkntfsExe)  throw new Error('mkntfs não encontrado — execute: npm run prepare-bins (requer ntfsprogs instalado)')
    if (!sevenZExe)  throw new Error('7z não encontrado — execute: npm run prepare-bins')
    log(`Deps OK${msSysExe ? ' (UEFI + BIOS)' : ' — ms-sys ausente, apenas UEFI'}`, msSysExe ? 'ok' : 'warn')
    if (String(winVersion) === '7')
      log('Windows 7: inicie o pendrive em modo BIOS/Legacy — o boot UEFI do Win7 não funciona em NTFS na maioria dos firmwares', 'warn')

    // 2. Unmount all partitions (async to avoid blocking main-process event loop)
    prog(3)
    log('Desmontando partições existentes...')
    try {
      const lsRaw = await runCmd('lsblk', ['-J', '-o', 'NAME,MOUNTPOINT', device])
      const { blockdevices: [disk] = [{}] } = JSON.parse(lsRaw)
      for (const part of (disk.children || [])) {
        if (part.mountpoint) {
          await runCmd('udisksctl', ['unmount', '-b', `/dev/${part.name}`]).catch(() => {})
          log(`  /dev/${part.name} desmontado`, 'dim')
        }
      }
    } catch { /* nothing mounted is fine */ }

    // 3. Partition + format + boot sectors — ONE pkexec prompt for everything privileged.
    // ms-sys runs right after mkntfs (boot records don't depend on files being copied —
    // same order Rufus uses: partition → format → boot sectors → copy files).
    // Stage FUSE-mounted binaries to /tmp: root cannot execute files inside the
    // AppImage FUSE mount because FUSE restricts access to the mount owner.
    prog(7)
    log(`Particionando e formatando como "${volLabel}"... (autorização necessária)`)
    const mkntfsPriv = await stageForPriv(mkntfsExe)
    const partedPriv = await stageForPriv(partedExe)
    const msSysPriv  = msSysExe ? await stageForPriv(msSysExe) : null
    const bootCmd = msSysPriv
      ? ` && "${msSysPriv}" -7 "${device}" && "${msSysPriv}" --ntfs "${partition}"`
      : ''
    await runPriv(
      `"${partedPriv}" -s "${device}" mklabel msdos mkpart primary ntfs 1MiB 100% set 1 boot on && ` +
      `(partprobe "${device}" 2>/dev/null; sleep 1) && ` +
      `"${mkntfsPriv}" -f -L "${volLabel}" "${partition}"${bootCmd}`,
      l => log(l, 'dim')
    )
    prog(15)
    log(msSysPriv ? 'Partição formatada + boot UEFI/BIOS gravado' : 'Partição formatada (boot UEFI)', 'ok')

    // 4. Mount — try the kernel NTFS3 driver first (noticeably faster writes than
    // the ntfs-3g FUSE driver), fall back to udisks default if refused.
    prog(17)
    log('Montando partição...')
    await runCmd('udevadm', ['settle', '--timeout=10']).catch(() => {})
    let mountOut, usedNtfs3 = false
    try {
      mountOut = await runCmd('udisksctl', ['mount', '-b', partition, '-t', 'ntfs3'])
      usedNtfs3 = true
    } catch {
      mountOut = await runCmd('udisksctl', ['mount', '-b', partition])
    }
    const mountMatch = mountOut.match(/[Mm]ounted .+ at (.+?)\.?\s*$/)
    if (!mountMatch) throw new Error('Partição formatada mas não foi possível montar via udisksctl')
    const mountPoint = mountMatch[1].trim()
    prog(18)
    log(`Montado em ${mountPoint}${usedNtfs3 ? ' (driver NTFS3 do kernel — mais rápido)' : ''}`, 'ok')

    // 5. Extract ISO with HONEST progress: the bar tracks bytes physically written
    // to the device (/sys/block/<dev>/stat), not 7z's file-level progress — 7z
    // finishes into the page cache long before the USB has the data. A periodic
    // syncfs keeps writeback flowing so the final flush is short instead of
    // holding gigabytes of dirty pages until the end.
    const isoSize = (await fs.stat(isoPath)).size
    const wStart  = await sectorsWritten(devBase)
    let lastBytes = 0, lastT = Date.now()

    let ticker = setInterval(async () => {
      const bytes = (await sectorsWritten(devBase) - wStart) * 512
      const now   = Date.now()
      const mbps  = Math.max(0, (bytes - lastBytes) / ((now - lastT) / 1000) / 1e6)
      lastBytes = bytes; lastT = now
      const pct = Math.min(96, 18 + Math.round((bytes / isoSize) * 78))
      const gb  = b => (b / 1e9).toFixed(2)
      prog(pct, `Gravando — ${gb(bytes)} de ${gb(isoSize)} GB (${mbps.toFixed(0)} MB/s)`)
    }, 2000)

    let syncBusy = false
    const syncTimer = setInterval(() => {
      if (syncBusy) return
      syncBusy = true
      runCmd('sync', ['-f', mountPoint]).catch(() => {}).finally(() => { syncBusy = false })
    }, 10000)

    const stopTimers = () => { clearInterval(ticker); clearInterval(syncTimer) }

    try {
      log('Extraindo ISO para o pendrive...')
      log('  (a barra mostra a gravação física real no pendrive)', 'dim')
      await runProc(
        sevenZExe,
        ['x', isoPath, `-o${mountPoint}`, '-y', '-bsp1'],
        l => { if (/^(Extracting|Everything|Error|Sub items)/i.test(l)) log(l, 'dim') }
        // no 7z progress callback — the physical-write ticker drives the bar
      )
      log('Extração concluída — finalizando gravação física...', 'ok')

      // 6. Inject autounattend.xml (overwrite in-place to handle UPPERCASE variants)
      log('Injetando autounattend.xml...')
      const entries = await fs.readdir(mountPoint).catch(() => [])
      const found = entries.filter(e => /^autounattend\.xml$/i.test(e))
      for (const name of (found.length ? found : ['autounattend.xml'])) {
        await fs.writeFile(path.join(mountPoint, name), xmlContent, 'utf8')
      }
      log('autounattend.xml injetado', 'ok')

      // 7. Final flush — syncfs on THIS filesystem only (never global sync).
      // The ticker keeps showing real progress while remaining dirty pages drain.
      clearInterval(syncTimer)
      log('Sincronizando dados restantes com o pendrive...')
      await runCmd('sync', ['-f', mountPoint])
    } finally {
      stopTimers()
    }

    // 8. Unmount — near-instant now since syncfs already flushed everything
    prog(98)
    log('Desmontando o pendrive...')
    await runCmd('udisksctl', ['unmount', '-b', partition]).catch(e => {
      log(`Aviso ao desmontar: ${e.message}`, 'warn')
      log('Ejete o pendrive pelo gerenciador de arquivos antes de remover', 'warn')
    })
    prog(100, 'Pendrive pronto!')
    log('Pendrive pronto! Pode remover com segurança.', 'ok')
    done(true, { pendrivePath: mountPoint })

  } catch (err) {
    log(`✗ ${err.message}`, 'error')
    if (String(err.message).includes('code 126')) log('Autorização cancelada', 'warn')
    done(false)
  }
})

// List removable USB block devices using lsblk
ipcMain.handle('usb:list', async () => {
  try {
    const raw = await runCmd('lsblk', ['-J', '-o', 'NAME,TYPE,TRAN,MOUNTPOINT,LABEL,SIZE,FSTYPE,RM'])
    const { blockdevices = [] } = JSON.parse(raw)
    const result = []
    function walk(dev, parentIsUSB) {
      const isUSB = parentIsUSB || dev.tran === 'usb'
      const isRM  = dev.rm === true || dev.rm === '1' || dev.rm === 1
      if (!isUSB && !isRM) return
      if (dev.type === 'part' || (dev.type === 'disk' && !(dev.children?.length))) {
        result.push({
          device:     `/dev/${dev.name}`,
          label:      dev.label || null,
          size:       dev.size  || '?',
          fstype:     dev.fstype || null,
          mountpoint: dev.mountpoint || null,
        })
      }
      for (const child of (dev.children || [])) walk(child, isUSB)
    }
    for (const dev of blockdevices) walk(dev, false)
    return result
  } catch {
    return []
  }
})

// Read autounattend.xml from a mounted filesystem path.
// Uses case-insensitive readdir scan to handle NTFS/FAT case variants.
ipcMain.handle('usb:readXML', async (_, mountPoint) => {
  try {
    const entries = await fs.readdir(mountPoint)
    const match = entries.find(e => /^autounattend\.xml$/i.test(e))
    if (match) return await fs.readFile(path.join(mountPoint, match), 'utf8')
  } catch {}
  return null
})

// List root directory of a mounted path for debugging when no XML is found
ipcMain.handle('usb:listRoot', async (_, mountPoint) => {
  try {
    const entries = await fs.readdir(mountPoint)
    return entries.slice(0, 40) // cap at 40 entries
  } catch (err) {
    return []
  }
})

// Read autounattend.xml directly from a raw block device (ISO 9660)
ipcMain.handle('usb:readXMLDevice', async (_, devicePath) => {
  return readFileFromISO(devicePath, '/autounattend.xml')
})

// Mount a block device via udisksctl (no sudo required on modern Linux)
ipcMain.handle('usb:mount', async (_, devicePath) => {
  try {
    const out = await runCmd('udisksctl', ['mount', '-b', devicePath])
    // Output: "Mounted /dev/sdb2 at /run/media/user/WIN10."
    const match = out.match(/[Mm]ounted .+ at (.+?)\.?\s*$/)
    if (match) return { success: true, mountpoint: match[1].trim() }
    return { success: false, error: 'Montado mas ponto de montagem não encontrado na saída' }
  } catch (err) {
    const msg = err.stderr?.toString() || err.message || 'Erro desconhecido'
    return { success: false, error: msg.trim() }
  }
})

// Write autounattend.xml directly to a mounted USB drive root
ipcMain.handle('usb:injectXML', async (_, mountPoint, xmlContent) => {
  try {
    const entries = await fs.readdir(mountPoint).catch(() => [])
    const found = entries.filter(e => /^autounattend\.xml$/i.test(e))

    // Overwrite every existing case variant in-place (preserves the NTFS inode so we
    // don't need delete permission — avoids the "AUTOUNATTEND.XML exists but unlink
    // fails silently" trap where Windows reads the stale uppercase copy).
    // If none exist yet, create autounattend.xml (lowercase).
    const targets = found.length > 0 ? found : ['autounattend.xml']
    for (const name of targets) {
      await fs.writeFile(path.join(mountPoint, name), xmlContent, 'utf8')
    }

    // Flush THIS filesystem to physical media before the user removes the drive
    // (sync -f = syncfs — never global sync, which waits on every fs on the machine).
    await runCmd('sync', ['-f', mountPoint]).catch(() => {})

    // Verify by reading back the primary file
    const primary = path.join(mountPoint, targets[0])
    const written = await fs.readFile(primary, 'utf8')
    const hasBrokenKey = written.includes('<ProductKey>') && !written.includes('<Key>')
    if (hasBrokenKey) {
      return { success: false, error: 'Verificação falhou: XML ainda contém <ProductKey> inválido após escrita' }
    }

    return { success: true, path: primary, writtenTo: targets }
  } catch (err) {
    return { success: false, error: err.message }
  }
})

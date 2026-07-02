<div align="center">

<img src="build/icon.png" width="120" alt="Penguaçu-Flash" />

# Penguaçu-Flash

### Create bootable Windows 7 · 8.1 · 10 · 11 USB drives, from Linux — the easy way

A fully self-contained AppImage that formats your USB, copies Windows, and injects a personalized `autounattend.xml` — so the installation runs unattended, with your account, language, and privacy tweaks already set.

**🌍 Read this in:** **English** · [Português](README.pt-BR.md) · [Español](README.es.md) · [中文](README.zh.md) · [हिन्दी](README.hi.md) · [العربية](README.ar.md)

<br/>

![Platform](https://img.shields.io/badge/platform-Linux-1B2A6B?style=for-the-badge&logo=linux&logoColor=white)
![AppImage](https://img.shields.io/badge/package-AppImage-3A55D8?style=for-the-badge)
![License](https://img.shields.io/badge/license-MIT-059669?style=for-the-badge)
![PRs welcome](https://img.shields.io/badge/PRs-welcome-FF9E1B?style=for-the-badge)

</div>

---

## ✨ Why Penguaçu-Flash?

Making a Windows install USB on Linux usually means juggling `parted`, `mkntfs`, `7z`, and boot-sector tools by hand — and then Windows still stops halfway through setup asking questions. Penguaçu-Flash does the whole thing in a single window:

- 🐧 **Runs anywhere** — one self-contained AppImage. No dependencies to install: `7-Zip`, `mkntfs`, and `ms-sys` are bundled inside.
- 💾 **Real bootable USB** — partitions, formats NTFS, copies Windows, and writes the boot sectors for both **UEFI and BIOS/legacy**.
- 🪄 **Truly unattended** — injects a personalized `autounattend.xml` so setup flies past the questions with your username, password, hostname, timezone, and edition already filled in.
- 🧭 **Windows 7 → 11, auto-detected** — the version is recognized from the ISO filename, and the answer file adapts to each version's schema.
- 🛡️ **Windows 11 without the roadblocks** — optional bypass for the TPM 2.0, Secure Boot, RAM and CPU requirements.
- 🔒 **Privacy out of the box** — toggle off telemetry, Cortana, automatic BitLocker, sponsored apps, and more.
- 📊 **Honest progress** — the progress bar tracks bytes *physically written to the device* (with live MB/s), not the deceptive page-cache number.
- 🌐 **Speaks 6 languages** — Portuguese, English, Spanish, Chinese, Hindi and Arabic (with full right-to-left layout).

---

## 📸 Screenshots

> _Add your screenshots to `docs/` and reference them here._
>
> `docs/screenshot-wizard.png` · `docs/screenshot-usb.png`

---

## 🚀 Download & run

1. Grab the latest **`Penguaçu-Flash-*.AppImage`** from the [**Releases**](../../releases) page.
2. Make it executable and run it:

```bash
chmod +x Penguaçu-Flash-*.AppImage
./Penguaçu-Flash-*.AppImage
```

That's it — no installation, no dependencies. The privileged steps (partitioning, formatting, writing boot sectors) ask for your password once through your system's standard authorization dialog.

> **Tip:** on KDE/GNOME you can also just double-click the AppImage in your file manager.

---

## 🧭 How to use

| Step | What happens |
|------|--------------|
| **1. ISO** | Drop in your Windows ISO. The version (7/8.1/10/11) is detected automatically. |
| **2. Identity** | Set the username, password, computer name, timezone, edition and (optionally) product key. |
| **3. Tweaks** | Pick the privacy/behavior tweaks and, for Windows 11, the requirements bypass. |
| **4. Create** | Choose **Build ISO** (a new customized `.iso`) or **Create USB** (format + copy + inject a ready-to-boot drive). |
| **5. Done** | Boot the target machine from the USB — Windows installs itself with your settings. |

You can also **analyze an existing USB**, read back its `autounattend.xml`, and re-inject an updated configuration without rebuilding anything.

---

## 🛠️ Build from source

Requirements: **Node.js 18+**, and on the build machine `ntfsprogs` (for `mkntfs`) plus `gcc`/`make` (to compile the bundled `ms-sys`).

```bash
git clone https://github.com/vitormoreiradesenvolvedor/penguacu-flash.git
cd penguacu-flash
npm install

# Downloads/compiles the bundled binaries (7-Zip, mkntfs, ms-sys) into ./bin
npm run prepare-bins

# Produces dist/Penguaçu-Flash-<version>.AppImage
npm run dist
```

To run it live during development:

```bash
npm start
```

### Project layout

```
├── main.js              # Electron main process — USB/ISO logic, IPC handlers
├── preload.js           # contextBridge API exposed to the renderer
├── index.html           # The whole UI (wizard, i18n dictionary, styles)
├── scripts/
│   ├── prepare-bins.sh  # Fetches/compiles bundled binaries
│   └── afterPack.js     # Wraps the Electron binary (env + noise filter)
└── build/
    ├── icon.svg         # Source icon
    └── icons/           # Rendered PNG sizes
```

---

## 🤝 Contributing

Contributions are very welcome — this project exists to help the Linux community, and it gets better with more hands. 🐧

- 🌐 **Translations**: the UI dictionary lives in `index.html` (`I18N` object). Adding or improving a language is a great first PR.
- 🐛 **Bugs & ideas**: open an [issue](../../issues) with clear steps to reproduce.
- 🔧 **Code**: fork, branch off **`development`**, and open a pull request against it.

See [CONTRIBUTING.md](CONTRIBUTING.md) for the full guide. Branch model:

- **`master`** — stable, released code.
- **`development`** — where new work lands before the next release.

---

## ⚠️ Disclaimer

Creating a bootable USB **erases all data** on the selected drive. Double-check you picked the right device. Product keys shown in the app are Microsoft's public generic/KMS setup keys — they select the edition during setup but **do not activate** Windows. Activate with a valid license.

---

## 📄 License

Released under the [MIT License](LICENSE) — free to use, modify and share.

<div align="center">
<br/>
Made with 🐧 for the Linux community.
</div>

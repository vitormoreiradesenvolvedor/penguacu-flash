# Contributing to Penguaçu-Flash

First off — thank you! 🐧 This project is here to help the Linux community, and every contribution makes it better.

## Branch model

- **`master`** — stable, released code. Never commit directly here.
- **`development`** — integration branch for the next release. **Base your work on this.**

```bash
git checkout development
git pull
git checkout -b my-feature
# ... work ...
git push origin my-feature
# open a Pull Request targeting `development`
```

## Ways to contribute

### 🌐 Translations (great first contribution!)
The entire UI is translated from a single dictionary in `index.html` — the `I18N` object (plus `I18N_MODAL`). To add or fix a language:

1. Copy the `en` block and translate each value (keys stay in English).
2. Add your language to the `<select id="lang-select">` in the header.
3. If the language is right-to-left, add its code to `RTL_LANGS`.

All languages must keep the **same set of keys** — a quick check:

```bash
node -e 'const h=require("fs").readFileSync("index.html","utf8");/* see README build notes */'
```

### 🐛 Bug reports
Open an issue with: your distro + desktop environment, the Windows version/ISO, and clear steps to reproduce. Logs from the app's output panel help a lot.

### 🔧 Code
- Keep the style of the surrounding code (no build step, plain ES modules in the renderer).
- The app must stay **self-contained**: no runtime dependency the AppImage doesn't bundle.
- Test a real build before opening the PR:

```bash
npm run dist
./dist/Penguaçu-Flash-*.AppImage
```

## Development setup

```bash
npm install
npm run prepare-bins   # fetches/compiles bundled binaries into ./bin
npm start              # run live
```

## Code of conduct

Be kind and constructive. We're all here to build something useful together.

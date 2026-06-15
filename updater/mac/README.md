# Deskmate macOS Updater

Standalone macOS updater binary. Spawned by the main app to perform the
file replacement after Deskmate exits, then relaunches the new version.

## Architecture

```
Main App (Electron, in /Applications/Deskmate.app)
   │  spawn(updaterPath, [zipPath, installPath], { detached: true, stdio: 'ignore' })
   │  app.quit()
   ▼
updater-mac-arm64                    ◄── single Node binary (this project)
   1. Wait for app exit (3s)
   2. Extract ZIP to temp directory
   3. Backup current .app  →  .app.backup
   4. Copy new files in place
   5. Cleanup temp + backup
   6. Launch the updated app
   On any failure: restore from .backup, exit non-zero.
```

## Build

```bash
cd updater/mac
npm install
npm run build:all              # both arches
# or:
npm run build:mac-arm64        # Apple Silicon
npm run build:mac-x64          # Intel
```

Output:
- `release/updater-mac-arm64`  (~58 MB, Node 22 runtime included)
- `release/updater-mac-x64`

These binaries are uploaded to the update CDN; the main app downloads
them on demand via `UpdaterFetcher` (see `src/main/lib/autoUpdate/`).

## Usage (manual / debugging)

```bash
./updater-mac-arm64 <zipPath> <installPath>
./updater-mac-arm64 /tmp/Deskmate-1.2.0.zip /Applications/Deskmate.app
```

Logs: `/tmp/deskmate-updater.log`

## Tooling

- Packager: [@yao-pkg/pkg](https://github.com/yao-pkg/pkg)
  (active fork of the archived `vercel/pkg`).
- Bundled Node runtime: 22.22.3 (active LTS).
- Source: pure JS in `updater.js`, no transpilation needed.

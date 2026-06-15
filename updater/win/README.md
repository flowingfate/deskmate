# Deskmate Windows Updater

Standalone Windows updater binary with a native Windows Forms progress UI.
Spawned by the main app to perform the file replacement after Deskmate
exits, then relaunches the new version.

## Architecture

```
Main App (Electron)
   │  spawn(updaterPath, [zipPath, installPath], {
   │    detached:    true,
   │    stdio:       'ignore',
   │    windowsHide: true,         ◄── critical: prevents console flash
   │  })
   │  app.quit()
   ▼
updater-win-x64.exe                ◄── this project (Node binary, packaged)
   │  Writes embedded PowerShell UI script to %TEMP%
   │  spawn('powershell.exe', [
   │    '-ExecutionPolicy Bypass',
   │    '-NoProfile',
   │    '-WindowStyle Hidden',
   │    '-File', scriptPath, ...
   │  ], { stdio: 'ignore', windowsHide: true })
   │  Awaits PowerShell completion, propagates exit code, cleans up.
   ▼
PowerShell + Windows Forms          ◄── the actual UI implementation
   - Progress bar, status text, error dialogs
   - Extracts ZIP → backs up → copies new files → relaunches
```

## Why `windowsHide: true` matters

The `pkg`-packaged binary is a **Console subsystem** Windows executable.
Without `windowsHide`, Windows briefly draws an empty black console
window when the parent (Electron) launches the updater. With
`windowsHide: true` the console is suppressed, no flash visible.

This is why **the parent app MUST pass `windowsHide: true`** when
spawning this binary — see `src/main/lib/autoUpdate/updateManager.ts`.

The same applies to PowerShell: spawned with `windowsHide: true` and
`-WindowStyle Hidden` to keep its console hidden. The Windows Forms
window the script then opens is a normal application window, unaffected
by either flag — that's the visible UI the user sees.

## Build

```bash
cd updater/win
npm install
npm run build:all              # both arches
# or:
npm run build:win-x64
npm run build:win-arm64
```

Output:
- `release/updater-win-x64.exe`    (~60 MB, Node 22 runtime included)
- `release/updater-win-arm64.exe`

These binaries are uploaded to the update CDN; the main app downloads
them on demand via `UpdaterFetcher` (see `src/main/lib/autoUpdate/`).

## Usage (manual / debugging)

```powershell
.\updater-win-x64.exe <zipPath> <installPath>
.\updater-win-x64.exe "C:\updates\Deskmate-1.2.0.zip" "C:\Users\You\AppData\Local\Programs\deskmate"
```

Logs: `%TEMP%\deskmate-updater.log` (stub) and the same file from
PowerShell (it appends to the same log).

## UI

```
┌─────────────────────────────────────────────┐
│ ▣ Deskmate Updater                     ✕    │
├─────────────────────────────────────────────┤
│  Extracting: app.asar                       │
│  ████████████████████░░░░░░░░░░  65%       │
│       Please do not close this window       │
└─────────────────────────────────────────────┘
```

## Project Layout

```
updater/win/
├── src/stub.ts          # Stub: writes embedded PS script + spawns PowerShell
├── tsconfig.json
├── package.json
└── README.md
```

The PowerShell UI script is **embedded as a string constant**
(`POWERSHELL_UI_SCRIPT` in `src/stub.ts`) and written to a temp file at
runtime. This keeps the deliverable a single .exe.

## Tooling

- Packager: [@yao-pkg/pkg](https://github.com/yao-pkg/pkg)
  (active fork of the archived `vercel/pkg`).
- Bundled Node runtime: 22.22.3 (active LTS).
- TypeScript: 5.x.

## History

Previous versions of this updater used a multi-layer hack to suppress
the console flash:

1. `stub.exe` writes a `.ps1` AND a `.vbs` file to %TEMP%
2. `stub.exe` spawns `wscript.exe` against the .vbs and exits immediately
3. The .vbs uses `WshShell.Run("powershell …", 0=hidden, True=wait)`
4. PowerShell finally runs the actual updater logic

…plus a manual PE-header patch step at build time to flip the .exe's
Subsystem field from Console (3) to Windows GUI (2).

All of that was working around the parent app's missing
`windowsHide: true`. Once the spawn site was fixed (Jun 2026), this
binary became a straightforward stub:
write script → spawn PowerShell hidden → await → exit.

If you ever need to drop the parent's `windowsHide: true` (don't), you
will have to bring back the VBS launcher and the PE patch. Don't.

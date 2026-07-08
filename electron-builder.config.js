const path = require('path');

const brandName = 'deskmate';
const brandDir = path.join(__dirname, 'brands', brandName);
const assetsDir = path.join(brandDir, 'assets');
const config = require(path.join(brandDir, 'config.json'));
const paths = {
  assets: assetsDir,
  assetsMac: path.join(assetsDir, 'mac'),
  assetsWin: path.join(assetsDir, 'win'),
  iconMac: path.join(assetsDir, 'mac/app.icns'),
  iconWin: path.join(assetsDir, 'win/app.ico'),
};

/**
 * Electron Builder Configuration
 * @type {import('electron-builder').Configuration}
 * @see https://www.electron.build/configuration/configuration
 *
 * Configuration values are loaded from: brands/deskmate/config.json
 */
module.exports = {
  appId: config.appId,

  // extraMetadata.name determines Windows NSIS install directory
  // → %LOCALAPPDATA%\Programs\<name>
  extraMetadata: {
    name: brandName,
  },

  // productName is the app display name and macOS .app bundle name
  productName: config.productName,

  // artifactName is the downloaded installer/archive filename
  artifactName: (config.filenamePrefix || '${productName}') + '-${version}-${os}-${arch}.${ext}',
  directories: {
    // scripts/vite/pack.ts 会把构建产物 + 生产 node_modules 装配到 vite-pack/，
    // electron-builder 从这个 staging 目录出包（two-package.json 模式）。
    app: 'vite-pack',
    output: 'release',
    buildResources: 'build',
  },
  files: [
    'out/**/*',
    // ladle (shadcn storybook) 产物落在 out/ladle，纯开发期工具，绝不进发布包。
    // electron-vite build 的 emptyOutDir 只清各自子目录，不会清掉它，必须在此显式排除。
    '!out/ladle/**/*',
    'resources/**/*',
    'package.json',
    '!**/*.map',
    '!**/*.ts',
    '!**/node_modules/*/{CHANGELOG.md,README.md,README,readme.md,readme}',
    '!**/node_modules/*/{test,__tests__,tests,powered-test,example,examples}',
    '!**/node_modules/*.d.ts',
    '!**/node_modules/.bin',
    '!**/*.{iml,o,hprof,orig,pyc,pyo,rbc,swp,csproj,sln,xproj}',
    '!**/{.DS_Store,.git,.hg,.svn,CVS,RCS,SCCS,.gitignore,.gitattributes}',
    '!**/{__pycache__,thumbs.db,.flowconfig,.idea,.vs,.nyc_output}',
    '!**/node_modules/playwright*/.local-browsers/**',
  ],
  // ── asarUnpack ──────────────────────────────────────────────────────
  // Packages listed here are extracted from the asar archive at install time
  // so they can access the real filesystem (spawn processes, load .node addons).
  //
  // CAUTION: Moving a runtime dependency to devDependencies will silently
  // exclude it from the build. electron-builder only packages `dependencies`
  // and `optionalDependencies`, NOT `devDependencies`. A module that works
  // fine in development (where all deps are installed) will fail at runtime
  // in the packaged app. Always verify with `npx asar list <app.asar>` after
  // build if you change dependency categories. (Lesson from 7ea925e / 09521ea)
  asarUnpack: [
    // pino worker_thread 用 require(absolutePath) 加载，asar 内的 require 在
    // worker 上下文不可靠（electron fs patch 不一定继承到 worker），必须 unpack。
    // 路径前缀 out/main/ 对应 pack.ts 把 out/ 整目录原样复制到 vite-pack/out/。
    'out/main/sqlite-transport.cjs',
    'node_modules/@vscode/ripgrep/**',
    // sharp 0.34+ resolves native binaries from platform-specific @img packages.
    // Keep both the loader package and native runtime packages outside asar.
    'node_modules/sharp/**',
    'node_modules/@img/sharp-*/**',
    // 注意：sqlite-vec 系列包当前未声明为依赖；条目保留是为了未来一旦
    // 重新引入这些 native 包时不必再翻这块配置 —— 若长期不用应直接删。
    'node_modules/sqlite-vec/**',
    'node_modules/sqlite-vec-darwin-arm64/**',
    'node_modules/sqlite-vec-darwin-x64/**',
    'node_modules/sqlite-vec-linux-x64/**',
    'node_modules/sqlite-vec-linux-arm64/**',
    'node_modules/sqlite-vec-windows-x64/**',
    'node_modules/node-screenshots/**',
    'node_modules/node-screenshots-win32-x64-msvc/**',
    'node_modules/node-screenshots-win32-ia32-msvc/**',
    'node_modules/node-screenshots-win32-arm64-msvc/**',
    'node_modules/node-screenshots-darwin-x64/**',
    'node_modules/node-screenshots-darwin-arm64/**',
    'node_modules/node-screenshots-linux-x64-gnu/**',
    'node_modules/node-screenshots-linux-x64-musl/**',
    'node_modules/node-screenshots-linux-arm64-gnu/**',
    // Playwright browser automation — playwright-core spawns child processes (browser server)
    // and performs file I/O (browser registry, profiles), which cannot work inside asar.
    // The wrapper package "playwright" is a thin re-export and can stay in asar.
    'node_modules/playwright-core/**',
  ],
  npmRebuild: false,
  nodeGypRebuild: false,
  buildDependenciesFromSource: false,
  compression: 'maximum',
  publish: [
    {
      provider: 'github',
      owner: 'flowingfate',
      repo: 'deskmate',
      private: false,
      protocol: 'https',
      releaseType: 'release',
      publishAutoUpdate: false,   // 本项目自更新走自研 CDN/GitHub API，不消费 electron-updater 的 latest*.yml，故不生成
    },
  ],
  releaseInfo: {
    releaseName: '${version}',
  },
  generateUpdatesFilesForAllChannels: false,
  afterPack: 'scripts/verify-sharp-runtime-packaging.js',
  afterSign: 'scripts/notarize.js',

  // ==========================================================================
  // macOS Configuration
  // ==========================================================================
  // App Bundle: /Applications/<productName>.app (spaces OK in macOS)
  // User Data:  ~/Library/Application Support/<userDataName>
  // Artifacts:  <filenamePrefix>-<version>-mac-<arch>.dmg/.zip
  mac: {
    icon: paths.iconMac,
    category: 'public.app-category.productivity',
    hardenedRuntime: true,
    gatekeeperAssess: false,
    entitlements: 'build/entitlements.mac.plist',
    entitlementsInherit: 'build/entitlements.mac.plist',
    type: 'distribution',
    artifactName: `${config.filenamePrefix}-\${version}-mac-\${arch}.\${ext}`,
    extendInfo: {
      NSAppleEventsUsageDescription:
        'This app needs to access Apple Events to run external programs.',
      NSSystemAdministrationUsageDescription:
        'This app needs system administration access to run MCP servers.',
      NSFileProviderPresenceUsageDescription:
        'This app needs file system access to manage MCP server files.',
      LSEnvironment: {
        PATH: '/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin',
      },
    },
    target: ['dmg', 'zip'],
    notarize: false,
  },

  // ==========================================================================
  // Windows Configuration
  // ==========================================================================
  // Install Dir: %LOCALAPPDATA%\Programs\<extraMetadata.name> (set by NSIS)
  // Executable:  <executableName>.exe (NO SPACES! Use filenamePrefix)
  // User Data:   %APPDATA%\<userDataName>
  // Artifacts:   <filenamePrefix>-<version>-win-<arch>.exe/.zip
  //
  // ⚠️ CRITICAL: executableName must NOT contain spaces!
  win: {
    icon: paths.iconWin,
    executableName: config.filenamePrefix || config.productName.replace(/\s+/g, '-'),
    // Do not hardcode both x64 and arm64 here. Local `npm run dist:win` should
    // build only the current runner architecture unless an explicit CLI arch
    // flag (for example `--x64` or `--arm64`) is provided.
    artifactName: `${config.filenamePrefix}-\${version}-win-\${arch}.\${ext}`,
    // 只出 nsis(.exe)：Windows 的电子自更新走"下载新 exe 静默重跑安装器"(配合
    // latest.yml + .blockmap 增量),不需要 zip —— nsis 安装包同时承担手动安装 + 自更新。
    // (mac 不同:Squirrel.Mac 自更新必须吃 zip,故 mac 保留 ['dmg','zip']。)
    target: ['nsis'],
    forceCodeSigning: false,
    extraResources: [
      {
        from: paths.assets,
        to: 'brand-assets',
        filter: ['**/*'],
      },
    ],
  },

  // ==========================================================================
  // NSIS Installer Configuration (Windows)
  // ==========================================================================
  // Install location is determined by extraMetadata.name (brandName)
  // → %LOCALAPPDATA%\Programs\<brandName>
  // shortcutName: Desktop and Start Menu shortcut display name
  nsis: {
    oneClick: true,
    allowToChangeInstallationDirectory: false,
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
    // shortcutName: Display name for desktop/start menu shortcuts
    shortcutName: config.shortcutName,
    displayLanguageSelector: false,
    multiLanguageInstaller: false,
    allowElevation: false,
    perMachine: false,
    artifactName: `${config.filenamePrefix}-\${version}-win-\${arch}.\${ext}`,
    differentialPackage: true,
  },
  // ==========================================================================
  // DMG Installer Configuration (macOS)
  // ==========================================================================
  // Layout inspired by Claude/Codex DMG installers:
  // - Icons centered vertically in window
  // - Proper spacing between app icon and Applications folder
  // - Clean, professional appearance with solid arrow
  // - Background: 1080x760 @2x (actual: 540x380)
  // - Arrow center Y: 340@2x = 170 logical pixels
  dmg: {
    iconSize: 80,
    background: 'build/dmg-background.png',
    contents: [
      {
        x: 135,
        y: 170,
        type: 'file',
      },
      {
        x: 405,
        y: 170,
        type: 'link',
        path: '/Applications',
      },
    ],
    window: {
      width: 540,
      height: 380,
    },
  },
};

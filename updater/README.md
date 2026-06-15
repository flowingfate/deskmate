# Deskmate 自更新器(updater/)

> Deskmate 应用自更新功能的**外挂程序源码**。日常开发不会碰到这里 ——
> 只在发版上传新版 updater 二进制到 CDN 时才需要。

---

## 这个目录是什么

Electron 应用**没法替换正在运行的自己**(Windows 上文件被锁,macOS 上替换运行中
的 .app 行为未定义)。所以业界标准做法是**用一个外部小程序来替换**:

```
1. 主程序检测到新版本 → 从 CDN 下载新版 ZIP 包
2. 主程序 spawn 一个【外挂 updater】,把 ZIP 路径 + 安装路径传过去
3. 主程序立即 app.quit() 退出
4. 外挂 updater 等主程序退出 → 解压 → 备份 → 覆盖新文件 → 启动新版本 → 清理
```

`updater/` 就是第 4 步那个"外挂"的源码。它产出**两个独立的可执行二进制**:

- `updater-mac-arm64`(给 Apple Silicon Mac 用,~58 MB)
- `updater-win-x64.exe`(给 64 位 Windows 用,~60 MB)

二进制本身**不打进主安装包**,而是**按需从 CDN 下载**到用户的 userData 目录。
主程序里负责下载/调用的代码在 `src/main/lib/autoUpdate/`。

---

## 为什么不用 electron-updater(标准方案)

90% 的 Electron 应用走 `electron-updater`(VS Code、Discord、Slack 等)。
Deskmate 选择自建,有三个具体理由:

| 理由 | 说明 |
|---|---|
| **CDN 完全自控** | 国内分发要绕 GitHub,自建 updater + CDN 是简化路径 |
| **不做 macOS 公证** | electron-builder 配置里 `notarize: false`,Squirrel.Mac 强烈要求公证 |
| **自定义 UX** | Windows 端有原生 Windows Forms 进度条,electron-updater 给不出 |

如果哪天上述三条都不再成立(签了 Apple Developer ID、出海、放弃自定义 UI),
**应该考虑迁回 electron-updater 把 `updater/` 整个删掉** —— 净删 5000+ 行代码,
跟随业界主流。

---

## 子项目结构

```
updater/
├── README.md          ← 你正在看的这份(总览)
├── mac/               ← macOS 自更新器(纯 JS,无 UI,~530B 源码)
│   ├── updater.js
│   ├── package.json
│   └── README.md      ← mac 端构建+部署细节
└── win/               ← Windows 自更新器(TS 包装 + 嵌入 PowerShell UI)
    ├── src/stub.ts
    ├── tsconfig.json
    ├── package.json
    └── README.md      ← win 端构建+部署细节(包括架构图)
```

**两个子项目互相独立**,各自有自己的 `node_modules`、自己的 `package.json`、
自己的构建产物。看具体技术细节请进对应子目录。

---

## ⚠️ 一条不能违反的不变量

**主程序 spawn updater 必须传 `windowsHide: true`。**

位置:`src/main/lib/autoUpdate/updateManager.ts`(搜 `spawn(updaterPath`)。

```typescript
const updaterProcess = spawn(updaterPath, [zipPath, installPath], {
  detached: true,
  stdio: 'ignore',
  windowsHide: true,    // ⚠️ 千万别删这行
});
```

**为什么关键**:`pkg` 打出来的 .exe 是 Console 子系统,Windows 启动它时默认会弹一个
黑色命令行窗口闪一下再关。`windowsHide: true` 让 Windows 直接不显示这个窗口。

**如果误删这行**会发生什么:
- 用户每次自动更新会看到一个黑窗一闪 —— 体验损坏但不会报错
- 也不会有任何测试/编译告警
- 你大概率发现不了,直到用户吐槽"更新的时候有个奇怪的黑色弹窗"

**如果决定保留**:那就是历史中所有 VBS+PowerShell+PE-patch 那套 hack 的**正当理由**。
关于那段历史的详细复盘,见 `updater/win/README.md` 末尾的 History 段。

---

## 何时需要碰这个目录

```
日常开发:                           → 不需要碰
改主程序的更新检查/下载逻辑:         → 改 src/main/lib/autoUpdate/,跟这里无关
要发新版的 updater 二进制(罕见):    → 进 mac/ 或 win/ 跑 npm run build:all → 上传 CDN
重构 updater 内部逻辑:              → 进 mac/ 或 win/,看子目录 README
迁移到 electron-updater:           → 整个目录可删
```

---

## 工具栈

| 项 | 选择 | 备注 |
|---|---|---|
| 单文件打包工具 | [`@yao-pkg/pkg`](https://github.com/yao-pkg/pkg) ^6.20.0 | 原 `vercel/pkg` 已 archive(2023),这是 active fork |
| Node 运行时(嵌入) | 22.22.3 (active LTS,支持到 2027/04) | yao-pkg cache 在 v3.6 tag 里只有 v22.22.3 的预编译,所以选这个 |
| Windows UI 渲染 | PowerShell + Windows Forms (`System.Windows.Forms`) | 嵌入在 `win/src/stub.ts` 的字符串常量里,运行时写到 %TEMP% 跑 |
| macOS UI | 无(静默更新) | 跟主流 Mac 应用一致,Mac 用户对静默更新接受度更高 |

---

## 怎么发布新版 updater(runbook)

### 先问一句:真的需要发吗?

`updater/` 里的二进制**很少需要重发**。Deskmate 主程序版本和 updater 版本是**独立的两套号**
 —— 你给 Deskmate 发 v1.20 → v1.21 完全不需要碰这里。

只在以下情况才发新 updater:

- 改了 `mac/updater.js` 或 `win/src/stub.ts` 的逻辑(本次重构就是这种)
- 升级了 Node 运行时版本(安全补丁)
- 修了 updater 自身的 bug(比如用户报告"更新一半失败")

### 在 mac 上一次性 build 所有平台

`@yao-pkg/pkg` 支持跨平台编译(它就是把预编译 Node 二进制 + JS 源代码捆起来,不涉及目标平台
native 编译)。所以你在自己的 Apple Silicon Mac 上就能产出 mac 和 win 两份二进制。**不需要
一台 Windows 机器**。

```bash
# 1. mac arm64 二进制
cd updater/mac
npm install                  # 首次 / 更新依赖时
npm run build:mac-arm64
#  → release/updater-mac-arm64

# 2. win x64 二进制(在同一台 mac 上)
cd ../win
npm install                  # 首次 / 更新依赖时
npm run build:win-x64
#  → release/updater-win-x64.exe
```

用 `file` 验证 win 产物确实是 Windows 二进制(防止环境配错):

```bash
$ file updater/win/release/updater-win-x64.exe
release/updater-win-x64.exe: PE32+ executable (console) x86-64, for MS Windows
```

`(console)` 是预期的 ——`windowsHide: true` 在主程序那边盖住了 console flash,不需要在
这里折腾 GUI subsystem(详见上文 ⚠️ 那一节)。

### 写 / 改 updaters.json

主程序通过这份 JSON 知道"CDN 上当前有什么 updater"。Schema:

```json
{
  "latest": "1.0.1",
  "downloadUrls": {
    "darwin-arm64": "updater-mac-arm64",
    "win32-x64":    "updater-win-x64.exe"
  }
}
```

- `latest`:你给这次 updater 发版定的版本号。语义化版本(`x.y.z`)。**主程序就靠它判断
  本地缓存的 updater 是否过时**。
- `downloadUrls` 的 key 严格等于 `${process.platform}-${process.arch}`:
  - macOS Apple Silicon → `darwin-arm64`
  - macOS Intel → `darwin-x64`
  - Windows 64 位 → `win32-x64`(注意是 `win32` 不是 `win`)
  - Windows ARM → `win32-arm64`
- `downloadUrls` 的 value 就是 CDN 上 `updaters/` 目录下的文件名(相对路径)。

如果哪天加了别的平台,加 key 就行;没加的 key 主程序在那个平台启动会报 `Unsupported
platform: <platformKey>` —— 不会静默失败。

### 上传到 CDN

CDN 根目录(在 `src/shared/constants/endpoints.ts` 里):

- 生产环境:`https://cdn.deskmate.top`
- 开发环境:`https://cdn.deskmate.top/dev`(NODE_ENV=development 时)

把以下文件上传到 `<cdn-root>/updaters/`:

```
<cdn-root>/updaters/updaters.json           ← 上一步的清单
<cdn-root>/updaters/updater-mac-arm64       ← mac 二进制
<cdn-root>/updaters/updater-win-x64.exe     ← win 二进制
```

⚠️ **顺序很关键**:**先传二进制,最后传 updaters.json**。反过来传的话,有用户运气不好正在做
更新检查,会读到新版 manifest 但下载二进制时 404,本次更新失败(下次启动还会再试,所以不
致命,但用户会看到一次报错弹窗)。

### 验证

开发环境跑一次主程序,触发更新检查。日志里应该看到:

```
UpdaterFetcher: Fetching updaters.json     url=https://cdn.deskmate.top/dev/updaters/updaters.json?...
UpdaterFetcher: Successfully fetched updaters.json    latestVersion=1.0.1
UpdaterFetcher: Starting updater download   downloadUrl=...   version=1.0.1
UpdaterFetcher: Updater download completed   version=1.0.1
```

下载下来的二进制会缓存到:

- macOS: `~/Library/Application Support/deskmate/assets/updater/updater-mac-arm64`
- Windows: `%APPDATA%\deskmate\assets\updater\updater-win-x64.exe`

本机版本号写在 `<userData>/app.json` 的 `updaterVersion` 字段。

### 用户那头会发生什么

你**只要把 `updaters.json` 的 `latest` 字段加 1**,所有用户在下一次更新检查里(默认每 6 小
时一次,见 `main.ts` 的 `startPeriodicCheck(360)`)就会:

1. 拉 `updaters.json`,对比本地 `updaterVersion` < `latest`
2. 静默下载新版二进制覆盖旧的
3. 写新 `updaterVersion` 到 `app.json`

**用户不需要做任何事,也不会看到任何提示** —— updater 升级是后台静默的。

真正涉及"重启 Deskmate 更新到新版本"的弹窗,是**主程序版本**的更新,跟这里无关。

---

## 历史教训(精简版,详见 `win/README.md`)

之前为了"消灭 Windows 上 console 一闪",这里堆过一座山:

```
stub.exe → 写 .ps1 → 写 .vbs → spawn wscript → VBS 隐藏跑 PowerShell → WinForms UI
+ 自定义 build-exe.js 在编译后用 PowerShell 直接 patch PE header 的 Subsystem 字段
```

这一切**都是绕开"主程序 spawn 没传 windowsHide: true"这一行的代价**。

2026/06 修了主程序那一行后,上面这一坨 hack **全部删除**。所以你现在看到的
`win/src/stub.ts` 简洁得有点不真实 —— **不是它一直就这样**,而是把根因修对了。

> 这就是为什么删 `windowsHide: true` 那行会让你"重新发现一遍历史":
> 一切 hack 都会无声地需要请回来。

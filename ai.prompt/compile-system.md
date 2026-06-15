<!-- Last verified: 2026-06-07 -->

# 构建系统文档

项目使用 **electron-vite 5.x**（vite 7 + esbuild + rollup）作为唯一构建工具。Webpack 已于 2026-05 完全移除。

## 配置架构

**核心配置：** `electron.vite.config.ts` — main / preload / renderer 三个构建目标的统一配置

```
electron.vite.config.ts
├── main:      src/main/bootstrap.ts  → out/main/      (ESM)
├── preload:   src/preload/*.ts       → out/preload/   (CJS)
└── renderer:  src/renderer/*.html    → out/renderer/  (React SPA)
```

三个目录互相独立 —— 这正是 electron-vite 框架的默认布局，每段构建只对自己的目录负责，`emptyOutDir` 用回默认 `true` 即可，孤儿文件随每次 rebuild 自动清掉。

**辅助脚本：**
| 文件 | 职责 |
|------|------|
| `scripts/vite/defines.ts` | 编译期环境变量替换 |
| `scripts/vite/ejs-template-plugin.ts` | HTML 模板处理（EJS 语法） |
| `scripts/vite/monaco-worker-plugin.ts` | Monaco editor worker bundling |
| `scripts/vite/pack.ts` | 打包编排：vite build → 创建 vite-pack/ staging → npm install --omit=dev → electron-builder |

## npm 脚本

```bash
npm run dev      # 开发模式：electron-vite dev -w（main + renderer watch + electron）
npm run build    # 构建：electron-vite build → out/
npm run start    # build + 启动 electron（不带 HMR）
npm run pack     # 本地打包测试（--dir 模式，不签名）
npm run dist:*   # 各平台正式打包（mac/win/linux/arm64/x64/universal）
```

所有 `dist:*` 脚本均通过 `bun scripts/vite/pack.ts` 透传参数给 electron-builder。

## 打包流程（pack.ts）

采用 **two-package.json 模式** 以确保 electron-builder 只打包生产依赖：

1. 运行 vite build，输出到 `out/`
2. 创建 staging 目录 `vite-pack/`，复制 `out/` → `vite-pack/out/`（**与源结构对齐**，asar 内路径直接复用），复制 `resources/`
3. 生成 `vite-pack/package.json`（只含 `dependencies`，剔除 devDependencies）
4. 在 `vite-pack/` 内运行 `npm install --omit=dev` 装生产依赖
5. 运行 `electron-builder`（自动加载 `electron-builder.config.js`），透传用户的额外参数

**配置真相源：** 项目只保留一个 `electron-builder.config.js`，里面已经把 `directories.app = 'vite-pack'` 写好；不存在 `electron-builder.vite.config.js`。

**`extraResources` vs `asarUnpack` 路径解析陷阱：** `extraResources.from` 相对**项目根目录**解析；`asarUnpack` 模式相对 **`directories.app`**（即 `vite-pack/`）解析。要从生产依赖里把某个 `node_modules/xxx` 文件复制到 app 外，**优先用 `asarUnpack`**（自动指向 `vite-pack/node_modules/`）；如果非要用 `extraResources`，记得手写 `from: 'vite-pack/node_modules/xxx'`，否则会去项目根的 `node_modules/` 找，生产依赖根本不在那里。

## 关键设计点

- **三段产物各自独立目录**：`out/main` / `out/preload` / `out/renderer` 完全分离。看一眼目录就知道产物归属，watch 模式下两个 watcher 不会互相覆写，孤儿文件自动随 rebuild 清空。
- **Preload 路径常量集中在 `src/main/lib/buildPaths.ts` 的 `PRELOAD_PATH`**：所有窗口创建（main / toolbar / screenshot / log viewer）一律 `import { PRELOAD_PATH }` 取路径，禁止散落的 `path.join(__dirname, 'preload.*.js')`。目录布局调整时只需改这一个文件。
- **Preload 强制 CJS**：ESM preload 无法 `require('electron')`。
- **`externalizeDeps`**：main 进程把 `node_modules` 外部化，由 Node.js `require` 运行时解析，体积大幅小于 webpack 单 bundle。
- **HTML 入口使用 EJS**：`<%- entryScript %>` 注入 Vite 的 `<script type="module">`；`<%= connectSrcExtra %>` 注入 dev 模式 CSP 所需的 `ws: wss:`。
- **Buffer polyfill**：Vite 不像 webpack 5 那样自动 polyfill Node 内置模块，需在使用处显式 `import { Buffer } from 'buffer'`（参见 `src/renderer/screenshot/core/state/editor.ts` 与 `handlers.ts`）。
- **环境变量回退**：`defines.ts` 中未设置的环境变量统一回退到 `''`，避免在字符串操作中触发 `TypeError`。
- **开发服务器 URL**：通过 `process.env['ELECTRON_RENDERER_URL']`（electron-vite 注入）传给 main 进程，详见 `src/main/main.ts` 和 `ScreenshotManager.ts`。

## 相关文件

- [arch-main.md](arch-main.md)
- [arch-render.md](arch-render.md)
- [workflows.md](workflows.md)

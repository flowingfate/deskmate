# 工作流

参考：`CLAUDE.md`、`.github/prompts/gitpush.prompt.md`、`playwright.config.ts`、`electron-builder.config.js`

---

## Git 约定

**分支命名：** `user/<alias>/<feature-name>`
- 示例：`user/alice/add-tool-execution-logs`

**提交信息格式**：遵循 conventional commits：
```text
type(scope): 简明描述

- 详细变更 1
- 详细变更 2
```
类型包括：`feat`、`fix`、`docs`、`style`、`refactor`、`test`、`chore`

**Pull Request：**
- 标题必须使用中文，且不超过 70 个字符
- 细节放在正文 / 描述中，不要堆在标题里
- 自动化 PR 工作流：`.github/prompts/gitpush.prompt.md`
- 流程：从 `main` 拉分支 → 修改代码 → 创建 PR → 请求评审 → 审批后合并

---

## 测试策略

### vitest（单元 / 集成）
- Runner：vitest，通过 Electron 的 Node 运行（`ELECTRON_RUN_AS_NODE=1`），以匹配 `better-sqlite3` 的 ABI（Electron 41 = 145）。详见 [CLAUDE.md §开发阶段验证](../CLAUDE.md)。
- 测试文件与实现文件同目录：`*.test.ts`
- 路径别名：`@shared/*`、`@renderer/*`
- 主进程测试需要 mock Electron
- 测试根目录：`src/` 与 `tests/`
- 命令：
  ```bash
  npm test           # 运行全部 vitest 测试
  npm run lint       # 检查代码风格
  npm run lint:fix   # 自动修复 lint 问题
  ```

### Playwright E2E
- 位置：`tests/e2e/`
- 配置：`playwright.config.ts`，60 秒超时，单 worker 串行执行
- Fixtures：通过 `_electron.launch()` 的自定义 Electron fixtures，并使用 `DESKMATE_TEST_USER_DATA_PATH` 进行隔离
- 测试套件：`startup.e2e.ts`（9 个测试）、`auth.e2e.ts`（6 个测试）、`chat.e2e.ts`（4 个测试）
- 覆盖完整生命周期：启动 → 认证 → 聊天交互
- 命令：
  ```bash
  npm run test:e2e           # 运行全部 E2E 测试
  npm run test:e2e:headed    # 可见浏览器模式
  npm run test:e2e:ui        # Playwright UI 模式
  npm run test:e2e:debug     # 调试模式
  npm run test:e2e:report    # 打开 HTML 报告
  ```

---

## 发布流程

```bash
# 准备发布（更新版本与 changelog）
npm run prepare:release         # 交互式
npm run prepare:release:patch   # x.x.1
npm run prepare:release:minor   # x.1.0
npm run prepare:release:major   # 1.0.0

# 构建安装包
npm run dist            # 当前平台
npm run dist:win        # Windows (NSIS + ZIP)
npm run dist:mac        # macOS (DMG + ZIP)
npm run dist:linux      # Linux (AppImage)
npm run dist:all        # 所有平台

# 指定架构
npm run dist:win:x64
npm run dist:win:arm64
npm run dist:mac:x64
npm run dist:mac:arm64
npm run dist:mac:universal

# 发布到 GitHub Releases (gim-home/Deskmate)
npm run dist:publish        # 构建并发布
npm run dist:publish:win
npm run dist:publish:mac
```

---

## 测试策略

### vitest（单元 / 集成）
- Runner：vitest，通过 Electron 的 Node 运行（`ELECTRON_RUN_AS_NODE=1`），以匹配 `better-sqlite3` 的 ABI（Electron 41 = 145）。详见 [CLAUDE.md §开发阶段验证](../CLAUDE.md)。
- 测试文件与实现文件同目录：`*.test.ts`
- 路径别名：`@shared/*`、`@renderer/*`
- 主进程测试需要 mock Electron
- 测试根目录：`src/` 与 `tests/`
- 命令：
  ```bash
  npm test           # 运行全部 vitest 测试
  npm run lint       # 检查代码风格
  npm run lint:fix   # 自动修复 lint 问题
  ```

### Playwright E2E
- 位置：`tests/e2e/`
- 配置：`playwright.config.ts`，60 秒超时，单 worker 串行执行
- Fixtures：通过 `_electron.launch()` 的自定义 Electron fixtures，并使用 `DESKMATE_TEST_USER_DATA_PATH` 进行隔离
- 测试套件：`startup.e2e.ts`（9 个测试）、`auth.e2e.ts`（6 个测试）、`chat.e2e.ts`（4 个测试）
- 覆盖完整生命周期：启动 → 认证 → 聊天交互
- 命令：
  ```bash
  npm run test:e2e           # 运行全部 E2E 测试
  npm run test:e2e:headed    # 可见浏览器模式
  npm run test:e2e:ui        # Playwright UI 模式
  npm run test:e2e:debug     # 调试模式
  npm run test:e2e:report    # 打开 HTML 报告
  ```

---

## 发布流程

```bash
# 准备发布（更新版本与 changelog）
npm run prepare:release         # 交互式
npm run prepare:release:patch   # x.x.1
npm run prepare:release:minor   # x.1.0
npm run prepare:release:major   # 1.0.0

# 构建安装包
npm run dist            # 当前平台
npm run dist:win        # Windows (NSIS + ZIP)
npm run dist:mac        # macOS (DMG + ZIP)
npm run dist:linux      # Linux (AppImage)
npm run dist:all        # 所有平台

# 指定架构
npm run dist:win:x64
npm run dist:win:arm64
npm run dist:mac:x64
npm run dist:mac:arm64
npm run dist:mac:universal

# 发布到 GitHub Releases (gim-home/Deskmate)
npm run dist:publish        # 构建并发布
npm run dist:publish:win
npm run dist:publish:mac
```

macOS 构建使用 hardened runtime，并通过 `scripts/notarize.js` 完成 notarization。

发布工作流说明：
- Windows 发布任务按架构拆分。
- Windows x64 构建运行在 `windows-latest`。
- Windows ARM64 构建运行在 `windows-11-arm`。
- 每个 Windows 发布任务只发布自己的目标架构，而不是在一个 runner 上交叉构建两个架构。
- `windows-11-arm` 是否可用取决于仓库的 GitHub Actions 套餐和 runner entitlement；如果不可用，发布工作流必须改用自托管 ARM64 runner，或临时退回到 x64 交叉构建并结合 sharp 的 `afterPack` 保护逻辑。

---

## 依赖管理

> **警告：** electron-builder 只会打包 `dependencies` 和 `optionalDependencies`。位于 `devDependencies` 中的包会在生产构建中被静默排除。

**关键事故：** 曾将 `playwright` 移入 `devDependencies`（commit `7ea925e`），导致生产包里的所有浏览器自动化能力（CDP 认证、网页搜索）全部失效，而开发环境中看起来仍然正常。

**调整依赖分类后请验证：**
```bash
npx asar list <app.asar> | grep <module>
```

**`sharp@0.34+` 的原生打包验证：**
- `sharp` 不再从 `sharp/build/Release` 加载 Windows 二进制。
- 打包后的应用必须在 `app.asar.unpacked/node_modules/@img/` 下包含解包后的平台包。
- 对 Windows ARM64，确认存在 `app.asar.unpacked/node_modules/@img/sharp-win32-arm64/lib/sharp-win32-arm64.node`。
- 对 Windows x64，确认存在 `app.asar.unpacked/node_modules/@img/sharp-win32-x64/lib/sharp-win32-x64.node`。
- 在 Windows 上，还要确认同一 `lib/` 目录下的配套 DLL 也被打包，因为 `.node` 二进制会在运行时依赖这些 DLL。

| 类别 | 会被打包？ | 适用场景 |
|----------|-----------|-------------|
| `dependencies` | 是 | 主进程运行时需要的模块，例如 `playwright-core`、`sharp`、`better-sqlite3` |
| `devDependencies` | 否 | 构建工具、测试框架、仅供 renderer 打包的模块，例如 `mermaid`、`monaco-editor`、`@playwright/test` |

**`playwright` 与 `playwright-core` 的区别：**
- `playwright-core` → 放在 `dependencies`，约 8MB，是运行时用于 CDP 认证和网页搜索的纯 API 库
- `playwright` → 放在 `devDependencies`，约 280MB，是带浏览器二进制的测试封装，只用于 E2E 测试

---

## 环境变量

构建时不再读取任何 `.env` 文件 —— 所有构建期常量已硬编码在源码中（`src/shared/constants/`）。
`.env.local` 仅在运行时由 `main.ts` / `evalMode.ts` 加载，用于注入开发期可选密钥。

| 变量 | 作用域 | 说明 |
|----------|-------|-------------|
| `NODE_ENV` | Build | `development` / `production`（由 Vite 自动注入，无需配置） |
| `EVAL_AUTH_TOKEN` | Runtime (main) | Eval mode 所需的鉴权 token；通过 `.env.local` 注入 |
| `DESKMATE_TEST_USER_DATA_PATH` | Runtime (main) | E2E 测试覆盖 user data 根目录 |

---

## 已知限制

- 某些 MCP server 需要 **Python 3.10+**
- 主 AI provider 需要 **GitHub Copilot 订阅**

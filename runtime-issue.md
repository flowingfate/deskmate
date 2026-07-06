<!-- Last verified: 2026-07-07 -->

# Runtime 系统的两个问题（问题一已落地 / 问题二方案已定稿）

> 记录 runtime shim 与"依赖装到哪"两个问题。**问题一已实现**（下文记录方案与理由）；**问题二方案已定稿、待落地**（目录收进 `~/.deskmate/env/`，只堵新泄漏、不清老账、不碰 venv 隔离）。

---

## 背景：managed runtime 是怎么工作的

Deskmate 自带一套运行时（bun + uv + Python），下载到 `{userData}/bin`（本仓库 `{userData}` = `~/.deskmate/`）。核心机制两条：

1. **Shim（命令垫片）**：在 `{userData}/bin` 放一批转发脚本，把标准命令名重定向到 managed 工具（`python→uv run python`、`pip→uv pip`、`node/npm/npx→bun`、`uvx→uv tool run`、`bunx→bun x -y`）。仅在依赖工具已装时落盘（`bun`/`uv` 存在才建对应 shim）；Unix 是 `#!/bin/sh` 脚本，Windows 是 `.cmd`。**落盘布局见问题一（已拆两层）。**
2. **PATH 前插**：spawn 子进程时把 bin 目录放到 PATH 最前，于是子进程敲 `python`/`npm` 命中 shim。

两类子进程都走这套：
- **MCP transport**（`type: 'mcp_transport'`）：起 MCP server。
- **shell tool**（`type: 'command'`）：LLM 调 `shell` 工具执行任意命令。

env 是 **per-spawn** 的：`buildEnhancedEnvironment` 首行 `const env = { ...process.env }`，所有改动都在副本上，只喂给那一个子进程，`process.env` 本体不动。作用域是"每一条命令"而非"整个 app"——这让 shell 和 MCP 用不同 shim 集合的成本极低（按 `this.type` 分支即可，不动全局）。

关键代码：`terminal/environment.ts`（拼 PATH）、`runtime/shim.ts`（生成 shim）、`terminal/BaseTerminalInstance.ts`（`prepareEnvironment` + spawn）、`runtime/internalEnv.ts`（`buildInternalEnv` 注入 `UV_PYTHON`/`VIRTUAL_ENV`，经 `runtimeBridge` 依赖反转桥接进 terminal）。

---

## 问题一：shell tool 不该把 `node/npm` 静默换成 bun（已实现）

### 问题与理由

同样是 shim，两个场景风险不对称：MCP 的命令是 server 作者按规范写死的（`npx some-mcp`），窄而可预期；shell tool 的命令是 **LLM 现编的任意命令**，把 `node`/`npm` 悄悄换成 bun 等于在 LLM 背后改了语义。而 JS 侧与 Python 侧的分歧风险又不对称：

| shim | 实质 | 分歧风险 |
|---|---|---|
| `node → bun` | 运行时替换（JavaScriptCore ≠ V8） | **高**：`--max-old-space-size`/`vm`/heap snapshot/部分 N-API/`--loader`/`--inspect-brk` 行为不同；`process.execPath` 变 bun |
| `npm → bun` | 包管理器替换 | **高，且多为静默**：lockfile 不兼容；postinstall 默认被拦→node-gyp 原生模块悄悄没编译，`require` 时才炸；`npm ci`/`audit`/`publish` 非 1:1 |
| `python → uv run python` | 真·CPython | **低**：跑的就是 python，语言零分歧 |
| `pip → uv pip` | 近似重实现 | **低**：绝大多数兼容，不会静默毁掉安装 |

**结论**：Python 侧是真解释器 + 高保真包工具（低分歧，保留走 uv）；JS 侧是运行时 + 包管理器双重"狸猫换太子"（高分歧，shell 里交还系统）。

### 已实现方案

- **shim 落盘拆两层**（`runtime/shim.ts`）：
  - **root `{userData}/bin/`**：Python shim（python/pip→uv）+ 真二进制 bun/uv/uvx + `uvx`/`bunx` shim（显式调自带 runtime，不冒充系统命令）。
  - **`{userData}/bin/node-shims/` 子目录**：只放 `node`/`npm`/`npx`（冒充系统命令名者），以 `../bun` 反向引用 root 真二进制。
- **PATH 按 scope 前插**（`terminal/environment.ts` + `BaseTerminalInstance.resolveShimScope`，env 与 wrapper 共用同一决策）：
  - **shell（`command`）**：只前插 root → `node/npm/npx` 落系统真货、`python/pip` 走 uv、`bun/uv/uvx/bunx` 真名可用。
  - **MCP（`mcp_transport`）**：额外前插 `node-shims/` → 维持全套 shim（历史行为不变）。
  - **Win-ARM bypass**：`shouldBypassInternalNodeShims` 命中时整体不前插（现有逻辑）。
- **wrapper 同步**（`commandBuilder.createShellWrapper`）：`-i` 分支末尾按同一 scope 重前插目录集，覆盖 `.zshrc`/nvm 对 PATH 的修改。

> **为何不用 shell function 注入**（曾考虑的备选）：`command` 子进程 env 已把 bin 前插到 PATH，"不定义 function"挡不住 `node` 命中 shim；且 function 只在 `-i` wrapper 分支执行，非 `-i`（如 `sh -l`）漏覆盖。拆子目录在 env 级统一，对所有 shell 一致。

---

## 问题二：依赖包/缓存装到哪？——大量泄漏到用户全局空间（方案已定稿，待落地）

代码里**只显式设了两个**跟"装到哪"相关的变量：`VIRTUAL_ENV`、`UV_PYTHON`。其余全部落到各工具的**系统默认目录**（撒进用户家目录）。

### 现状：装到哪

| 装什么 | 位置（macOS） | 受管吗 | 在 {userData} 吗 |
|---|---|---|---|
| Python 包（pip） | `{userData}/python-venv/.../site-packages/` | ✅ 显式设 VIRTUAL_ENV | ✅ 在 |
| uvx CLI 工具 | `~/.local/share/uv/tools/` + `~/.local/bin/` | ❌ 默认 | ❌ 不在 |
| uv 下载缓存 | `~/.cache/uv/` | ❌ 默认 | ❌ 不在 |
| uv 装的 Python | `~/.local/share/uv/python/` | ❌ 默认 | ❌ 不在 |
| npm 本地包 | `<cwd>/node_modules/` | ❌ 跟随 cwd | ❌ 不在 |
| npm/bun 全局包 | `~/.bun/install/global/` + `~/.bun/bin/` | ❌ 默认 | ❌ 不在 |
| bun 包缓存 | `~/.bun/install/cache/` | ❌ 默认 | ❌ 不在 |

> `/settings/runtime` 的 "Clean Cache" 清的是 `~/.cache/uv/`；Python 列表扫的是 `~/.local/share/uv/python/`。

### 由此引出四个毛病（分量不同）

| # | 毛病 | 严重度 | 本轮态度 |
|---|---|---|---|
| 1 | **卸载不干净**：删应用留一堆残渣（`~/.bun`、`~/.cache/uv`、`~/.local/share/uv`） | 中 | ✅ 解 |
| 2 | **跟用户自己的 bun/uv 抢同一个家**：共用全局目录/缓存，版本互污 | 高 | ✅ 解 |
| 3 | **全局装的 CLI 下一条命令找不到**：`~/.bun/bin`、`~/.local/bin` 不在 PATH 前置 | 中 | ✅ 顺手解 |
| 4 | **所有 shell 共用同一个 Python venv**：无 per-session/per-agent 隔离 | 高 | ❌ 本轮不做 |

**为何 1/2/3 一起解、4 单拎出去**：1/2/3 是同一个病根（"没告诉工具往哪装"）、同一副药（环境变量钉目录），一次收口三个一起掉。**#4 是另一种病**——不是"装到哪"，是"该不该所有对话共用一个 Python 环境"，要真隔离得给每会话/Agent 起独立 venv，是架构级改动，风险和工作量高一个数量级。本轮明确不碰，单独立项。

### 总策略

> **把自带运行时的"装机行为"关进 `~/.deskmate/env/` 的院子里——只堵新泄漏（1/2/3），不清老账，不碰隔离（4）。**

**不考虑存量历史兼容**：纯换目录基点，零迁移代码。老用户的 `~/.deskmate/bin`、`~/.deskmate/python-venv` 及家目录残渣一律**不迁移、不删除**，下次 lazy install 自动在 `env/` 重建（Python 会"列表暂空 → 下次装自愈"）。changelog 提一句即可。

### 一、目录布局：全部收进 `~/.deskmate/env/`

顶层保持清爽，运行时产物一个命名空间全包住。判据：**"删了能整个重装出来"的 = 运行时产物 = 进 `env/`；用户账号/对话/日志 = 应用数据 = 留顶层。**

```
~/.deskmate/
├── logs/ crashes/ state/ assets/ profiles/ ...   ← 应用数据，原地不动
└── env/                        ← 运行时地盘，一个命名空间全包住
    ├── bin/                    （原 ~/.deskmate/bin：shim + bun/uv 二进制）
    │   └── node-shims/         （node/npm/npx shim，跟着搬）
    ├── python-venv/            （原 ~/.deskmate/python-venv）
    ├── uv-cache/               uv 下载缓存
    ├── uv-tools/               uvx 装的 CLI 工具环境
    ├── python/                 uv 装的 Python 本体
    ├── bun/                    bun 全局包 + 下载缓存
    └── runtime-bin/            全局 CLI 的可执行入口统一收口
```

归属表（逐个安置泄漏源）：

| 产物 | 现在撒在哪 | 收进哪 |
|---|---|---|
| uv 下载缓存 | `~/.cache/uv` | `env/uv-cache` |
| uvx CLI 工具 | `~/.local/share/uv/tools` | `env/uv-tools` |
| uv 装的 Python | `~/.local/share/uv/python` | `env/python` |
| bun 全局包 + 缓存 | `~/.bun/install/...` | `env/bun` |
| **全局 CLI 可执行入口** | `~/.local/bin` + `~/.bun/bin` | `env/runtime-bin` |

**为何全局 CLI 入口另开 `runtime-bin`，不塞回 `bin/`**：`bin/` 里住着 shim（`python`/`node`/`npm` 冒充系统命令的转发脚本）。若全局装了个也叫 `python` 的 CLI 链进 `bin/`，会跟 shim 撞名互相遮蔽。单开干净的 `runtime-bin/` 专收全局入口，彻底不打架。

### 二、怎么保证装到那儿：喂环境变量（且 A/B 两路都要喂）

**不改工具行为，只喂目录环境变量**（已核对 uv / bun 官方文档）：

```
# uv
UV_CACHE_DIR          = env/uv-cache
UV_TOOL_DIR           = env/uv-tools
UV_PYTHON_INSTALL_DIR = env/python
UV_TOOL_BIN_DIR       = env/runtime-bin     # uvx 工具入口
UV_PYTHON_BIN_DIR     = env/runtime-bin     # python3.x shim 入口（文档原清单漏了）

# bun
BUN_INSTALL           = env/bun             # 全局包 + 缓存的根
BUN_INSTALL_BIN       = env/runtime-bin     # 全局 CLI 入口（仅 BUN_INSTALL 不改 ~/.bun/bin，文档原清单漏了）
```

> `BUN_INSTALL` **不影响**托管的 bun 二进制（它在 `env/bin`，按绝对路径/PATH 调用）——只决定全局装到哪，安全。

**这题真正的坑：喂的地方有两个，不是一个。** 自带运行时被拉起来有**两条彼此独立的 env 构建入口**：

- **路径 A = 设置页按钮**：`/settings/runtime` 点"装 Python""清缓存" → `uvContext()` → `getEnvWithInternalPath()` → `buildInternalEnv`（走内部 env）。
- **路径 B = LLM 在干活**：shell 工具 `bun add -g` / `pip install` / `uvx foo`、跑 MCP server → `buildEnhancedEnvironment()` → `applyRuntimeEnv()`（**自己另拼一套 env，完全不经过 A**）。

**泄漏大头全在路径 B**（撒包撒缓存多是 LLM 现装，不是用户点按钮）。铁律：**目录变量 A、B 两条路都必须喂到，漏一条等于没做。** 落地手段——把"喂目录变量"做成**一个共享纯函数，A、B 两处都调它**，杜绝只改一边。顺带把现有 `UV_PYTHON`/`VIRTUAL_ENV` 的**双写重复**（`internalEnv.ts` 一份、`runtime/terminalBridge.ts` 一份）也收进这个共享函数去重。

### 三、装完怎么用：runtime-bin 进 PATH + 修 Python 列表读取点

**「装了能找得到」才闭环（解毛病 #3）**：全局 CLI 入口统一落 `env/runtime-bin`，只要把 **`runtime-bin/` 加进路径 B 的 PATH 最前**（`environment.ts` 的 `pathComponents` + Windows 分支 `binDirs`），LLM `bun add -g cowsay` 后下一条 `cowsay` 直接命中。路径 A 不需要全局 CLI，PATH 只改 B。

**一处隐形联动必须一起改（否则设置页出 bug）**：设置页 Python 版本列表**不 spawn uv**，直接 `fs.readdir` 硬编码的 `~/.local/share/uv/python`（`pythonInstall.ts` 的 `getUvPythonDir` / `listPythonVersionsFast`）。改了 `UV_PYTHON_INSTALL_DIR` 后它还翻老目录 → **列表直接空**。做法：让新 Python 目录只有**一个定义处**（`path.ts::getUvPythonInstallDir`），环境变量注入与列表读取都从它取值，杜绝漂移；`getUvPythonDir` 的 Windows 平台分支可一并删除（override 后全平台统一）。设置页其余按钮不用改——`uv cache clean` / `uv python uninstall` 走路径 A 的 env，目录变量注入后自动清/卸新目录。

### 四、为何这次几乎零成本

所有运行时目录本就从 `path.ts` 一个文件派生，且都挂在 `getAppDataPath()`（`~/.deskmate/`）下。改法只一处枢纽——加基点，把运行时 helper 的 base 从 `getAppDataPath()` 换成它：

```
getRuntimeEnvDir()      = join(getAppDataPath(), 'env')        ← 新增，唯一新基点
getBinDir()             = join(getRuntimeEnvDir(), 'bin')          ← 改基点
getPythonVenvDir()      = join(getRuntimeEnvDir(), 'python-venv')  ← 改基点
getUvCacheDir()         = join(getRuntimeEnvDir(), 'uv-cache')     ← 新增
getUvToolDir()          = join(getRuntimeEnvDir(), 'uv-tools')     ← 新增
getUvPythonInstallDir() = join(getRuntimeEnvDir(), 'python')       ← 新增（列表读取的单一来源）
getBunInstallDir()      = join(getRuntimeEnvDir(), 'bun')          ← 新增
getRuntimeBinDir()      = join(getRuntimeEnvDir(), 'runtime-bin')  ← 新增
```

消费者一行不用改——都拿绝对路径（`RuntimeManager`、`PlaywrightManager`、`environment.ts` 全从这些 helper 取值），helper 内部换基点，上游自动跟随。三处"确认无坑"：① shim 相对引用 `../bun` 随整个 `bin/` 一起搬，相对关系不变，不动 `shim.ts`；② PATH 前插取 `getBinDir()`/`getNodeShimsDir()` 绝对路径，自动指新位置；③ 老 `~/.deskmate/bin`、`python-venv` 变孤儿，不迁不删，下次 lazy install 在 `env/` 重建。

### 落地清单（5 文件 + 测试）

- `src/main/persist/lib/path.ts`：加 `getRuntimeEnvDir` 基点 + 各 managed dir helper；`getBinDir`/`getPythonVenvDir` 改基点。
- `src/main/lib/runtime/internalEnv.ts` + `src/main/lib/runtime/terminalBridge.ts`：新增共享纯函数 `applyManagedRuntimeDirs`（喂目录变量 + 收编 `UV_PYTHON`/`VIRTUAL_ENV` 去重），A、B 两路都调。
- `src/main/lib/terminal/environment.ts`：`runtime-bin` 加入路径 B 的 PATH 前插。
- `src/main/lib/runtime/pythonInstall.ts`：`getUvPythonDir` 改读 `getUvPythonInstallDir()`（列表联动），删 Windows 平台分支。
- 测试：`internalEnv.test.ts` 补目录变量断言；新增 `applyManagedRuntimeDirs` 单测。

---

## 相关文件

- Shim 生成：`src/main/lib/runtime/shim.ts`
- 环境变量构建：`src/main/lib/terminal/environment.ts`、`src/main/lib/runtime/internalEnv.ts`
- 命令/wrapper 构建：`src/main/lib/terminal/commandBuilder.ts`
- spawn 与 scope 决策：`src/main/lib/terminal/BaseTerminalInstance.ts`（`prepareEnvironment` / `resolveShimScope`）
- Python 安装/扫描：`src/main/lib/runtime/pythonInstall.ts`
- 设置页：`src/renderer/components/settings/runtime/`

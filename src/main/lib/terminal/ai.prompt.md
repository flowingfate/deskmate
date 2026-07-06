<!-- Last verified: 2026-07-08 -->
# lib/terminal — 统一终端实例管理器

> 主进程唯一的子进程 spawn 入口。统一承载两类终端：**一次性命令**（`command`）
> 与 **MCP 持久传输**（`mcp_transport`）。跨 Windows / macOS，负责实例池、生命周期、
> 环境拼装与优雅关闭。所有 shell 命令、MCP stdio server、git/uv 探测都从这里落地。

## 设计原则

有状态的类保持精简，**只负责状态与事件编排**；大块逻辑（命令构建、环境拼装、
命令解析、结果收敛、进程树清理）全部提取为**无状态纯函数模块**，可独立阅读与测试。
实例按 `config.type` 拆成 `CommandInstance` / `McpTransportInstance` 两个子类，共享逻辑
上提到 `BaseTerminalInstance`，用**多态替代 type 分支**。读代码先看基类的编排骨架，
再看子类各自的输出解释，最后按需下钻纯函数。

## 关键文件

| 文件 | 职责 | 规模 |
|------|------|------|
| **有状态类（薄编排层）** | | |
| `TerminalManager.ts` | 单例。实例池（`Map<id, instance>`）+ 池配置 + 清理定时器；创建/停止/清理实例、协调生命周期。配置校验委托 `validateConfig` | ~300 LOC |
| `BaseTerminalInstance.ts` | 实例抽象基类。持有 `state` / `process`，编排 spawn→ready→stop 生命周期与状态机；`prepareEnvironment` / `prepareCommand` 委托纯模块。输出解释由子类 `setupOutputHandlers` 实现；MCP 专属的运行时安装 / shim 绕过是可覆盖 hook（基类 no-op） | ~330 LOC |
| `CommandInstance.ts` | 一次性命令子类。缓冲 stdout/stderr（超 `maxOutputLength` 截断），`execute()` 委托 `commandExecutor.runCommand` 收敛结果 | ~55 LOC |
| `McpTransportInstance.ts` | MCP 持久传输子类。stdout/stderr 按 `\n` 分帧（`StreamSplitter`），`send()` 写入；覆盖 `ensureRuntimeInstalled`（lazy-install）与 `shouldBypassInternalNodeShims`（Win-ARM） | ~100 LOC |
| `processControl.ts` | 有状态辅助：`StreamSplitter`（按分隔符切流）、`TerminalStateHandler`（优雅关闭状态机）；`killProcessTree` 是纯函数 | ~130 LOC |
| **纯函数 / 数据模块（无状态）** | | |
| `types.ts` | `TerminalConfigBase`（公共字段，三个消费者入口的参数类型）+ `TerminalConfig extends TerminalConfigBase`（加判别字段 `type`）/ `TerminalResult` / `TerminalInstanceInfo` / 平台配置类型（实例类型直接用 `BaseTerminalInstance`） | ~95 LOC |
| `platformConfigs.ts` | 各平台 shell 配置数据表（`PLATFORM_CONFIGS`：win32 / darwin）+ 无状态 shell 解析工具：`getShellProfile` / `getRunnableShellProfile`（不可用回退）/ `isShellCommandAvailable`（模块级缓存，`which`/`where` 探测）/ `resolveCommandPath` / `getEnhancedEnvironment`（委托 `environment`） | ~220 LOC |
| `environment.ts` | 环境变量构建（增强 PATH / 版本管理器变量 / 固定 Python 版本 / envFile 解析 / `untildify`）+ `userDataBinPath()` | ~203 LOC |
| `commandBuilder.ts` | shell 调用字符串构建（`parseCommandString` / `buildShellInvocation` / `createShellWrapper` / `createMissingCwdPrefix`） | ~186 LOC |
| `commandExecutor.ts` | `runCommand`：把子进程 close/exit/error 收敛成单个 `TerminalResult` | ~88 LOC |
| `validateConfig.ts` | 终端配置校验，非法抛 `Error` | ~31 LOC |
| `ids.ts` | `genId(prefix)`：模块内短 ID 生成（实例 / 管理器 / 命令执行追踪标识） | 极小 |
| `index.ts` | 模块导出（主入口 `terminalManager` 实例 + `TerminalManager` 类；实例类型出口 `BaseTerminalInstance`） | 极小 |

## 架构

### 两类实例（`config.type` 选子类，`createCommand` / `createTransport` 内工厂）

两条**正交**轴：输出解释（子类拆）× 生命周期 `persistent`（基类由 config 驱动，两子类都可持久）。

**核心纪律：构造与启动分离。** `createCommand` / `createTransport` 只造实例 + 入池 + 挂 pool 级监听，
**绝不 `start`**；返回**未启动**的具体类型（`CommandInstance` / `McpTransportInstance`）。调用方先挂自己的
stdout/stderr/message/exit 监听，再自行 `start()` —— 保证 spawn 前监听就位，首帧输出 / exit 不丢。

- **`CommandInstance`（`command`）**：`createCommand` 造实例。一次性、无需增量输出 / 取消的场景直接用
  `Manager.run(config)` 宏（内部 create→`execute()`→`finally` 立即 `stopInstance(force)` 回收；`execute()`
  **自带 spawn**，必要时先 `start()`，故一次性交互塌成一次调用，无 start→execute 顺序 footgun）。
  需要增量输出 / 取消（`shell` 工具，挂 stdout/stderr 监听后直接 `execute()`）或长驻后台
  （`persistent: true`，`BackgroundProcessManager`，只 `start()` + 事件流、不 `execute()`）时用 `createCommand`
  拿未启动实例。输出经 `setupOutputHandlers` 收进 `stdout`/`stderr` 缓冲，超 `maxOutputLength`（默认 8000）截断。
- **`McpTransportInstance`（`mcp_transport`）**：`createTransport` 造实例，始终 `persistent`。调用方挂
  `message`（`StreamSplitter` 按 `\n` 切 JSON-RPC 行）/ `exit` 监听后 `start()`，`send()` 写入。必装
  `TerminalStateHandler`。覆盖基类两个 hook：`ensureRuntimeInstalled`（lazy-install）、
  `shouldBypassInternalNodeShims`（Win-ARM）。

### 实例生命周期与状态机

`TerminalState = idle | running | stopping | stopped | error`，`setState` 每次变更 emit `stateChange`。

`start()` 流程（`BaseTerminalInstance.start`，两子类共享）：
1. `prepareCwd`：`untildify` + 转绝对路径。
2. `getRunnableShellProfile`：请求的 shell 不可用则回退默认 shell，附 `fallbackReason` 告警。
3. cwd 不存在 → `createMissingCwdPrefix` 生成切目录前缀，cwd 回退到 `homedir()`。
4. `prepareEnvironment`：`includeBinPath` 时调子类 `ensureRuntimeInstalled` hook（MCP 才安装）+ 增强环境 + envFile + `config.env` 覆盖。
5. `prepareCommand`（委托 `buildShellInvocation`）→ `spawn(executable, args, { shell })`。
6. `persistent` 装 `TerminalStateHandler`；`setupEventHandlers` → 调子类 `setupOutputHandlers`；`waitForSpawn`（5s 超时）。

### 进程池管理（`TerminalManager`）

- **模块级单例**：`import { terminalManager } from '@main/lib/terminal'`（构造零成本，模块加载即建，无 lazy getter）。测试要隔离实例直接 `new TerminalManager()`。
- **池配置**：`maxInstances=50`，`idleTimeoutMs=5min`，`cleanupIntervalMs=5min`（`unref` 的定时器）。
- **达上限**：`ensureCapacity`（造实例前必调）先 `cleanupIdleInstances(true)`，仍满则抛。
- **回收路径（收敛后）**：`exit` 事件是任何「跑起来又退出」实例的**唯一权威摘池路径** ——
  退出后延迟 `EXIT_REMOVAL_DELAY_MS`（1s，让下游 exit 监听先跑完）`delete` + `dispose`，
  不再按 persistent / 退出码分流。周期 `cleanupIdleInstances` 退化为纯泄漏兜底（清「创建后从未 exit」
  的 idle / error 实例 + 满池泄压）。`stopInstance` 的 `finally` 必 `delete` + `dispose`，即使 `stop` 抛错也不泄漏。

### 优雅关闭（`TerminalStateHandler`，仅持久实例）

阶段推进：`running → stdinEnded`（end stdin 给宽限期 10s）`→ killedPolite`（`killProcessTree` 温和信号
SIGTERM/-15）`→ killedForceful`（SIGKILL/-9）。非持久实例走简单路径：`stop()` 直接发信号，
非 force 时 5s 后兜底 SIGKILL。

### 环境增强 & shim scope（`environment.buildEnhancedEnvironment` + `runtime/shim.ts`）

补全版本管理器变量（pyenv/nvm/rbenv/nodenv/Rust/Go/Homebrew，仅缺失时写）+ 固定 Python 版本。
运行时目录统一收进 `{userData}/env/`（见 `persist/lib/path.ts::getRuntimeEnvDir`）。`{userData}/env/bin` 前置到 PATH，
但 **shim 按消费者 scope 分两层前插**（`BaseTerminalInstance.resolveShimScope` 统一决策，env 与 wrapper 共用同一结论）：

- **root bin**（`{userData}/env/bin/`）：Python shim（python/pip→uv）+ 真二进制 bun/uv/uvx + `uvx`/`bunx` shim
  （显式调自带 runtime，不冒充系统命令）。**所有 internal scope 都前插**。
- **node-shims 子目录**（`{userData}/env/bin/node-shims/`）：node/npm/npx shim（→ `../bun`，冒充系统命令名的高风险
  静默替换）。**仅 `mcp_transport` 额外前插**。`command` 型（shell 工具）不前插 → node/npm/npx 落系统真二进制，
  避免在 LLM 背后把 node/npm 静默换成 bun（运行时 + 包管理器双重分歧）。
- **runtime-bin**（`{userData}/env/runtime-bin/`）：全局 CLI 可执行入口（`bun add -g` / `uvx` 装的工具）。
  **仅 internal 模式前插**，排在 shim 目录之后、系统 PATH 之前 → shim 压过同名全局 CLI，全局 CLI 压过系统。
  令 `bun add -g cowsay` 后下一条 `cowsay` 直接命中（`environment.userDataRuntimeBinPath`）。

wrapper（`-i` 分支）末尾会重前插同一 scope 的目录集（shim 目录 + runtime-bin，覆盖 .zshrc/nvm 对 PATH 的修改），
故 MCP 走 wrapper 时 node-shims 也被重前插、shell 则否；runtime-bin 两者都重前插。
`mcp_transport` 首次 spawn 时 lazy-install 对应运行时（把成本从 FRE 启动移到首次连接）。

## 用法

主入口 `terminalManager`（模块级 const 单例）。类型从 `./types` 直接 import，barrel 导出
`TerminalManager`（类）/ `terminalManager`（实例）+ 实例类型 `BaseTerminalInstance` / `CommandInstance` /
`McpTransportInstance`。平台默认 shell：Windows → PowerShell，macOS → zsh。

**三个消费者入口，层级一致，`type`/`persistent` 由入口锁死（不用调用方传）：**

```typescript
import { terminalManager } from '@main/lib/terminal';

const manager = terminalManager;

// 1) run：一次性命令宏，跑完即回收，直接给 TerminalResult
const result = await manager.run({
  command: 'ls', args: ['-la'], cwd: '/path', timeoutMs: 30_000
});
// result.stdout / result.stderr / result.exitCode / result.truncated

// 2) createCommand：拿【未启动】的 CommandInstance —— 需增量输出 / 取消 / 后台长驻时用。
//    先挂监听，再自己 start。
const cmd = await manager.createCommand({ command: 'npm', args: ['run', 'dev'], cwd: '/proj', persistent: true });
cmd.on('stdout', chunk => { /* 增量 */ });
await cmd.start();

// 3) createTransport：拿【未启动】的 McpTransportInstance（始终 persistent）。
const transport = await manager.createTransport({ command: 'python', args: ['-m', 'mcp_server'], cwd: '/server' });
transport.on('message', (msg) => { /* JSON-RPC 行 */ });
await transport.start();
transport.send('{"jsonrpc":"2.0","method":"initialize"}');
```

## 常见变更

| 场景 | 修改 | 注意 |
|---|---|---|
| 新增/调整支持的 shell | 改 `platformConfigs.ts` 的 `PLATFORM_CONFIGS`；如需新 `ShellType` 同步 `types.ts` | `supportsPersistent` 决定该 shell 能否跑 mcp_transport |
| 调整池上限 / 空闲超时 | 改 `TerminalManager.ts` 的 `DEFAULT_POOL_CONFIG` | `cleanupIntervalMs` 与 `idleTimeoutMs` 保持对齐 |
| 改环境变量拼装 | 改 `environment.ts` 纯函数；`platformConfigs.getEnhancedEnvironment` 只做 pathSeparator 委托 | 逻辑集中在 `environment` |
| 改 shim 命令映射 / 落盘布局 | 改 `runtime/shim.ts`；node/npm/npx 落 `node-shims/` 子目录（引用 `../bun`），Python/uvx/bunx 落 root（引用 `uv`/`bun`）| root=`getBinDir()`、子目录=`getNodeShimsDir()`（`persist/lib/path.ts`）；新增 node 类 shim 要同步 `resolveShimScope` |
| 改哪些 shim 对 shell / MCP 可见 | 改 `BaseTerminalInstance.resolveShimScope`（唯一决策点），env 与 wrapper 自动同步 | shell（command）= root only；MCP = root + node-shims；勿在 env / wrapper 各写一份判断 |
| 改命令行构建 / 引号 / 包装脚本 | 改 `commandBuilder.ts` 纯函数，测试直接 import 该函数 | `BaseTerminalInstance.prepareCommand` 是唯一薄委托入口，勿在其中加逻辑 |
| 新增消费者 | `import { terminalManager }`，构 config（不带 `type`/`persistent`）| 一次性用 `run`；需增量/取消/后台用 `createCommand` 挂监听后自 start；MCP 通道用 `createTransport` |
| 改某类实例的输出解释 / 专属行为 | 改对应子类 `CommandInstance` / `McpTransportInstance`；共享生命周期改 `BaseTerminalInstance` | 用子类多态，勿在基类加 `if (type===...)` 分支 |

## 注意事项

- **模块级单例语义**：`terminalManager` 是模块加载即构造的全局 const（`export const terminalManager = new TerminalManager()`），无 lazy getter / 无 `static instance`。`dispose()` 只停定时器 + 停全部实例，不重建。测试隔离用 `new TerminalManager()`；mock 走 `vi.mock('../../terminal', ...)` 导出 `terminalManager`。
- **命令行构建是纯函数**：`parseCommandString` / `buildShellInvocation` / `createShellWrapper` / `createMissingCwdPrefix`
  都在 `commandBuilder.ts` 导出，单测直接 import 测（`__tests__/prepareCommand.test.ts`）。`BaseTerminalInstance` 只保留
  真正被 `start()` 调用的 `prepareCommand`，不再为测试保留转发方法。
- **Windows-ARM shim 绕过**：`McpTransportInstance.shouldBypassInternalNodeShims()` 判定 node/npm/npx 类命令时
  绕过内置 bun shim、改用系统 PATH（修 `sharp` win32-arm64 等原生依赖解析错误）。改 node 命令判定看这里。
- **shell 不换 node/npm，MCP 换**：`command` 型子进程 PATH 只含 root bin，`node`/`npm`/`npx` 落系统真二进制（避免在 LLM 背后把 node→bun、npm→bun 静默替换）；`mcp_transport` 额外前插 `node-shims/` 拿全套。此分叉在 `resolveShimScope`。python/pip 两 scope 都走 uv（真 CPython，低分歧）。
- **cwd 缺失不报错**：spawn 前 `stat(cwd)` 失败会静默回退 home + 切目录前缀，而非抛错。
- **超时兜底两段式**：`commandExecutor.runCommand` 超时先 SIGTERM，5s 后 SIGKILL；Windows shell 可能
  只发 exit 不发 close，故 `EXIT_FALLBACK_MS`（50ms）从 exit 兜底 settle。
- **输出截断**：`command` 输出超 `maxOutputLength`（默认 8000）截断并置 `truncated`。
- **`send()` / `execute()` 归属子类**：不再在基类留抛错桩。`execute()` 只在 `CommandInstance`，`send()` 只在 `McpTransportInstance`；`createCommand` / `createTransport` 返回具体类型，误用在**编译期**即挡。

## 相关模块

- 被依赖：[pi/tools](../../pi/tools/ai.prompt.md) —— `shell.ts`（LLM 可见名 `shell`）用 `createCommand`
  拿未启动实例挂 stdout/stderr/取消监听后自 start；`backgroundProcessManager` 用 `createCommand`（`persistent`）走后台持久实例。
- 被依赖：[mcpRuntime](../mcpRuntime/ai.prompt.md) —— `client/transport/StdioTransport.ts` 用
  `createTransport` 承载 MCP server 的 stdio 通道（挂 message/exit 监听后自 start）。
- 被依赖：`lib/runtime`（`systemProbe.ts` git 探测 / `venv.ts` uv venv 创建）、`lib/mcpRuntime`（`StdioTransport` MCP stdio 通道）、`pi/tools/shell.ts`、`lib/backgroundProcessManager`。
- 依赖：[lib/runtime](../runtime/) —— `RuntimeManager.ensureRuntimeForCommand`（lazy-install）
  与固定 Python 版本；`@main/persist/lib/path::getBinDir`（`{userData}/env/bin` 路径）、`getRuntimeBinDir`（`env/runtime-bin` 全局 CLI 入口）。
- 测试：`__tests__/`（`prepareCommand` / `platformConfigs` / `executeLifecycle` / `mcpRuntimeGate`）。

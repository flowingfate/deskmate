# Profile 运行时架构

<!-- Last verified: 2026-07-19 -->

Profile 是主进程中的独立运行时边界。每个已存在的 Profile 都可在同一进程中并行运行；UI 打开、关闭或切换其它 Profile，不会重新选址、停止或共享其已启动的工作。

## 核心对象

| 对象 | 位置 | 职责 |
|---|---|---|
| `ProfileRegistry` | `src/main/profileRegistry.ts` | 应用级唯一 registry：持有 `profiles.json` index、已加载 runtime Profile、并发加载 promise、删除 gate。 |
| `Profile` | `src/main/profile.ts` | 单 Profile 运行时聚合根：持有 store、Pi Agent cache、SubAgentManager、MCP、scheduler、Doctor 与 owner 主窗口。 |
| `ProfileStore` | `src/main/persist/profileStore.ts` | 单 Profile 的持久化对象图与 SQLite 生命周期；不持有跨 Profile runtime cache。 |
| 主窗口注册表 | `src/main/startup/wins.ts` | 应用级 `Map<profileId, BrowserWindow>`，保证一个 Profile 至多一个存活主窗口。 |

```text
ProfileRegistry
├── profiles.json index + defaultProfileId
└── Profile (per profileId)
    ├── ProfileStore
    ├── Pi Agent runtime cache
    ├── SubAgentManager (lazy)
    ├── MCPClientManager
    ├── SchedulerManager
    ├── DoctorManager
    └── owner BrowserWindow | null
```

## 生命周期

### 启动与加载

1. `ProfileRegistry.bootstrap()` 初始化 `profiles.json`；空或无效 index 会创建一个 guest Profile，并解析只读的 `defaultProfileId`。
2. registry 对 index 中全部 entry 并行调用 `getOrLoad()`；同一 ID 的并发调用复用同一个 loading promise，单个 Profile 失败只记录 warning，不阻断其它 Profile。
3. `ProfileStore.load(id)` 装载持久化子域并打开、校验或重建该 Profile 的 SQLite 索引。
4. `Profile.start()` 先 reconcile Agent，再启动 scheduler，随后初始化 MCP；MCP 初始化失败时停止已启动的 scheduler。

`defaultProfileId` 只是首次启动、无显式目标的新窗口及 headless eval 的默认候选。它不是运行时 selected state，不能用于定位已启动工作或既有窗口。

### 关闭与删除

`Profile.dispose()` 按固定顺序停止 scheduler → Doctor → Pi Agent runtime → MCP → `ProfileStore`/SQLite。进程退出由 `ProfileRegistry.shutdownAll()` 并行关闭已加载 Profile，并在 logger 关闭前等待，外层有 5 秒兜底。

删除必须通过 registry：删除期间该 ID 被标为 removing，`getOrLoad()` 与 `require()` 均拒绝访问；受控 UI 删除还必须重新确认目标不是 sender 当前 Profile、不是最后一个 Profile、且没有 owner 主窗口。runtime dispose、index 移除和数据目录删除依次完成。

## 主窗口与 IPC 路由

每个主 `BrowserWindow` 在创建时绑定不可变的 Profile ID：

```text
createMainWindow(profileId)
  → BrowserWindowMeta.profileId
  → webPreferences.additionalArguments: --deskmate-profile-id=<id>
  → preload 从 process.argv 同步暴露 window.electronAPI.profile.id
```

- 打开另一 Profile 等同于创建或聚焦该 ID 的窗口；不会切换既有窗口的 Profile。
- renderer 发起 profile-scoped IPC 时不传 `profileId`。main 从 `event.sender → BrowserWindow → BrowserWindowMeta.profileId → ProfileRegistry.require()` 解析 owner，禁止 renderer 伪造跨 Profile 请求。
- main 向 renderer 发送 profile runtime event 时，只使用该 `Profile` 的 owner window。没有 owner window 时不向其它 Profile fallback。
- 关闭 owner window 只解除 UI 绑定；该 Profile 的 scheduler、MCP 和已启动任务继续运行。Doctor task 与 MCP OAuth prompt 需要窗口交互，owner window 真正销毁时分别取消，不能转发到其它窗口。
- macOS 仅最后一个主窗口 close 时隐藏窗口以保持应用驻留；关闭仍有其它主窗口的 Profile window 会真实销毁，因此可进入删除流程。

## 所有权与隔离规则

1. **启动即绑定。** chat、Pi session、subrun、MCP call、schedule run 与 OAuth flow 都使用启动时持有的 Profile；后续不得读取默认或 UI selection。
2. **Profile-scoped state 必须带 identity。** 不得以裸 `agentId`、`sessionId`、`subrunId` 或 `serverName` 作为跨 Profile runtime map key。
3. **服务按 Profile 实例化。** MCP clients/locks/runtime state/token cache、scheduler timers/catch-up、Pi Agent cache、Doctor task 都不得以全局单例承载 Profile 状态。
4. **资源全局限流不改变所有权。** 可为 LLM、网络或 child process 设应用级并发上限；各 Profile 的任务登记、状态机、timer 与持久化仍归自身 runtime。
5. **工具链传递 owner。** `ToolContext.profile` 是工具执行所需 runtime service 的来源；`profileId` 仅用于 trace、URI 或仅接收 ID 的下游接口，工具不得反查默认 Profile。
6. **持久化源真值不变。** 运行时所有权不改变 `AGENT.md`、`data.json`、`messages.jsonl`、`jobs.json` 与 SQLite 可重建的事实来源。

## 修改指引

- 新增 profile-bound runtime service：由 `Profile` 构造或 lazy 创建，并纳入 `dispose()`；不要新增应用级 singleton。
- 新增 renderer IPC：主窗口请求使用 `requireProfileForSender(event)`；只有 profile 管理、打开指定窗口等天然跨 Profile 操作才显式接收目标 ID。
- 新增 main → renderer event：先从 runtime `Profile` 取得 owner window，再绑定该 `webContents` 发送；无 owner 时明确 no-op、等待或取消策略。
- 修改持久化实体或 index：同时阅读 [persist.md](persist.md) 与 [persist 模块文档](../src/main/persist/ai.prompt.md)。
- 修改 MCP、scheduler、Pi 或 subagent 的 Profile 路由：同时阅读相应模块 `ai.prompt.md` 与 [data-flow.md](data-flow.md)。

## 相关文档

- [主进程架构](arch-main.md)
- [渲染进程的窗口 identity 约定](arch-render.md#3-进程边界与-ipc)
- [持久化架构](persist.md)
- [IPC 数据流](data-flow.md)

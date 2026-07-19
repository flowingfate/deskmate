<!-- Last verified: 2026-07-19 (persist runtime storage overview IPC) -->
# IPC 框架（`src/shared/ipc/`）

> 基于 TypeScript 泛型 + Proxy 的框架，从单一共享定义文件出发，在 Electron 的三个层（main / preload / renderer）之间强制实现类型安全、编译期检查的 IPC。

## 为什么需要这个框架

Electron 原生 IPC 是弱类型且基于字符串的。在此框架之前，代码库存在以下问题：

1. **拼写错误的通道名称无法检测** — `ipcRenderer.invoke('screenshot:caputre')` 仅在运行时才会失败。
2. **无参数类型约束** — 调用方和处理方的签名各自漂移。
3. **丢失返回类型** — `invoke` 返回 `Promise<any>`。
4. **Preload 白名单与接口定义脱节** — 遗漏条目导致静默的运行时失败。
5. **分散的类型定义** — preload、main 和 renderer 各自声明自己的副本。

框架的核心原则：**在 `shared/ipc/` 中定义一次，自动对齐三层（main / preload / renderer）的类型**。

## 架构

### 两个核心连接器（均在 `base.ts` 中）

| 连接器 | 方向 | 模式 |
|--------|------|------|
| `connectRenderToMain<RM>(prefix?)` | Renderer → Main | invoke / handle |
| `connectMainToRender<MR>(prefix?)` | Main → Renderer | send / on |

**`connectRenderToMain<RM>(prefix?)`**：
- `bindMain(ipcMain)` — 返回一个 Proxy，在首次访问时惰性调用 `ipcMain.handle('{prefix}:{method}', fn)`；自动移除之前的处理器以防止重复注册。
- `bindRender(invokeFn)` — 返回一个 Proxy，在前面添加 `{prefix}:` 并调用 `invokeFn(channel, ...args)`。
- `provideInvokeForPreload(ipcRenderer, whitelist[])` — 为 preload 脚本创建通道过滤的 invoke 函数。使用条件类型：如果 `RM` 中的任何键从数组中缺失，TypeScript 会发出编译错误（`"Missing key, you should provide all keys"`）。

**`connectMainToRender<MR>(prefix?)`**：
- `bindWebContents(wc)` — 返回按 `WebContents` 的 send Proxy；通过 `WeakMap<WebContents>` 缓存，因此同一窗口始终获得相同的 proxy。
- `bindRender(on, off)` — 返回一个 Proxy，注册 `ipcRenderer.on(channel, fn)` 并返回取消订阅函数。

### 通道格式
`{prefix}:{methodName}` — 例如 `screenshot:saveToFile`。不带前缀时，通道等于 `methodName`。

### 数据流
```
src/shared/ipc/screenshot.ts                ← 唯一真实来源
         │
         ├─→ Main:     renderToMain.bindMain(ipcMain)            → 类型安全的 handle 对象
         ├─→ Preload:  renderToMain.provideInvokeForPreload(ipc) → 白名单验证的 invoke
         └─→ Renderer: renderToMain.bindRender(invoke)           → 类型安全的 API 对象
```

## 标准用法（Renderer → Main）

一个完整的契约跨越四个文件。以下是实际的 `screenshot` 通道端到端连接（参见 `src/shared/ipc/screenshot.ts`、`src/main/lib/screenshot/ScreenshotIPC.ts`、`src/preload/screenshot/invoke.ts`、`src/renderer/ipc/screenshot-overlay.ts` 中的真实代码）。

### 1. 定义契约 — `src/shared/ipc/<name>.ts`

这是唯一真实来源。每个方法声明其 `call` 元组和 `return` 类型；框架从中派生 main/preload/renderer 的类型。

```typescript
import { connectRenderToMain } from './base';

type RenderToMain = {
  capture: {
    call: [callback?: boolean];
    return: CaptureResult;
  };
  saveToFile: {
    call: [displayId: number, rect: SelectionRect, imageData?: Buffer];
    return: SaveToFileResult;
  };
  // ...其他方法
};

export const renderToMain = connectRenderToMain<RenderToMain>('screenshot');
```

### 2. 在 main 中注册处理器 — 例如 `ScreenshotIPC.ts`

`bindMain(ipcMain)` 返回一个 Proxy，其属性名是契约方法名。每次调用注册 `ipcMain.handle('screenshot:<method>', fn)`。`_event, ...args` 的参数类型从契约推断 — 无需手动标注。

```typescript
import { renderToMain } from '@shared/ipc/screenshot';
const handle = renderToMain.bindMain(ipcMain);

handle.capture(async (_event, callback = true) => {
  return screenshotManager.capture(callback);
});

handle.saveToFile(async (_event, displayId, rect, imageData) => {
  return screenshotManager.saveToFile(displayId, rect, imageData);
});
```

### 3. 在 preload 中暴露给 renderer — `src/preload/<name>/invoke.ts`

`provideInvokeForPreload` 构建一个通道过滤的 invoke 函数。白名单数组是类型检查的：**契约中的每个键必须出现**，否则 TS 报告 `"Missing key, you should provide all keys"`。额外/过时的键不会被捕获。

```typescript
import { ipcRenderer, contextBridge } from 'electron';
import { renderToMain } from '@shared/ipc/screenshot';

const invoke = renderToMain.provideInvokeForPreload(ipcRenderer, ['capture', 'saveToFile']);

contextBridge.exposeInMainWorld('electronAPI', {
  screenshot: { invoke },
});
```

preload 入口点（`src/preload/main.ts` 或专用的 overlay preload）然后暴露此 invoke 函数，例如通过 `contextBridge.exposeInMainWorld('electronScreenshot', { invoke })` 或作为统一 `electronAPI` 对象的属性（`screenshot: { invoke }`）。

### 4. 从 renderer 调用 — `src/renderer/ipc/<name>*.ts`

`bindRender` 接受任何具有 `(channel, ...args) => Promise<any>` 签名的函数并返回类型化的 proxy。方法名、参数和返回类型都来自共享契约。

```typescript
import { renderToMain } from '@shared/ipc/screenshot';

// 在统一的 electronAPI 下暴露：
export const screenshotApi = renderToMain.bindRender(window.electronAPI.screenshot.invoke);

// 使用 — 完全类型化
const result = await screenshotApi.saveToFile(displayId, rect, imageData);
```

## 标准用法（Main → Renderer）

对于推送式事件，使用 `connectMainToRender<MR>(prefix?)`（参见 `agentChat.ts` 的实际示例）。

- Main：`mainToRender.bindWebContents(wc).<event>(payload)` — 发送到单个窗口。没有广播辅助函数；如果多个窗口需要该事件，请遍历活跃的 `WebContents`。
- Renderer：`mainToRender.bindRender(on, off).<event>(handler)` — 注册监听器并返回其取消订阅函数。
- Preload：入站方向不需要白名单；只需在桥接上暴露围绕 `ipcRenderer.on` / `ipcRenderer.off` 的 `on` / `off` 包装器。
- Profile-scoped runtime event 必须先由 main 按 owning Profile 选取单个 `WebContents`；payload 不重复携带 `profileId`，renderer 不做 Profile filter。

## 添加新契约

在 `src/shared/ipc/` 下创建新文件，使用唯一前缀字符串实例化 `connectRenderToMain`（和/或 `connectMainToRender`），然后遵循上述四步模式。每个新契约需要自己的 preload `invoke.ts` 和 main 进程 `*IPC.ts` 注册器。

`subagentRun` 是双向范例：renderer query / cancel parent 不传 `profileId`，main 从 `event.sender` 解析 owner 后再定位 parent；main 已按 owner window 推送 live `stateUpdate`，renderer 只用 parent identity 与 correlation 关联状态。messages 仅以 owner parent identity 返回 Domain `Message[]`，不暴露磁盘路径。

所有由 profile-bound 主窗口 renderer 发起的 profile-scoped IPC 都遵守同一规则：shared contract 省略 `profileId`，main 通过 `requireProfileForSender(event)` 从 `event.sender → BrowserWindowMeta.profileId` 获取 owner。只有打开指定 Profile 新窗口等天然跨 Profile 操作才显式传 ID；ToolContext / scheduler 等 main 内路径继续持有自己的 Profile identity。

`window:openProfile(profileId)` 是例外中的显式跨 Profile 产品操作：它只接受目标 Profile ID，main 按 Profile 合并进行中的打开请求，最终创建或聚焦唯一 owner 主窗口；其余窗口 IPC 一律由 sender 选址。

`profiles:list()` / `profiles:createAndOpen({ displayName })` / `profiles:listManaged()` / `profiles:updateMetadata()` / `profiles:delete()` 是受控跨 Profile 产品操作。`listManaged` 返回由 main 计算的 deletion eligibility；删除 handler 必须从 sender owner 重新检查 current/open/last，随后将目标 Profile 标记为 removing，阻止并发 `getOrLoad` / `createMainWindow`，再 stop、flush、移除 index 与目录。`updateMetadata` 仅更新 index displayName，不改变 runtime identity。它们不得用于任何 profile-bound 业务数据读写。

## 注意事项
- ⚠️ 由于 `if (!main_handle)` 守卫，`bindMain` 跨调用复用单个 proxy 实例。在 `main.ts` 中每个 `ipcMain` 调用一次；在开发环境热重载后调用可能静默复用过时的 proxy。开发时需重启主进程。
- ⚠️ `connectMainToRender` 中的 `WeakMap<WebContents>` 缓存意味着已销毁的 `WebContents`（关闭的窗口）会被自动垃圾回收 — 无需手动清理。
- ⚠️ `provideInvokeForPreload` 中的编译期白名单检查仅捕获**缺失**的键，不捕获**多余**的。白名单中的过时条目不会导致错误，但允许 preload 调用未定义的方法。
- ⚠️ 所有**业务** IPC 通道必须使用此框架，禁止使用原始 `ipcMain.handle()` 字符串通道。
- ⚠️ **例外：`log:write`** 是 renderer → main 的高频单向 `ipcRenderer.send`（每条 renderer 日志一次），故意不走 invoke/handle 框架避免 await round-trip 开销。handler 注册在 `setUpAllIPCHandlers` 最早一句，main 端强行覆写 `processType='renderer'` 与 `windowId=sender.id`，防止 renderer 伪造进程来源。日志读取侧（dev-only Log Viewer）走标准 `logViewer` 命名空间。
- ⚠️ **主链路 trace 透传**：`agentChat` 命名空间的 `streamMessage / retryChat / editUserMessage / cancelChatSession` 末尾追加可选 `trace?: TraceContext`（来自 `@shared/log/trace`，shape `{ tid, sid, psid?, startAt }`）。renderer `Tracer.startWithSpan().bind({mod:'chat.send',...})` 起 chat.send tracer 后 `tracer.serialize()` 透传；main 端 IPC handler `Tracer.deserialize(trace).derive().bind({mod:'chat.ipc',...})` 重建上游 sid 链，下游 chat.turn / chat.llm / chat.tool 的 derive 自动接上 psid。缺省时 main 端 `Tracer.start().derive()` 兜底新起。tail-optional 形参向后兼容老 renderer。

## 联动变更映射
| 当你修改 | 同时检查/更新 |
|----------|-------------|
| `src/shared/ipc/*.ts` 中的任何类型 | 对应的 `src/preload/*` 白名单、对应的 `src/main/startup/ipc/` 处理器 |
| `base.ts` 框架 | 所有从 `base.ts` 导入的文件 — 运行 `npm run check:impact -- src/shared/ipc/base.ts` |
| 添加新的 IPC 契约文件 | 还必须创建 preload invoke 入口和 main 端处理器文件 |
| 添加新的窗口级 IPC（如 `research`） | 同时更新 `src/preload/main.ts` 的 `ElectronAPI`、`electronAPI` 对象、renderer `ipc/<name>.ts` 绑定，以及 `electron.vite.config.ts` 中需要的新 renderer entry |

## 反模式
- 不要使用原始 `ipcMain.handle()` — 使用 `base.ts` 中的 `connectRenderToMain<T>()`。
- 不要忘记 preload 白名单 — 没有 preload 条目的通道在 renderer 中静默失败。
- 不要对两个不同的契约文件使用相同的前缀字符串 — 前缀必须唯一。

## 验证步骤
1. `npm run build` — TypeScript 捕获 IPC 契约中的类型不匹配。
2. `npm run check:impact -- <changed-files>` — 查找受影响的模块。

## 相关模块
- 被使用于：所有跨进程通信的 main 和 renderer 模块，共 30+ 个命名空间已全部类型化。
- 基础被消费于：`src/preload/main.ts`、`src/preload/screenshot.ts`、`src/main/startup/ipc/` 下的 handler 文件。
- 另请参阅：[data-flow.md](../../../ai.prompt/data-flow.md) 了解更广泛的 IPC 和聊天消息数据流上下文。

<!-- Last verified: 2026-07-07 -->
# 后台进程管理器

> 用于异步后台进程执行的单例生命周期封装器。封装 TerminalManager 以实现非阻塞命令执行，支持输出捕获和会话管理。
>
> ⚠️ **当前无活的 LLM 消费者**(Phase 8a):`manage_process` 工具已下线,
> `shell` 工具的 `background` 分支一并删除 —— LLM 跑后台任务直接走 shell 原生
> `nohup ... &` + `kill`/`ps`/`tail`。本模块保留 class 本体不动,等到有非工具
> 路径(IPC / dev tooling)需要时再 re-wire;`buildCommandLine` / `quoteArg` 仍
> 被 `executeCommand.ts` 用,所以整目录不能直接删。

## 关键文件
| 文件 | 职责 | 规模 |
|------|------|------|
| `BackgroundProcessManager.ts` | 单例管理器：生成、轮询、日志、终止、列出会话 | ~200 LOC |
| `types.ts` | 会话、结果和选项的类型定义 | ~70 LOC |
| `index.ts` | 模块重导出 | ~10 LOC |

## 架构

### 设计决策
- **薄封装层**：不重新发明进程管理。进程生成/管理全部委托 `TerminalManager.createCommand`（`persistent: true`）。
- **环形缓冲区输出**：每个会话最多存储 1000 行（每行最多 500 字符）。缓冲区满时淘汰最旧的行。
- **按行存储**：输出按换行符分割并作为独立行存储，而非原始字符块。这使得通过 offset/limit 进行高效分页成为可能。
- **自动清理**：进程退出后会话数据保留 5 分钟，然后被垃圾回收。清理定时器使用 `.unref()` 以不阻塞进程退出。

### 会话生命周期
```
spawn() → running → (exit event) → exited/error → (5 min) → garbage collected
                         ↓
                      kill() → exited (forced)
```

### 会话 ID 格式
`bg_${Date.now()}_${random6chars}` — 例如 `bg_1712134567890_a1b2c3`

### 输出处理
- stdout 行按原样存储
- stderr 行添加 `[stderr] ` 前缀
- 错误事件记录为 `[error] ${message}`

## 常见修改
| 场景 | 需修改的文件 | 备注 |
|------|-------------|------|
| 增加环形缓冲区大小 | `BackgroundProcessManager.ts`（`MAX_OUTPUT_LINES`） | 当前为 1000 行 |
| 更改清理延迟 | `BackgroundProcessManager.ts`（`SESSION_CLEANUP_DELAY_MS`） | 当前为 5 分钟 |
| 添加新的会话元数据 | `types.ts`（`BackgroundSessionData`）+ `BackgroundProcessManager.ts` | 更新 spawn() 和 list() |
| 向 LLM 重新暴露后台进程能力 | 走 `appcmd/builtins/<domain>/` 加一个新子命令(参照 `mcp/` 模板),把 `getBackgroundProcessManager()` 封进 kernel —— 不要复活老 `manage_process` LocalTool wrapper |

## 注意事项
- ✅ **构造与启动已分离**：`terminalManager.createCommand()` 只造实例入池、**不启动**。`spawn()` 先 `setupOutputListeners` 挂 stdout/stderr/exit 监听，**再** `await instance.start()` —— 保证 spawn 前监听就位，首帧输出不丢，且只启动一次（旧版 `createInstance(persistent)` 自动启动 + 再手动 start 的双重启动已消除）。
- ⚠️ 会话清理定时器使用 `.unref()` — 如果需要保证清理执行，考虑使用显式的 dispose 逻辑。
- ⚠️ 环形缓冲区淘汰策略为 FIFO。如果进程产生输出的速度快于 LLM 读取速度，旧行会丢失。
- ⚠️ `poll()` 在会话未找到时返回 `status: 'error'`（`durationMs: 0`）— 调用方应检查此情况。

## 相关模块
- 依赖：[TerminalManager](../terminal/)、[日志系统](../../log/)
- 被依赖:[shell tool (执行端)](../../pi/tools/executeCommand.ts) 只用 `buildCommandLine` / `quoteArg`(不再走 spawn 路径)

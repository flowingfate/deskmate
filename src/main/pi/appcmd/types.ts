/**
 * `AppCommand` 契约 —— 应用内能力的"shell 命令"形态。
 *
 * 设计文档:`ai.prompt/tool-system.md`(总体设计 + 落地路径)。LLM 通过
 * 单个 `app` LocalTool 调用字符串 cmdline,宿主解析 argv 后路由到对应的
 * `AppCommand`。每个命令自带 synopsis(进 `app` 工具描述)、help(按需
 * 返回)、run(执行)。
 *
 * 与 LocalTool 的关系:
 *   - LocalTool 是"喂给 LLM 的工具"维度;AppCommand 是"应用能力"维度。
 *   - 一个 `app` LocalTool 路由到 N 个 AppCommand,LLM 视角下永远只是
 *     一个工具,认知边界只随 synopsis 行数线性增长。
 *
 * 与 MCP 的关系(Phase 4):
 *   - 未来 MCP server 也作为 AppCommand 自动注册,server 名 = 命令名。
 *   - 现阶段无关,此契约不为 MCP 留 hook,避免过早抽象。
 */

import type { Tracer } from '@shared/log/trace';
import type { ChunkStream } from '@shared/types/streamingTypes';
import type { SubAgentConfig } from '@shared/persist/types'
import type { WebContents } from 'electron';

/**
 * `AppCommand.run` 收到的执行上下文。
 *
 * 设计:`ToolContext` 的**精确子集 + spawn 专属可选字段** + stdio helpers。
 *   - 主体子集是"AppCommand 普遍可能用到"的字段:profile/agent/session
 *     id、cancel signal、tracer、event sender、chunk stream、callId。
 *     `catalog` 仍然不暴露 —— per-turn 工具目录是 spawn 链路用,不是
 *     AppCommand 业务用。
 *   - **spawn 专属可选字段**(`isSubAgent` / `getSubAgentConfig` /
 *     `getParentContextSummary`)只服务 `subagent` 域:递归保护 + 解析
 *     当前 agent 可用 sub-agent 列表 + 取父上下文摘要。其它 AppCommand
 *     一律忽略;`subagent` 域缺失这些字段会显式抛错(与老 LocalTool
 *     `spawn_subagent` 同纪律)—— 不允许静默 no-op。
 *   - stdio helpers(`print` / `printErr` / `setExitCode`)让 run 实现像
 *     写 Node CLI 一样:不返回结构化对象,而是"往 stdout/stderr 写,设个
 *     exit code"。dispatcher 收集后合成 `ToolResult`。
 *
 * **不变量**:run 实现**不允许**回读任何全局 / 静态字段获取"当前执行
 * 上下文",一律走 `ctx` 参数 —— 与 ToolContext 同纪律。
 */
export interface AppCmdContext {
  // ---- 透传字段(与 ToolContext 同义,handler 可直接用) ----
  profileId: string;
  agentId: string;
  sessionId: string;
  signal: AbortSignal;
  tracer: Tracer;
  eventSender: WebContents | null;
  chunkStream: ChunkStream | null;
  /** 当前 toolCall.id,与 ToolContext.callId 同义 —— 给需要 correlationId 的命令用。 */
  callId: string;

  // ---- spawn 专属字段(仅 `subagent` 域消费,其它域忽略) ----

  /**
   * sub-agent 链路标记。`subagent` 命令用它做递归保护:`true` 时拒绝
   * spawn(返回 exit 1)。其它 AppCommand 一律忽略 —— 是否允许 sub-agent
   * 调用本命令由 toolCatalog 决定,不在命令内部判断。
   */
  isSubAgent: boolean;

  /**
   * 按 name 取当前 agent 已注册的 sub-agent 配置。仅 `subagent` 域消费;
   * 该域缺席即抛错。其它命令永远不应读这个字段。
   */
  getSubAgentConfig?: (name: string) => Promise<SubAgentConfig | undefined>;

  /**
   * 取父 chat 的上下文摘要,供 sub-agent 启动期注入。仅 `subagent` 域消费;
   * 该域缺席即抛错。其它命令永远不应读这个字段。
   */
  getParentContextSummary?: () => Promise<string>;

  // ---- stdio helpers(dispatcher 提供,run 实现按需调用) ----

  /**
   * 累积到 stdout buffer。允许多次调用,顺序保留。
   * 不自动追加换行 —— 跟 Node `process.stdout.write` 一样,需要换行自己加。
   */
  print(text: string): void;

  /**
   * 累积到 stderr buffer。语义同 `print`。
   * dispatcher 在合成最终 content 时,stderr 非空才会拼进去。
   */
  printErr(text: string): void;

  /**
   * 设置 exit code。默认 0。
   * 任何非 0 值都会被合成进最终 content(`(exit <code>)`),LLM 据此判断
   * 命令是否成功 —— 跟 shell 完全一致的心智模型。
   */
  setExitCode(code: number): void;

  /**
   * 登记本次命令产出 / 修改的用户可见文件 URI(如 `web download` 落盘的
   * `local://...`)。dispatcher 收集后挂到 `AppCmdInternalResult.deliverables`,
   * 经 facade → `ToolResult.deliverables` 回流给 sub-agent 审计 —— 与 stdio
   * 同纪律,run 实现"像写 CLI 一样"显式登记产出,不靠下游解析输出反推。
   * 产出型命令(download 等)调用;只读命令一律不调。
   */
  addDeliverable(uri: string): void;
}

/**
 * 单个应用内能力的可执行单元。
 *
 * 三段强制:
 *   - `name`:命令名(无空格,与 shell 命令同形;`-` 允许,`_` 也允许但不推荐
 *     —— 与 npm/git/docker 等惯例对齐用 `-`)。
 *   - `synopsis`:一行 ≤ 80 字符,LLM **始终**看得到(`app` 工具描述里列)。
 *   - `help`:多行 man 风格,LLM 调 `app("<name> --help")` 时返回。每个字
 *     都是 prompt token,要被当 prompt 写,不是文档。
 *
 * run 契约:
 *   - 通过 stdio helpers 输出,不返回字符串。
 *   - 不需要包 try/catch:dispatcher 在外层捕获,转成 `printErr` + exit 1。
 *   - **必须**透传 `ctx.signal` 给底层 I/O,漏传会让取消挂起整个上游超时。
 */
export interface AppCommand {
  readonly name: string;
  readonly synopsis: string;
  readonly help: string;
  run(argv: readonly string[], ctx: AppCmdContext): Promise<void>;
  /**
   * 可选:当本命令被 `makeCommandFacade` 包成**顶层 LocalTool** 时,
   * 用来生成该工具的 `spec.description`。
   *
   * 缺省(成员 / leaf 命令)时,facade 用 `synopsis` 合成一段简短描述。
   * **router 形态**(由 `makeRouterCommand` 生成,即 `app` / `web` 顶层工具)覆写
   * 它,把所路由注册表里全部成员命令的 synopsis **内嵌**进描述 —— 这是渐进披露
   * 的"命令索引"。被路由的成员命令(mcp / search / ...)不实现,自然走默认。
   */
  toolDescription?(): string;
}

/**
 * dispatcher 在 run 结束后合成的内部结果形态。
 * **不导出给 AppCommand 实现** —— 它们只接触 stdio helpers。
 *
 * 拿到这个对象的只有 dispatcher 自己,用于按"stdout / stderr / exit"
 * 顺序拼最终给 LLM 的 string。
 */
export interface AppCmdInternalResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  /** run 期间通过 `ctx.addDeliverable` 登记的产出文件 URI(去重,登记顺序)。 */
  deliverables: string[];
}

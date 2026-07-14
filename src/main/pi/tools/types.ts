/**
 * Local tool runtime contract.
 *
 * 设计目标:让本地工具以 pi-ai 原生形态(`pi.Tool` + handler)直接落地,
 * 不再绕道伪 MCP 适配层。两个最小 invariant:
 *
 * 1. `LocalTool.spec` 就是 pi-ai 的 `Tool<TParams>`,可直接喂给
 *    `pi.streamSimple({ tools })`。`parameters` 用 `jsonSchema(...)` 包
 *    的裸 JSON Schema(见 `tools/schema.ts`,解释 ESM/CJS 约束);args
 *    interface 显式声明并在 handler 入口一次性 cast,把"运行期由 pi-ai
 *    `validateToolCall` 校验"与"开发期由 TS interface 编辑"的边界画清楚。
 *
 * 2. handler 通过 `ToolContext` 显式拿执行上下文。**禁止**从任何全局 / 静态
 *    字段反向读 profileId / sessionId / signal —— pi 层把 ctx 喂进来,handler
 *    一律走这条路径。
 */

import type { Static, Tool as PiTool, TSchema } from '@earendil-works/pi-ai';
import type { ToolResultImage } from '@shared/persist/types'
import type { Tracer } from '@shared/log/trace';
import type { SubAgentConfig } from '@shared/persist/types'
import type { WebContents } from 'electron';

import type { ToolCatalog } from '../toolCatalog';

/**
 * Tool 结果。成功时 `content` 是 LLM 可见的字符串(与 MCP tool result 等价
 * 的形态),失败时 `error` 给出可读原因(registry 在 handler throw 时收敛
 * 成这一态)。
 *
 * - `images`:工具回传的图片(如 `read` 一个图片文件)。仅 local 工具产出。
 * - `deliverables`:本次调用产出 / 修改的用户可见文件 URI(如 `web download`
 *   存盘的 `local://...`)。供 sub-agent 的 deliverable 审计**结构化**回收 ——
 *   与 `images` 同样的回流线路(execute → ToolCallResult → session hook),
 *   避免下游靠解析 cmdline / 输出文本反推产出。普通 LocalTool 不产出时省略。
 */
export type ToolResult =
  | { ok: true; content: string; images?: ToolResultImage[]; deliverables?: readonly string[] }
  | { ok: false; error: string };

/**
 * 单次工具执行的上下文。所有依赖**显式**作为参数传入。
 *
 * 字段语义:
 * - `signal`:caller(turn loop)对取消的唯一表达,handler 必须把它一路传到
 *   底层 fetch / spawn / page。
 * - `eventSender`:可空(JobRun / 测试路径)。human-loop 工具在 null 时退化
 *   为"用户拒绝"等价语义。
 * - `tracer`:caller 已 derive 出 `chat.tool` span 后注入。handler 内部
 *   嵌套 LLM / sub-agent 应进一步 derive,保持 trace 树连贯。
 * - `catalog`:per-turn 构建的 ToolCatalog。**当前没有 LocalTool 实际消费**
 *   它(spawn 类工具走 `getSubAgentConfig` + SubAgentChat 自建 sub-agent
 *   catalog;其它工具无需"本轮还有哪些工具可用"信息)。caller 仍注入它
 *   作为扩展点:如未来加入"看到当前 LLM 工具集再做路由"的工具,字段已就位。
 * - `getParentContextSummary` / `getSubAgentConfig`:**仅 sub-agent 派生类
 *   入口消费**(今天是 `app subagent spawn` / `spawn-many` 经 AppCmdContext
 *   透传过去的 `subagent` 命令)。缺席时这些命令必须显式抛错 —— 不允许
 *   静默 no-op 误导用户。
 */
export interface ToolContext {
  profileId: string;
  agentId: string;
  sessionId: string;
  signal: AbortSignal;
  eventSender: WebContents | null;
  tracer: Tracer;
  /** sub-agent 链路标记。用于 spawn 类工具的递归保护。 */
  isSubAgent: boolean;
  /**
   * 当前 toolCall.id 的快照,供 spawn 类工具传给 SubAgentManager 做
   * correlationId 关联(让 renderer 端的 sub-agent 状态卡片能精确对应到
   * 父 tool call)。caller 必须填,不允许 undefined,缺失等价"对应不上 UI"。
   */
  callId: string;
  /**
   * 主链路推流口子。RegularSession 注入 `activeStream`,JobRun / 测试路径 = null。
   *
   * 用途专一:**部分 tool_result 流式输出** —— `shell` 在命令真正退出前可
   * 以先把当前 stdout/stderr 片段、device-auth code 之类
   * 中间态推回 UI,避免 30s+ 的命令期间 UI 没反馈。完成态由 turn loop 在
   * tool 返回后统一推 `tool_result`,partial 与 final 共享同一 `toolCallId`。
   *
   * `null` 等价"无可推流端",工具内部统一以 `if (!ctx.chunkStream) return`
   * 早返保护(scheduler 静默跑时即此路径)。
   */
  chunkStream: import('@shared/types/streamingTypes').ChunkStream | null;
  /** 由 pi 层 turn loop 注入的 per-turn 工具目录,供 spawn 类工具消费。 */
  catalog?: ToolCatalog;
  /** sub-agent 专用:取父 chat 的上下文摘要。其它工具忽略。 */
  getParentContextSummary?: () => Promise<string>;
  /** sub-agent 专用:按 name 取当前 agent 已注册的 sub-agent 配置。 */
  getSubAgentConfig?: (name: string) => Promise<SubAgentConfig | undefined>;
}

/**
 * 单个本地工具的最小可执行单元。spec 即 pi-ai `Tool<TParams>`,可直接喂给
 * `streamSimple`;handler 拿到 typebox 推断后的强类型 args 与显式 ctx。
 *
 * 泛型默认 `TSchema` 让 registry 能持有异构工具集合而无需 erase;具体
 * 工具应当填上自己的 `typeof Params` 让 handler args 强类型化。
 */
export interface LocalTool<TParams extends TSchema = TSchema> {
  readonly spec: PiTool<TParams>;
  handler(args: Static<TParams>, ctx: ToolContext): Promise<ToolResult>;
}

/**
 * `lazy(spec, loader)` 用到的 thunk 类型。spec 模块加载期就有
 * (供 LLM 看到 + registry 列表),实际 handler 在首次执行时 `await loader()`
 * 动态拿到 —— 重依赖(playwright / mammoth / pdfreader)不进主 bundle。
 */
export type LazyHandlerLoader<TParams extends TSchema = TSchema> = () => Promise<
  (args: Static<TParams>, ctx: ToolContext) => Promise<ToolResult>
>;

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
import type { WebContents } from 'electron';

import type { ToolCatalog } from '../tool';

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

/** 普通 Agent 在自己的 session 中执行。 */
export interface AgentExecution {
  mode: 'agent';
  /** 当前 session 所属的 Agent。普通模式下也是执行 Agent。 */
  agentId: string;
}

/** 父 Agent 把自己的 session 委派给另一个普通 Agent 执行。 */
export interface DelegateExecution {
  mode: 'delegate';
  /** 当前 session 所属的父 Agent。 */
  agentId: string;
  /** 实际执行当前任务的 Agent。 */
  delegateId: string;
}

export type ExecutionIdentity = AgentExecution | DelegateExecution;

/** 返回当前真正执行模型、Knowledge、Skills 与工具配置的 Agent ID。 */
export function executorId(identity: ExecutionIdentity): string {
  return identity.mode === 'delegate' ? identity.delegateId : identity.agentId;
}

/** 单次工具执行的公共上下文。所有依赖均由 caller 显式注入。 */
interface ToolContextBase {
  profileId: string;
  sessionId: string;
  signal: AbortSignal;
  eventSender: WebContents | null;
  tracer: Tracer;
  /** 当前 toolCall.id，供运行状态和父消息关联。 */
  callId: string;
  /** RegularSession 注入推流对象；JobRun / 测试路径为 null。 */
  chunkStream: import('@shared/types/streamingTypes').ChunkStream | null;
  /** 由 pi 层 turn loop 注入的 per-turn 工具目录。 */
  catalog?: ToolCatalog;
  /** 新 `subagent run --with-parent-summary` 按需读取父会话摘要。 */
  getParentContextSummary?: () => Promise<string>;
}
export interface AgentToolContext extends ToolContextBase, AgentExecution {}

export interface DelegateToolContext extends ToolContextBase, DelegateExecution {}

export type ToolContext = AgentToolContext | DelegateToolContext;

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

/**
 * Internal URL routing 契约。
 *
 * Internal URL(`skill://` / `agent://` / `local://` / 等)由 `read` / `write` 等
 * 工具通过 {@link InternalUrlRouter} 解析,屏蔽底层目录布局(profileId / agentId
 * / userData 路径)对 LLM 的暴露。设计纪律见 `ai.prompt/tool-system.md` §11(本
 * 文档的下一次刷新会加入 "Internal URL Router" 章节)。
 *
 * 两条核心 invariant:
 * 1. **scheme 表能力,不表存储位置** —— `skill://foo` 在 LLM 视角是"找名为 foo 的
 *    skill",handler 负责把它映射到 `${userData}/profiles/{pid}/skills/foo/SKILL.md`。
 *    Profile / Agent 路径**绝不**出现在 LLM 看到的字符串中。
 * 2. **handler 不持状态** —— 所有 per-session / per-profile 状态由 caller 通过
 *    {@link ResolveContext} 注入。handler 实例进程级单例,跟 `ToolContext` 不耦合。
 */
import type { ToolContext } from '../tools/types';

/**
 * Handler 返回给 router 的原始资源 payload。`immutable` 由 router 从
 * {@link ProtocolHandler.immutable} 统一回填,handler 不必自己 set。
 */
export interface InternalResource {
  /** 规范化的 URL 字符串(handler 解析后回填,用于日志/UI 显示)。 */
  readonly url: string;
  /** 解析后的文本内容。 */
  readonly content: string;
  /**
   * MIME 类型 —— 只用三类:
   * - `text/markdown` —— skill/agent markdown
   * - `application/json` —— 结构化数据
   * - `text/plain` —— 其它
   */
  readonly contentType: 'text/markdown' | 'application/json' | 'text/plain';
  /** 内容字节大小;handler 一般填 `Buffer.byteLength(content)`。 */
  readonly size?: number;
  /**
   * 底层 fs 路径,**仅供日志 / debugging** —— 绝不进 LLM 可见输出。
   */
  readonly sourcePath?: string;
  /** 关于解析过程的额外说明(降级路径、缓存命中等),append 进 UI footer。 */
  readonly notes?: readonly string[];
  /**
   * `true` 表示该资源不可被 agent 编辑(`write` / `edit` 应拒绝)。
   * router 从 {@link ProtocolHandler.immutable} 统一注入,handler 不必填。
   */
  immutable?: boolean;
}

/**
 * Caller 注入给 handler 的上下文,跟 {@link ToolContext} 是精确子集(spawn 专属
 * 字段不进来)。
 *
 * `profileId` / `agentId` / `sessionId` 是必填:
 * - `skill://foo` 需要 profileId 才能找到 `${root}/profiles/{pid}/skills/foo/SKILL.md`
 * - `local://staging` 需要 sessionId 才能定位 session-scoped 暂存目录
 * - `agent://abc` 需要 profileId 才能区分跨 profile 的同 id agent
 *
 * 缺失视为程序 bug —— handler 应直接抛错,不允许"猜一个默认值"。
 */
export interface ResolveContext {
  readonly profileId: string;
  readonly agentId: string;
  readonly sessionId: string;
  /** Caller 的取消信号,handler 应一路透传到底层 I/O。 */
  readonly signal?: AbortSignal;
}

/**
 * 一个 scheme 的 handler。
 *
 * `complete` / `write` / `resolveToPath` 是可选钩子;不实现 = 该 scheme 没此能力。
 */
export interface ProtocolHandler {
  /** scheme 名(无 `://`),小写,例如 `'skill'`。 */
  readonly scheme: string;
  /**
   * 该 handler 解析出的资源是否不可被 agent 编辑。skill / agent / memory 应为
   * `true`(系统资产);`local://` 应为 `false`(session 暂存,可写)。
   */
  readonly immutable: boolean;
  /**
   * Optional 写入钩子。`write` 工具 dispatch `write(url, content)` 时会调
   * 这个;不实现 = 该 scheme read-only,write 工具会回 `(not writable)`。
   */
  write?(
    url: ParsedInternalUrl,
    content: string,
    ctx: WriteContext,
  ): Promise<void>;
  /**
   * Optional 补全钩子。renderer 在用户输入 `scheme://...` 时调,返回候选 host/
   * path 段。**MUST 快 + 纯本地** —— 每次按键都会跑。
   */
  complete?(query: string): Promise<UrlCompletion[]>;
  /**
   * 把 internal URL 解析成 {@link InternalResource}。
   *
   * @throws Error 用户友好的错误消息(不带堆栈),router 会按"resolution failed:
   *   ..."的形式 surface 给 LLM。
   */
  resolve(url: ParsedInternalUrl, ctx: ResolveContext): Promise<InternalResource>;
  /**
   * Optional 路径解析钩子。renderer 在调老 fs IPC 前用这个把 URI 展开成绝对路径。
   *
   * 与 {@link resolve} 不同:
   * - {@link resolve} 读取并返回 **文件内容**,目录 / 二进制 / 大文件抛错;给 LLM 用
   * - {@link resolveToPath} 只**算路径**,可指向目录,**不读 I/O**;给 renderer 在内部
   *   把 URI 翻成绝对路径(用于 `fsApi.readFile` / `getWorkspaceFileTree` / 文件管理器
   *   等仍按绝对路径运转的旧通道)
   *
   * 空 path 在 {@link resolve} 里抛错(LLM 不该用 `local://` 读目录),但本方法**允许**
   * 空 path —— renderer 需要"当前 session sandbox 根目录"的绝对路径。
   *
   * **sandbox 边界检查仍必须做** —— renderer 拿到的绝对路径必须落在 sandbox 内,
   * `..` 越界一律抛错。
   *
   * 未实现 = 该 scheme 不支持"翻成 fs path"语义(纯 in-memory 系统资产)。
   * `skill://` **实现**了本钩子:skill 是 curated agent 资产(需被 shell 执行、
   * 被 renderer fs IPC 消费),有意外泄绝对路径 —— 与隔离 sandbox 的取舍不同。
   */
  resolveToPath?(url: ParsedInternalUrl, ctx: ResolveContext): Promise<string>;
}

/**
 * `parseInternalUrl` 解析后的结果。保留原始 host 大小写(标准 URL 会 lowercase host,
 * 但我们的 skill name / agent id 大小写敏感)。
 */
export interface ParsedInternalUrl {
  /** 原 input 字符串(`scheme://host/path?query`)。 */
  readonly href: string;
  /** scheme,无 `:`,**已 lowercase**(scheme 本身大小写不敏感)。 */
  readonly scheme: string;
  /** host 段原文(保留大小写)。例如 `skill://Hello-World` → `Hello-World`。 */
  readonly host: string;
  /**
   * path 段**规范化后**形态(以 `/` 开头或空字符串)。例如
   * `skill://foo/bar.md` → `/bar.md`。
   */
  readonly pathname: string;
  /**
   * path 段**原文**(未做任何规范化:`.` / `..` / 重复 `/` 都保留)。
   *
   * 当 handler 需要做"防 path traversal"检查时(例如 `local://` 把 URL 映射
   * 到 session 暂存目录,要拒绝 `local://../../etc/passwd`),**MUST 走
   * rawPathname**,因为 {@link pathname} 可能被未来的规范化逻辑吞掉 `..`。
   *
   * 当前阶段我们的 parser 没做规范化,所以 `rawPathname === pathname`;字段
   * 单独存在是**契约层留口** —— 后续若引入 URL 规范化,handler 不必改。
   */
  readonly rawPathname: string;
  /** Query string 解析结果(URLSearchParams)。 */
  readonly searchParams: URLSearchParams;
}

/**
 * 单条 URL 补全候选。caller 把 `value` 渲染成 `scheme://<value>`。
 */
export interface UrlCompletion {
  /** scheme:// 后的文本。例如 `my-skill` → 渲染成 `skill://my-skill`。 */
  readonly value: string;
  /** 下拉面板里的可读 label;省略时 fallback 到 {@link value}。 */
  readonly label?: string;
  /** 补在 label 旁的一行说明。 */
  readonly description?: string;
}

/**
 * `write` 工具调 `ProtocolHandler.write?` 时注入的上下文。
 *
 * 跟 {@link ResolveContext} 同形(profile/agent/session/signal),单独定义
 * 让 read/write 路径的 ctx 命名清晰 —— handler 实现时一眼看出"我现在在
 * 处理读还是写"。
 */
export interface WriteContext {
  readonly profileId: string;
  readonly agentId: string;
  readonly sessionId: string;
  readonly signal?: AbortSignal;
}

/**
 * Sentinel:handler.resolve 命中 ENOENT 时抛此错。
 *
 * 调用方区分"资源不存在"与其他失败的唯一受支持方式 —— 不要 string-match
 * 错误消息(handler 间消息形态可能不一致)。
 *
 * 用例:`write` 工具在 append/prepend/insert 模式下若 resource 不存在,
 * 视作新建,把 originalContent 当 ''。其它错误(权限、binary、超限)继续上抛。
 */
export class ResourceNotFoundError extends Error {
  public readonly code = 'RESOURCE_NOT_FOUND' as const;
  constructor(message: string) {
    super(message);
    this.name = 'ResourceNotFoundError';
  }
}

/**
 * Convert {@link ToolContext} → {@link ResolveContext}。
 *
 * 显式收窄,**不**直接 spread —— ToolContext 加新字段时强制看一眼是否要让 handler
 * 看见。
 */
export function toResolveContext(ctx: ToolContext): ResolveContext {
  return {
    profileId: ctx.profileId,
    agentId: ctx.agentId,
    sessionId: ctx.sessionId,
    signal: ctx.signal,
  };
}

/**
 * Convert {@link ToolContext} → {@link WriteContext}。
 *
 * 字段与 {@link toResolveContext} 完全相同;两个独立函数让"读 / 写"路径在
 * call site 处一眼可辨,handler 实现也不用做形态判断。
 */
export function toWriteContext(ctx: ToolContext): WriteContext {
  return {
    profileId: ctx.profileId,
    agentId: ctx.agentId,
    sessionId: ctx.sessionId,
    signal: ctx.signal,
  };
}

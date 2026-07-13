/**
 * Message 类型 —— Domain canonical 形态。
 *
 *   ┌─────────────────────────────────────────────────────────────────────┐
 *   │  Domain    (本文件)             主进程内存 + IPC 契约 (canonical) │
 *   │  Persisted (main/persist + persist/types)  JSONL 行,从 Domain 派生 │
 *   │  Render    (renderer/lib/chat/renderMessage.ts)  渲染进程,先最简   │
 *   └─────────────────────────────────────────────────────────────────────┘
 *
 * 本文件是 IPC 契约 + 主进程 canonical:跨进程类型只能从这里 import。
 * 持久化 (rehydrate / dehydrate / PersistedJsonLine) 与 Render 形态
 * (RenderMessage) 各自落在使用方,不在 shared 层堆积;Resume 判定 (`ResumeAction`
 * + `planResume`) 是主进程内部状态机,定义同样落在 `main/pi/resume.ts`。
 * 设计原则:
 *   - **数组字段必填,默认空数组**。消费方不写 `?? []`。
 *   - **Message 顶层只有 user / assistant** —— tool 结果折进 ToolCall.response,
 *     turn loop / 压缩 / 回溯不再需要同时维护"消息序列"与"tool 结果序列"两条流。
 *   - **重试不入内存**:Domain ToolCall 只保留 `response` 最终态;重试历史
 *     如有审计/分析需求,从 jsonl 现读 (同 id 多条 PersistedToolResponse)。
 *   - **Resume 0 多余字段**:形态本身不带 in-flight 标记;1-bit `turn.status`
 *     在 SessionDataFile 上 (shared/persist/types.ts);planResume 看 messages
 *     尾部即出动作。
 *
 * 本文件不接管 chatTypes.ts 中 SUPPORTED_*** / FILE_ATTACHMENT_LIMITS 等无关常量。
 */

// ═══════════════════════════════════════════════════════════════════════════
// § 1. 共用基元
// ═══════════════════════════════════════════════════════════════════════════

/**
 * URI brand:`local://` | `knowledge://` | `agent://` | `session://` | 外部
 * 绝对路径。运行时是普通字符串;brand 仅 TS 层提示,运行时无开销。
 */
export type FileUri = string & { readonly __brand: 'FileUri' };
export const asFileUri = (s: string): FileUri => s as FileUri;

/**
 * Token 用量,落盘形态精简以省空间。语义对齐 pi-ai `Usage` 的 prompt 侧拆分:
 * `in` 仅非缓存输入,缓存命中时 `cache[0]`(read)才是大头;真实 prompt 占用 =
 * in + cache[0] + cache[1]。total = in + out + cache[0] + cache[1]。
 */
export interface TokenUsage {
  in: number;
  out: number;
  /** [read, write] 缓存读/写 token。 */
  cache: [read: number, write: number];
  total: number;
}

/**
 * 用户消息附件。把现行 `FileContentPart` / `OfficeContentPart` /
 * `OthersContentPart` 三个 99% 字段重复的 part 类型合一,用 `kind` 区分:
 *
 *   - `image`   内嵌 base64 或外链/文件引用的图片
 *   - `text`    普通文本/读得动的文件 (read 工具走通用后端)
 *   - `office`  pdf / docx / pptx 等 (read 工具走 office 后端)
 *   - `opaque`  仅元数据,内容未读;UI 显示卡片不进 LLM 上下文
 */
export type Attachment =
  | {
      kind: 'image';
      fileName: string;
      fileSize: number;
      mimeType: string;
      /** dataUrl 只携带 base64 部分 (不含 `data:...;base64,` 前缀)。 */
      source: { kind: 'dataUrl'; data: string } | { kind: 'fileRef'; uri: FileUri };
      width?: number;
      height?: number;
      detail?: 'auto' | 'low' | 'high';
    }
  | {
      kind: 'text';
      fileName: string;
      fileSize: number;
      mimeType: string;
      fileUri: FileUri;
      detail?: 'auto' | 'low' | 'high';
      lastModified?: number;
      lines?: number;
      truncated?: boolean;
      encoding?: string;
    }
  | {
      kind: 'office';
      fileName: string;
      fileSize: number;
      mimeType: string;
      fileUri: FileUri;
      detail?: 'auto' | 'low' | 'high';
      lastModified?: number;
      pages?: number;
      lines?: number;
      truncated?: boolean;
      encoding?: string;
    }
  | {
      kind: 'opaque';
      fileName: string;
      fileSize: number;
      mimeType: string;
      fileUri: FileUri;
      fileExtension?: string;
      description?: string;
    };
/**
 * Assistant 在某轮的终止原因。结构化判别字段,**缺省视作 `{ kind: 'stop' }`**
 * (Persisted 也允许省略,节省体积)。用于 resume 调度决定续跑/标 idle/标终态;
 * `error.category` 给 overflow 兜底等错误分类用。
 *
 * 注:`toolUse` 不在这里 —— "是否还要再调一轮 LLM" 已经由 `tool_calls.length`
 * + `tool_calls[i].response` 完整表达,无需额外 enum。
 */
export type AssistantOutcome =
  | { kind: 'stop' }
  | { kind: 'aborted'; partial: boolean }                                     // partial 表明此条带不带半截 token
  | { kind: 'error'; message: string; category?: ErrorCategory }
  | { kind: 'maxIter' };

export type ErrorCategory = 'overflow' | 'auth' | 'rateLimit' | 'network' | 'other';

/** 工具回传的图片内容(如 `read` 一个图片文件)。base64 不含 `data:` 前缀。 */
export interface ToolResultImage {
  data: string;
  mimeType: string;
}

/** Tool 执行结果。`fail` 包括工具抛错、tool 不存在、被 abort 等所有非 success。 */
export interface ToolResult {
  time: number;
  status: 'success' | 'fail';
  /** 文本结果 (内置 / MCP 工具产出统一为 string)。fail 时存错误描述。 */
  result: string;
  /**
   * 工具回传的图片(如 read 一个图片附件)。**Domain 内存态必填,默认空数组**
   * (消费方不写 `?? []`);Persisted 落盘态 optional,空数组不写盘、rehydrate 回填 `[]`。
   * 出境时由 messageBridge 拼成 pi `ToolResultMessage` 的 ImageContent。base64 只在
   * LLM 真正读取该图片时才随 `tool_res` 行进 jsonl。
   */
  images: ToolResultImage[];
}

// ═══════════════════════════════════════════════════════════════════════════
// § 2. ToolCall (Domain)
// ═══════════════════════════════════════════════════════════════════════════

export interface ToolCall {
  id: string;
  name: string;
  time: number;
  args: Record<string, unknown>;
  /** MCP server 名称；缺席表示本地工具或旧历史记录。 */
  mcp?: string;
  /**
   * 已收到的最终 (最新一次) 结果。未跑或在跑时为 undefined。
   * **不**保留重试历史 —— 内存只关心当前态;历史从 jsonl 现读。
   */
  response?: ToolResult;
}

// ═══════════════════════════════════════════════════════════════════════════
// § 3. Domain 形态 —— 主进程内存 (canonical)
//
//   原则:**所有数组字段必填,默认空数组**。消费方不写 `?? []`。
//   Message 数组顶层只有 user / assistant —— tool 结果折进 ToolCall.response,
//   turn loop / 压缩 / 回溯不再需要同时维护"消息序列"与"tool 结果序列"两条流。
// ═══════════════════════════════════════════════════════════════════════════

export interface UserMessage {
  role: 'user';
  id: string;
  time: number;
  content: string;
  attachments: Attachment[];                                                  // 必填,空即 []
}

export interface AssistantMessage {
  role: 'assistant';
  id: string;
  time: number;
  /** 模型 reasoning 文本聚合 (跨多个 thinking_delta 拼成的最终单串)。 */
  think: string;
  /** 模型对外文本聚合。 */
  content: string;
  tool_calls: ToolCall[];                                                     // 必填,空即 []
  /** 缺省视作 `{ kind: 'stop' }`。 */
  outcome?: AssistantOutcome;
  model?: string;
  usage?: TokenUsage;
}

export type Message = UserMessage | AssistantMessage;
export type MessageRole = Message['role'];

// ═══════════════════════════════════════════════════════════════════════════
// § 4. 类型守卫
// ═══════════════════════════════════════════════════════════════════════════

export const isUserMessage = (m: Message): m is UserMessage => m.role === 'user';
export const isAssistantMessage = (m: Message): m is AssistantMessage => m.role === 'assistant';


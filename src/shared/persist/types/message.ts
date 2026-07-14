/**
 * `messages.jsonl` 对应的 Message 类型 —— Domain canonical 形态 + 磁盘派生形态。
 *
 *   ┌─────────────────────────────────────────────────────────────────────┐
 *   │  Domain    (本文件上半)             主进程内存 + IPC 契约 (canonical) │
 *   │  Persisted (本文件下半)             JSONL 行，从 Domain 派生          │
 *   │  Render    (renderer/lib/chat/renderMessage.ts)  渲染进程，先最简     │
 *   └─────────────────────────────────────────────────────────────────────┘
 *
 * 本文件是 IPC 契约 + 主进程 canonical：跨进程类型只能从这里 import。
 * Domain ↔ Persisted 的互转 (rehydrate / dehydrate) 落在 `main/persist/messageWire.ts`，
 * Render 形态 (RenderMessage) 落在渲染进程，不在 shared 层堆积；Resume 判定
 * (`ResumeAction` + `planResume`) 是主进程内部状态机，定义落在 `main/pi/utils/resume.ts`。
 * 设计原则：
 *   - **数组字段必填，默认空数组**。消费方不写 `?? []`；Persisted 落盘时空数组省略。
 *   - **Message 顶层只有 user / assistant** —— tool 结果折进 ToolCall.response，
 *     turn loop / 压缩 / 回溯不再需要同时维护"消息序列"与"tool 结果序列"两条流。
 *   - **重试不入内存**：Domain ToolCall 只保留 `response` 最终态；重试历史
 *     如有审计/分析需求，从 jsonl 现读 (同 id 多条 PersistedToolResponse)。
 *   - **Resume 0 多余字段**：形态本身不带 in-flight 标记；1-bit `turn.status`
 *     在 SessionDataFile 上 (见 `./session.ts`)；planResume 看 messages 尾部即出动作。
 *
 * 本文件不接管 chatTypes.ts 中 SUPPORTED_*** / FILE_ATTACHMENT_LIMITS 等无关常量。
 */

/** URI brand：运行时是普通字符串，仅在类型层保留来源语义。 */
export type FileUri = string & { readonly __brand: 'FileUri' };
export const asFileUri = (s: string): FileUri => s as FileUri;

/**
 * Token 用量，落盘形态精简以省空间。语义对齐 pi-ai `Usage` 的 prompt 侧拆分：
 * `in` 仅非缓存输入，缓存命中时 `cache[0]`(read)才是大头；真实 prompt 占用 =
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
 * 用户消息附件。三个 99% 字段重复的 part 类型合一，用 `kind` 区分：
 *
 *   - `image`   内嵌 base64 或外链/文件引用的图片
 *   - `text`    普通文本/读得动的文件 (read 工具走通用后端)
 *   - `office`  pdf / docx / pptx 等 (read 工具走 office 后端)
 *   - `opaque`  仅元数据，内容未读；UI 显示卡片不进 LLM 上下文
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
 * Assistant 在某轮的终止原因。结构化判别字段，**缺省视作 `{ kind: 'stop' }`**
 * (Persisted 也允许省略，节省体积)。用于 resume 调度决定续跑/标 idle/标终态；
 * `error.category` 给 overflow 兜底等错误分类用。
 *
 * 注：`toolUse` 不在这里 —— "是否还要再调一轮 LLM" 已经由 `tool_calls.length`
 * + `tool_calls[i].response` 完整表达，无需额外 enum。
 */
export type AssistantOutcome =
  | { kind: 'stop' }
  | { kind: 'aborted'; partial: boolean }                                     // partial 表明此条带不带半截 token
  | { kind: 'error'; message: string; category?: ErrorCategory }
  | { kind: 'maxIter' };

export type ErrorCategory = 'overflow' | 'auth' | 'rateLimit' | 'network' | 'other';

/** 工具回传的图片内容，base64 不含 `data:` 前缀。 */
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
   * 工具回传的图片(如 read 一个图片附件)。**Domain 内存态必填，默认空数组**
   * (消费方不写 `?? []`)；Persisted 落盘态 optional，空数组不写盘、rehydrate 回填 `[]`。
   * base64 只在 LLM 真正读取该图片时才随 `tool_res` 行进 jsonl。
   */
  images: ToolResultImage[];
}

export interface ToolCall {
  id: string;
  name: string;
  time: number;
  args: Record<string, unknown>;
  /** MCP server 名称；缺席表示本地工具或旧历史记录。 */
  mcp?: string;
  /**
   * 已收到的最终 (最新一次) 结果。未跑或在跑时为 undefined。
   * **不**保留重试历史 —— 内存只关心当前态；历史从 jsonl 现读。
   */
  response?: ToolResult;
}

/**
 * 主进程与 IPC 共享的消息 canonical 形态。
 * 原则：**所有数组字段必填，默认空数组**，消费方不写 `?? []`。
 */
export interface UserMessage {
  role: 'user';
  id: string;
  time: number;
  content: string;
  attachments: Attachment[];                                                  // 必填，空即 []
}

export interface AssistantMessage {
  role: 'assistant';
  id: string;
  time: number;
  /** 模型 reasoning 文本聚合 (跨多个 thinking_delta 拼成的最终单串)。 */
  think: string;
  /** 模型对外文本聚合。 */
  content: string;
  tool_calls: ToolCall[];                                                     // 必填，空即 []
  /** 缺省视作 `{ kind: 'stop' }`。 */
  outcome?: AssistantOutcome;
  model?: string;
  usage?: TokenUsage;
}

export type Message = UserMessage | AssistantMessage;
export type MessageRole = Message['role'];

export const isUserMessage = (m: Message): m is UserMessage => m.role === 'user';
export const isAssistantMessage = (m: Message): m is AssistantMessage => m.role === 'assistant';

/**
 * ----------------------------------------------------------------------------------------------------
 * 需要持久化存储的类型，大体相同，但略有差异，主要还是以节省空间为主。
 * ----------------------------------------------------------------------------------------------------
 */

/** Persisted UserMessage：空 attachments 不入盘。 */
export type PersistedUserMessage = Omit<UserMessage, 'attachments'> & {
  attachments?: Attachment[];
};

/** Persisted ToolCall：response 独立作为 `tool_res` 行。 */
export type PersistedToolCall = Omit<ToolCall, 'response'>;

/** Persisted AssistantMessage：空 tool_calls 不入盘。 */
export type PersistedAssistantMessage =
  & Omit<AssistantMessage, 'tool_calls'>
  & { tool_calls?: PersistedToolCall[] };

/** `tool_res` 行；id 对齐对应 ToolCall.id。 */
export type PersistedToolResponse =
  & Omit<ToolResult, 'images'>
  & { role: 'tool_res'; id: string; images?: ToolResultImage[] };

export type PersistedJsonLine =
  | PersistedUserMessage
  | PersistedAssistantMessage
  | PersistedToolResponse;

/** 历史命名兼容的语义别名；新代码优先使用 PersistedJsonLine。 */
export type ChatHistoryItem = PersistedJsonLine;

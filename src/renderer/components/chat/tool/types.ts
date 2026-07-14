// src/renderer/components/chat/tool/types.ts
// Tool Call 自定义渲染机制的类型定义。
//
// 设计:工具调用 section 由三个**固定点位**组成 —— chip / input / output。
// 外框布局(chip 行 + input 块 + output 块)由 ToolCallsSection / DefaultToolDetailView
// 统一拥有,**任何工具都不能改这个外框**。每个点位允许工具按细粒度或粗粒度
// 二选一定制:
//
//   - chip      细 = chipLabel(自定义文案); 粗 = Chip(整个 chip 组件)
//   - input     细 = inputArgsText(替换 argsText 字符串); 粗 = InputBlock(替换 <pre> 块)
//   - output    细 = outputResultText(替换成功时的 result 字符串)
//                粗 = OutputSuccessBlock(替换成功时的 <pre> 块)
//                额外 = OutputExecutingBlock(替换 executing 状态的 <pre> 块,仅粗粒度)
//                ⚠ 失败 / interrupted 一律走默认渲染,工具不接管。
import type { ToolCall } from '@shared/persist/types'

export type ToolCallExecutionStatus = 'executing' | 'completed' | 'interrupted';

// Re-export tool call arg/result types from shared for convenience
export type {
  ShellToolArgs, ShellToolResult,
  WriteToolArgs, WriteToolResult,
} from '@shared/types/toolCallArgs';

/**
 * 共享 props —— 三个 slot 的 component override 都收同一份。
 * `executionStatus` 让 chip / input slot 也能感知执行阶段(虽然它们通常不依赖,
 * 但比如 chip 想在 executing 时换文案就用得上)。
 */
export interface ToolSlotProps {
  toolCall: ToolCall;
  executionStatus: ToolCallExecutionStatus;
}

/**
 * Output success slot 的 props —— 比通用 ToolSlotProps 多一个 `result` 字段
 * (response.result 文本)。OutputSuccessBlock 只在 `response.status === 'success'`
 * 时被调用,因此 result 必非空。
 */
export interface ToolOutputSuccessSlotProps extends ToolSlotProps {
  result: string;
}

/**
 * Chip slot 的 props —— 在通用 props 之外,额外提供选中态 / 失败态 / 点击回调,
 * 让粗粒度 Chip override 也能维持单选交互。
 */
export interface ToolChipSlotProps extends ToolSlotProps {
  selected: boolean;
  failed: boolean;
  onClick: () => void;
}

/**
 * 单个工具的渲染覆盖项。所有 slot 字段都是 optional —— 工具可以只覆盖一个
 * 点位、也可以覆盖多个;同一个点位**细 / 粗只能选一个**(同时给时粗粒度优先,
 * 这是技术兜底而非鼓励)。
 *
 * 注册时以 `toolName` 为 key 一对一存入 registry,**不含**额外的命中规则
 * 字段:子命令分派(如 `app` 内部分到 `subagent` / `mcp` / `skill` ...)
 * 是**该工具自身的实现细节**,在 chip / input / output 各 slot 内部完成,
 * 不暴露给全局 registry。
 */
export interface ToolRenderer {
  // ── chip slot ─────────────────────────────────────────────────────────────
  /** 细:返回 chip 上的展示文案。返回空串视为"用默认(toolName)"。 */
  chipLabel?: (toolCall: ToolCall) => string;
  /** 粗:整个 chip 组件 —— 必须自行实现单选 / 状态点等交互。 */
  Chip?: React.ComponentType<ToolChipSlotProps>;

  // ── input slot ────────────────────────────────────────────────────────────
  /** 细:返回 input <pre> 内的文本。返回空串视为"无参数"(走默认 placeholder)。 */
  inputArgsText?: (toolCall: ToolCall) => string;
  /** 粗:整个 input <pre> 块(包括内部内容,但**不含**外面的 caption header)。 */
  InputBlock?: React.ComponentType<ToolSlotProps>;
  // ── output slot ──────────────────────────────────────────────────────────
  /** 细:返回成功时 output <pre> 内的文本。 */
  outputResultText?: (toolCall: ToolCall) => string;
  /** 粗:整个成功时 output <pre> 块(不含外面的 caption header)。 */
  OutputSuccessBlock?: React.ComponentType<ToolOutputSuccessSlotProps>;
  /**
   * 粗:executing 状态下整个 output <pre> 块。仅粗粒度(executing 期没有可
   * 替换的 result text)。未提供时走默认 "Running…" 占位。常见用途:实时
   * 进度面板 / 流式文本(如 subagent)。
   */
  OutputExecutingBlock?: React.ComponentType<ToolSlotProps>;
}

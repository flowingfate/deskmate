# Conversation Compression

当对话历史接近 token 上限时，本模块负责对消息序列做分阶段压缩：保留最近若干条原始消息（必要时再额外保留首条用户消息），中间段交由 LLM 生成结构化总结；总结失败时回落到一种简单的截断保留策略，始终给出一个可用的结果。

## Features

- ✅ **No positional hard-anchors by default**: 默认仅保留最近的若干条消息以及成对的工具调用完整性，不再把"首条用户消息 / 首个 SKILL"当作永久不可压缩的锚点。
- ✅ **Optional anchor protection**: 必要时可显式打开"保留首条用户消息"或"保留首个 SKILL.md 块"作为兼容选项。
- ✅ **Preserve recent messages**: 可配置保留的最近消息条数（默认 5 条）。
- ✅ **Intelligent summary compression**: 使用内置的 8 段式结构化总结模板。
- ✅ **Structured pre-trimming**: 进入总结阶段前，对超大工具结果（`fetch_web_content`、`read`、搜索结果、命令输出等）做无损的关键信息抽取。
- ✅ **Token-aware summary budgeting**: 每次总结调用都会扣除真实的固定请求开销（system prompt + 用户提示模板），并按一个保守的 prompt token 预算切分 chunk，而不仅依赖字符数。
- ✅ **Single-message overflow re-truncation**: 如果某条消息单独就超过总结提示预算，会再做一次 token-aware 截断后再进入总结，不允许整条原样穿透预算。
- ✅ **Recursive hierarchical merge**: chunk 总结之间的合并也按预算分层批处理，避免第二阶段退化成一次性 overflow。
- ✅ **Limited-concurrency chunk summary**: 第一层会话 chunk 总结支持有限并发，缩短大会话的总压缩耗时；合并阶段保持串行。
- ✅ **Recursive depth guard**: 合并阶段有最大递归深度，极端配置下会快速回落，而不会无界串行调用压缩模型。
- ✅ **Dedicated compression LLM interface**: 总结调用统一走一个固定场景的 LLM helper，内部固化了 system prompt、总结模板、输出语言、模型与采样参数，外部不需要再配。
- ✅ **Degradation strategy**: API 失败时自动回落到简单保留策略。
- ✅ **No token calculation dependency**: 模块只负责压缩逻辑，不持有 token 计数。
- ✅ **Configurable**: 支持自定义压缩窗口与预算参数；总结策略由内部 LLM helper 固定。

## Core Algorithm

### Compression Strategy

```
原始消息: [M1, M2, M3(fetch), M4(read), M5, M6, M7, M8, M9, M10, M11, M12]
                          ↓
分析结构: 最近 5 条 (M8–M12) + 中间可压缩段 (M1–M7)
                          ↓
结构化预剪枝: 把超大工具结果压成元信息 + 预览
                          ↓
分块总结: 中间段做 token-aware chunk 总结 + 递归合并
                          ↓
压缩结果: [SUMMARY(M1-M7), M8, M9, M10, M11, M12]
```

### Summary Template

总结 helper 内置的 8 段式结构化模板：

1. **Conversation Overview** — 主要目标与上下文
2. **Technical Background** — 涉及的技术栈与框架
3. **Codebase State** — 当前代码状态与结构
4. **Problem Solving** — 已遇到的问题与解决方案
5. **Progress Tracking** — 已完成与进行中的工作
6. **Active Work State** — 当前关注点
7. **Recent Actions** — 最近的代码改动与决策
8. **Continuation Plan** — 后续步骤与未决问题

## Quick Start

### Basic Usage

```typescript
import { createFullModeCompressor } from './compression/fullModeCompressor';
import { Message } from './types/chatTypes';

// 1. 创建一个压缩器
const compressor = createFullModeCompressor();

// 2. 准备消息列表
const messages: Message[] = [
  // ... your messages
];

// 3. 执行压缩
const result = await compressor.compressMessages(messages);

// 4. 使用结果
if (result.success) {
  console.log(`Compressed: ${result.originalMessages.length} -> ${result.compressedMessages.length}`);
  // 使用 result.compressedMessages
} else {
  console.error('Compression failed:', result.error);
  // 使用回落产生的 result.compressedMessages
}
```

### Custom Configuration

```typescript
import { createFullModeCompressor, FullModeCompressionConfig } from './compression/fullModeCompressor';

const config: Partial<FullModeCompressionConfig> = {
  preserveRecentMessages: 3,        // 保留最近 3 条
  preserveFirstUserMessage: false,  // 默认不再保留首条用户消息
  preserveFirstSkillToolCall: false,// 默认不再保留首个 skill 块
  summaryPromptTokenBudget: 100000, // 单次总结的真实 token 预算
  maxRetries: 3,                    // 单次总结的最大重试次数
  maxConcurrentChunkSummaries: 2,   // 第一层 chunk 总结的最大并发
  enableDebugLog: true              // 打开调试日志
};

const compressor = createFullModeCompressor(config);
const result = await compressor.compressMessages(messages);
```

## API Reference

### FullModeCompressor

主压缩器类。

#### Methods

##### `compressMessages(messages: Message[]): Promise<FullModeCompressionResult>`

压缩一段消息列表。

**Parameters:**
- `messages`: 待压缩的消息数组

**Returns:**
- `Promise<FullModeCompressionResult>`: 压缩结果

##### `updateConfig(newConfig: Partial<FullModeCompressionConfig>): void`

更新压缩器配置。

##### `getConfig(): FullModeCompressionConfig`

返回当前配置。

### Configuration Options

```typescript
interface FullModeCompressionConfig {
  /** 保留的最近消息条数 */
  preserveRecentMessages: number;
  /** 是否额外保留首条用户消息（默认关闭） */
  preserveFirstUserMessage: boolean;
  /** 是否额外保留首个成功的 SKILL.md `read` 工具调用 + 结果（默认关闭） */
  preserveFirstSkillToolCall: boolean;
  /** 单次总结提示的硬 token 预算（含模板开销）；低于模板开销则失败回落 */
  summaryPromptTokenBudget: number;
  /** 最大重试次数 */
  maxRetries: number;
  /** 第一层会话 chunk 总结的最大并发数 */
  maxConcurrentChunkSummaries: number;
  /** 递归合并总结的最大递归深度 */
  maxSummaryRecursionDepth: number;
  /** 是否打开调试日志 */
  enableDebugLog: boolean;
}
```

`summaryLanguage` 与总结模板不再作为 `FullModeCompressor` 的配置项暴露。它们由 `contextCompressionLlmSummarizer` 内部管理，避免压缩器持续持有 LLM prompt 细节。

### Compression Result

```typescript
interface FullModeCompressionResult {
  /** 压缩是否成功 */
  success: boolean;
  /** 原始消息列表 */
  originalMessages: Message[];
  /** 压缩后的消息列表 */
  compressedMessages: Message[];
  /** 使用的压缩策略描述 */
  strategy: string;
  /** 被压缩的消息区间 */
  compressedRange?: {
    startIndex: number;
    endIndex: number;
    messageCount: number;
  };
  /** 总结内容（如果有） */
  summary?: string;
  /** 处理耗时 */
  processingTime: number;
  /** 错误信息 */
  error?: string;
  /** 元数据 */
  metadata: {
    preservedFirst: boolean;
    preservedRecent: number;
    compressionMethod: 'summary' | 'none' | 'fallback';
    timestamp: number;
  };
}
```

## Use Cases

### 1. Long Conversation Compression

```typescript
// 处理超出限制的对话
if (messages.length > 20) {
  const result = await compressor.compressMessages(messages);
  // 使用压缩后的消息继续对话
  const response = await chatAPI.sendMessages(result.compressedMessages);
}
```

### 2. Context Window Management

```typescript
// 在发起 API 请求前做一次智能压缩
const compressor = createFullModeCompressor({
  preserveRecentMessages: 5,
  preserveFirstUserMessage: false,
  preserveFirstSkillToolCall: false
});

const result = await compressor.compressMessages(conversationHistory);
const apiRequest = {
  messages: result.compressedMessages,
  // ... 其他参数
};
```

### 3. Batch Conversation Processing

```typescript
// 批量处理多个会话
const sessions = await loadConversationSessions();

for (const session of sessions) {
  if (session.messages.length > 10) {
    const result = await compressor.compressMessages(session.messages);
    await saveCompressedSession(session.id, result.compressedMessages);
  }
}
```

## Best Practices

### 1. Configuration Tuning

```typescript
// 不同场景下的配置
const configs = {
  // 快速压缩 — 用于实时会话
  fast: {
    preserveRecentMessages: 3,
    summaryPromptTokenBudget: 50000,
    maxRetries: 1
  },

  // 平衡压缩 — 推荐默认
  balanced: {
    preserveRecentMessages: 5,
    summaryPromptTokenBudget: 100000,
    maxRetries: 3
  },

  // 高质量压缩 — 用于重要会话
  quality: {
    preserveRecentMessages: 7,
    summaryPromptTokenBudget: 100000,
    maxRetries: 5
  }
};
```

### 2. Error Handling

```typescript
const result = await compressor.compressMessages(messages);

if (!result.success) {
  // 压缩失败，但仍能拿到回落结果
  logger.warn('Compression failed, using fallback:', result.error);

  // 回落结果可继续使用
  const fallbackMessages = result.compressedMessages;
}
```

### 3. Performance Monitoring

```typescript
const startTime = Date.now();
const result = await compressor.compressMessages(messages);

// 监控压缩性能
const compressionRatio = result.compressedMessages.length / result.originalMessages.length;
const processingTime = result.processingTime;

logger.info('Compression metrics', {
  originalCount: result.originalMessages.length,
  compressedCount: result.compressedMessages.length,
  compressionRatio: compressionRatio.toFixed(2),
  processingTime: `${processingTime}ms`,
  strategy: result.strategy
});
```

## Examples and Tests

完整使用示例见 `fullModeCompressor.example.ts`，包括：

- 基本使用示例
- 自定义配置示例
- 边界情况测试
- 性能测试

```bash
# 运行示例
npm run example:compression
```

## Technical Details

### Compression Algorithm Flow

1. **消息结构分析**
   - 定位首条用户消息位置
   - 计算最近消息区间
   - 确定中间需要压缩的区间

2. **压缩策略决策**
   - 不需要压缩：直接返回原始消息
   - 需要压缩：抽取中间段送总结

3. **结构化总结生成**
   - 构造结构化的会话文本
   - 套用 8 段式总结模板
   - 调用 LLM API 生成总结

4. **消息重组**
   - 视配置保留首条用户消息
   - 用总结消息替换中间段
   - 保留最近若干条消息

5. **回落处理**
   - API 失败时自动回落
   - 使用简单保留策略
   - 始终保证返回一份可用结果

## Changelog

### v1.2.0 (2026-05-11)

- ✅ Tokenizer 对齐：压缩器改用 `o200k_base` 编码以与 Haiku 4.5 实际 tokenizer 一致，消除系统性偏差
- ✅ `summaryPromptTokenBudget` 12K → 100K：充分利用 Haiku 4.5 的 128K prompt 窗口（保留 28K 安全余量）
- ✅ Haiku 输出上限 `MAX_TOKENS` 5096 → 16000：与非流式 `max_non_streaming_output_tokens` 对齐
- ✅ `maxSummaryRecursionDepth` 8 → 4：100K 预算下通常一次 chunk 即可，4 层是保守上界
- ✅ `maxConcurrentChunkSummaries` 3 → 2：匹配 100K 预算下的实际 chunk 数
- ✅ 新增 `metadata.chunkSummaryCallCount`：chunk 级 `summarize()` 的调用次数（每个 chunk 计 1，重试不计）
- ✅ 新增 `metadata.totalLlmCallCount`：实际 LLM API 请求总数（含所有 chunk 重试），用于监控重试放大

### v1.0.0 (2024-11-07)

- ✅ 首版发布
- ✅ Full Mode 压缩算法实现
- ✅ 支持保留首条用户消息与最近若干条消息
- ✅ 集成 8 段式结构化总结模板
- ✅ 实现回落策略与错误处理
- ✅ 提供完整配置选项与使用示例

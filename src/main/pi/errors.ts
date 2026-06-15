/**
 * pi 错误分类。
 *
 * 与旧 `GhcApiError`（含 HTTP status）不同，pi 没有结构化的错误码字段：
 * - stream 内通过 `type: 'error'` 事件抛出，`event.error.errorMessage` 是字符串
 * - `complete()` 之后 `events.result()` 返回 `stopReason='error'` 的 AssistantMessage
 *   仍带 `errorMessage`
 *
 * 因此分类只能基于错误文本的模糊匹配。每条 pattern 后面注释里写明它对应
 * 哪个 provider 的真实错误文本，扩 provider 时按需追加。
 */

export type PiErrorKind = 'overflow' | 'auth' | 'rateLimit' | 'network' | 'other';

// 触发 force-compress + 重试一次的服务端 context overflow。
const OVERFLOW_PATTERNS: RegExp[] = [
  /prompt is too long/i,                  // anthropic
  /prompt token count/i,                  // anthropic / google
  /exceeds the limit/i,                   // openai-compat 多家
  /maximum context/i,                     // openai (legacy completions)
  /context length/i,                      // openai-completions
  /too many tokens/i,                     // openai-compat
  /tokens? exceeds?/i,                    // anthropic / generic
  /request too large/i,                   // openai（payload + 上下文综合）
  /maximum context length/i,              // openai-responses
];

// 一期只识别，不做自动 refresh —— 当成 fail 抛到 UI。
const AUTH_PATTERNS: RegExp[] = [
  /unauthorized/i,
  /invalid api key/i,
  /token expired/i,
  /authentication/i,
];

// 一期只识别，不做退避 —— pi SDK 自身的 maxRetries 已处理一定情况。
const RATE_LIMIT_PATTERNS: RegExp[] = [
  /rate limit/i,
  /too many requests/i,
  /quota/i,
];

const NETWORK_PATTERNS: RegExp[] = [
  /econnreset/i,
  /econnrefused/i,
  /etimedout/i,
  /enotfound/i,
  /socket hang up/i,
  /network/i,
  /fetch failed/i,
];

export function classifyError(err: unknown): PiErrorKind {
  const msg = extractMessage(err);
  if (!msg) return 'other';
  if (OVERFLOW_PATTERNS.some((p) => p.test(msg))) return 'overflow';
  if (AUTH_PATTERNS.some((p) => p.test(msg))) return 'auth';
  if (RATE_LIMIT_PATTERNS.some((p) => p.test(msg))) return 'rateLimit';
  if (NETWORK_PATTERNS.some((p) => p.test(msg))) return 'network';
  return 'other';
}

function extractMessage(err: unknown): string {
  if (!err) return '';
  if (typeof err === 'string') return err;
  if (err instanceof Error) return err.message;
  if (typeof err === 'object') {
    const e = err as { errorMessage?: unknown; message?: unknown };
    if (typeof e.errorMessage === 'string') return e.errorMessage;
    if (typeof e.message === 'string') return e.message;
  }
  return '';
}

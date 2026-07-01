/**
 * messages.jsonl ↔ Domain `Message[]` 转换。
 *
 * Persisted 类型 (`PersistedJsonLine` 等) 居在 `@shared/persist/types`,跨进程
 * 共享;本文件只放转换函数本身。
 *
 * 调用入口:
 *   - rehydrate:`BaseSession.restore()` 启动期一次性把 jsonl 读回内存
 *   - dehydrate:`Session.rewriteMessages()` 中段截断/编辑时全量覆盖写
 *
 * 常态 append-only 路径不经此处 —— `Session.appendDomainMessage` /
 * `appendToolResponse` 直接按 schema 把 `PersistedJsonLine` push 进 buffer,
 * 避免重复转换。
 */

import type {
  PersistedAssistantMessage,
  PersistedJsonLine,
  PersistedToolResponse,
  PersistedUserMessage,
} from '../../shared/persist/types';
import type {
  AssistantMessage,
  Message,
  ToolCall,
  UserMessage,
} from '../../shared/types/message';

/**
 * 把 JSONL 行序列折回成 Domain 消息数组。
 *
 *   - User / Assistant 行：回填空数组默认值，push
 *   - ToolResponse 行：按 id 折回到上一条 AssistantMessage 对应的 ToolCall；
 *     同 id 多条 = 重试，最新一次写入 `response` (历史不入 Domain)
 *   - 找不到匹配 ToolCall 的 ToolResponse：归入 orphan，**不抛错** (容忍历史
 *     脏数据)；调用方决定是日志还是丢弃
 *
 * 复杂度 O(N) 一次扫描；callIndex 用 Map 是因为查询 key 在 runtime 动态构建。
 */
export function rehydrate(lines: readonly PersistedJsonLine[]): {
  messages: Message[];
  orphanResponses: PersistedToolResponse[];
} {
  const messages: Message[] = [];
  const orphans: PersistedToolResponse[] = [];
  const callIndex = new Map<string, ToolCall>();

  for (const line of lines) {
    if (line.role === 'user') {
      const u: UserMessage = {
        role: 'user',
        id: line.id,
        time: line.time,
        content: line.content,
        attachments: line.attachments ?? [],
      };
      messages.push(u);
      continue;
    }
    if (line.role === 'assistant') {
      const tool_calls: ToolCall[] = (line.tool_calls ?? []).map(tc => ({
        id: tc.id,
        name: tc.name,
        time: tc.time,
        args: tc.args,
      }));
      const a: AssistantMessage = {
        role: 'assistant',
        id: line.id,
        time: line.time,
        think: line.think,
        content: line.content,
        tool_calls,
        outcome: line.outcome,
        model: line.model,
        usage: line.usage,
      };
      messages.push(a);
      for (const tc of tool_calls) callIndex.set(tc.id, tc);
      continue;
    }
    // tool_res
    const target = callIndex.get(line.id);
    if (!target) {
      orphans.push(line);
      continue;
    }
    target.response = {
      time: line.time,
      status: line.status,
      result: line.result,
      images: line.images ?? [],   // Domain 必填,空缺回填空数组
    };
  }

  return { messages, orphanResponses: orphans };
}

/**
 * Domain → Persisted。**会丢失重试历史**（只输出当前 response）—— 这是预期：
 * Domain 本就不持有历史。重写场景下，jsonl 上原本的多版本 ToolResponse 会被
 * 当次写入塌缩成一条；若要保留 audit，调用方先把旧 jsonl 备份。
 *
 * 空数组字段自动省略，产出最紧凑的 jsonl。
 */
export function dehydrate(messages: readonly Message[]): PersistedJsonLine[] {
  const out: PersistedJsonLine[] = [];
  for (const m of messages) {
    if (m.role === 'user') {
      const line: PersistedUserMessage = {
        role: 'user',
        id: m.id,
        time: m.time,
        content: m.content,
      };
      if (m.attachments.length > 0) line.attachments = m.attachments;
      out.push(line);
      continue;
    }
    const line: PersistedAssistantMessage = {
      role: 'assistant',
      id: m.id,
      time: m.time,
      think: m.think,
      content: m.content,
    };
    if (m.tool_calls.length > 0) {
      line.tool_calls = m.tool_calls.map(tc => ({
        id: tc.id,
        name: tc.name,
        time: tc.time,
        args: tc.args,
      }));
    }
    if (m.outcome) line.outcome = m.outcome;
    if (m.model) line.model = m.model;
    if (m.usage) line.usage = m.usage;
    out.push(line);
    // tool 结果按 ToolCall 顺序展开成独立行
    for (const tc of m.tool_calls) {
      if (!tc.response) continue;
      out.push({
        role: 'tool_res',
        id: tc.id,
        time: tc.response.time,
        status: tc.response.status,
        result: tc.response.result,
        images: tc.response.images.length > 0 ? tc.response.images : undefined,
      });
    }
  }
  return out;
}

// src/main/lib/compression/messageStructure.ts
//
// 压缩前的结构分析:消息序列被划分为 head / middle / recent 三段。
// `analyzeMessageStructure` 圈出 middle 段的范围,FullModeCompressor 据此决定
// "压谁、留谁";`findFirstSkillToolCallIndices` 找出携带 `read('xxx/skill.md')`
// 的首条 assistant —— 那条消息会在 head 之外被额外保护(skill 描述丢了模型就
// 不知道自己有什么能力)。
//
// 全部纯函数。无 I/O、无副作用、无 LLM 调用。
//
// 蓝本:ai.prompt/message.md

import type { Message } from '@shared/persist/types'

/** `analyzeMessageStructure` 返回的结构化结论。`middleMessagesRange === null` 即不需要压缩。 */
export interface MessageStructureAnalysis {
  totalMessages: number;
  /** 首条 user message 索引;`preserveFirstUserMessage=false` 时为 -1。 */
  firstUserMessageIndex: number;
  /** 首条 SKILL.md 读取所在 assistant 索引;空数组即未启用 / 未找到。 */
  firstSkillToolCallIndices: number[];
  /** Recent 窗口起点(尾部 N 条不动)。 */
  recentMessagesStartIndex: number;
  /**
   * 待压缩的中段范围(闭区间),null 表示中段为空。
   * `count = end - start + 1`。
   */
  middleMessagesRange: { start: number; end: number; count: number } | null;
  needsCompression: boolean;
}

export interface AnalyzeOptions {
  /** 尾部 N 条不参与压缩。 */
  preserveRecentMessages: number;
  /** 是否额外固定首条 user message。 */
  preserveFirstUserMessage: boolean;
  /** 是否额外固定首条 `read(skill.md)` 所在 assistant。 */
  preserveFirstSkillToolCall: boolean;
}

/**
 * 找出第一条携带 `read('xxx/skill.md')` 的 assistant。Domain 形态下 ToolCall.response
 * 嵌在 assistant 内,无需保护"sibling tool_results" —— 整条 assistant 作为不可分单元被
 * 锚点保护即可,所有 tool_calls 自然跟随。
 *
 * 返回数组形态(沿用旧接口)以适配 analyzeMessageStructure 中"protected indices"的 set 逻辑;
 * 新算法下数组永远只有 0 或 1 个元素。
 */
export function findFirstSkillToolCallIndices(messages: readonly Message[]): number[] {
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    if (msg.role !== 'assistant' || msg.tool_calls.length === 0) continue;

    const skillToolCall = msg.tool_calls.find(tc => {
      if (tc.name !== 'read') return false;
      const filePath = typeof tc.args?.path === 'string' ? tc.args.path : '';
      return filePath.toLowerCase().includes('skill.md');
    });

    if (skillToolCall) return [i];
  }

  return [];
}

/**
 * 分析消息结构,返回 head / middle / recent 三段的索引边界。
 *
 * 决策矩阵:
 * - 启用 `preserveFirstUserMessage` 且 firstUser < recentStart - 1 → 中段 = (firstUser+1, recentStart-1]
 * - 未启用 firstUser 锚点但 totalMessages > preserveRecent     → 中段 = [0, recentStart-1]
 * - 其它情形                                                   → 中段为空,无需压缩
 */
export function analyzeMessageStructure(
  messages: readonly Message[],
  opts: AnalyzeOptions,
): MessageStructureAnalysis {
  const totalMessages = messages.length;

  const firstUserMessageIndex = opts.preserveFirstUserMessage
    ? messages.findIndex(msg => msg.role === 'user')
    : -1;

  const firstSkillToolCallIndices = opts.preserveFirstSkillToolCall
    ? findFirstSkillToolCallIndices(messages)
    : [];

  const recentMessagesStartIndex = Math.max(0, totalMessages - opts.preserveRecentMessages);

  let middleMessagesRange: MessageStructureAnalysis['middleMessagesRange'] = null;
  let needsCompression = false;

  if (firstUserMessageIndex !== -1 && firstUserMessageIndex < recentMessagesStartIndex - 1) {
    middleMessagesRange = {
      start: firstUserMessageIndex + 1,
      end: recentMessagesStartIndex - 1,
      count: recentMessagesStartIndex - firstUserMessageIndex - 1,
    };
    needsCompression = middleMessagesRange.count > 0;
  } else if (firstUserMessageIndex === -1 && totalMessages > opts.preserveRecentMessages) {
    middleMessagesRange = {
      start: 0,
      end: recentMessagesStartIndex - 1,
      count: recentMessagesStartIndex,
    };
    needsCompression = middleMessagesRange.count > 0;
  }

  return {
    totalMessages,
    firstUserMessageIndex,
    firstSkillToolCallIndices,
    recentMessagesStartIndex,
    middleMessagesRange,
    needsCompression,
  };
}

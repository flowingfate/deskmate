/**
 * SubAgentChat — Sub-agent conversation runner built on top of pi.Session.
 *
 * 与主 chat 的差异（只保留 sub-agent 特化部分，其它走 pi 共用能力）：
 * - 不落盘：SubAgentSession 内部纯内存 messages 数组，进程退出即丢
 * - 不推 StreamingChunk 给 UI：onStepUpdate 走 SubAgentManager 的 IPC 通道
 * - 4 层 system prompt：identity + task + (workspace/skills/KB) + 父 context + operating rules + 动态 turn-progress hint
 * - 更激进的压缩：阈值 0.60（vs 主 chat 0.85）
 * - Phase 0 消息计数压缩：>20 条 → 头 15 条蒸馏为单条 summary
 * - 工具结果蒸馏：>15K char 的 tool result 走 haiku 摘要
 * - 工具白名单:走 `buildToolCatalogForSubAgent`(本地 `tools` / `disallowTools` + 外部 MCP selection)。**`app` 工具不再被按 name 移除** —— sub-agent 调 `app subagent ...` 时,命令内部 `ensureSpawnPrerequisites` 根据 `ctx.isSubAgent` 拒绝并 exit 1。
 * - Tool 执行打 isSubAgent=true,让 `app subagent spawn` / `spawn-many` 的递归保护生效
 * - follow-up guidance：单轮纯文本若像 "intent" 则注入 "Please execute…" 再跑一轮
 * - deliverables 跟踪：file output 类工具自动入册，结果末尾汇报
 *
 * 老 SubAgentChat 自带的 SSE 解析 / formatMessageForAPI / normalize-tool-calls /
 * detect-truncated / repair-arguments / sanitize-orphaned-tool-results 整条
 * fallback 链已删 —— pi-ai stream 已经把这些场景在底层处理掉。
 */

import * as path from 'path';

import type { AssistantMessage, Message, UserMessage } from '@shared/persist/types'
import type { SubAgentConfig } from '@shared/persist/types'
import { log } from '@main/log';
import { Tracer } from '@shared/log/trace';

import { wrapInSystemReminder } from '@main/pi/utils/systemReminderUtils';
import { getProfileSkillsDir } from '@main/persist/lib/path';
import { skillManager } from '../skill';
import { runUtilityCompletion } from '@main/pi/utility';
import { createUserMessage } from '@shared/utils/messageFactory';

import type { SubAgentChatOptions } from './types';
import { SubAgentSession, type SubAgentSessionHooks } from './subAgentSession';
import { buildToolCatalogForSubAgent, ToolCatalog } from '@main/pi/toolCatalog';
const logger = log;

// ---------------------------------------------------------------------------
// 行为常量
// ---------------------------------------------------------------------------

/** Phase 0 消息计数压缩。message 数超过 THRESHOLD 时把前 BATCH 条蒸馏为 1 条 summary。 */
const MSG_COUNT_THRESHOLD = 20;
const MSG_COUNT_BATCH = 15;
const MSG_COUNT_SUMMARIZE_MAX_TOKENS = 3000;
const MSG_COUNT_SUMMARIZE_TIMEOUT_MS = 20_000;

/** 工具结果蒸馏。tool result 字符串长度超过 SUMMARIZE_THRESHOLD 时调用 haiku 摘要。 */
const TOOL_RESULT_SUMMARIZE_THRESHOLD = 15_000;
const TOOL_RESULT_SUMMARIZE_MAX_TOKENS = 2_000;
const TOOL_RESULT_SUMMARIZE_TIMEOUT_MS = 15_000;
/** Hard fallback 截断（LLM 蒸馏失败时使用）。 */
const TOOL_RESULT_HARD_TRUNCATE_CHARS = 50_000;

/** 用于 Phase 0 / 工具结果蒸馏的 utility 模型。`provider::id` 复合 key。 */
const SUMMARIZE_MODEL_KEY = 'github-copilot::claude-haiku-4.5';

/** Sub-agent 默认 turn 上限（config 未提供 maxTurns 时兜底）。 */
const DEFAULT_MAX_TURNS = 25;

/** sub-agent 压缩阈值：比 0.85 主链激进，避免上下文被工具结果撑爆。 */
const SUB_AGENT_COMPRESSION_THRESHOLD = 0.60;

/** 触发自动 follow-up 的 intent 文本启发式。 */
const INTENT_PATTERNS: ReadonlyArray<RegExp> = [
  /\blet me\b/i,
  /\bi['']ll\b/i,
  /\bi will\b/i,
  /\blet['']s\b/i,
  /\bfirst[,\s]/i,
  /\bstep\s*1\b/i,
  /\bi['']m going to\b/i,
  /\bi['']m about to\b/i,
  /\bgather\b.*\binformation\b/i,
  /\bsearch\b.*\bfor\b/i,
  /\bI need to\b/i,
  /\bI should\b/i,
  /\bhere['']s my plan\b/i,
  /\bmy approach\b/i,
];

/**
 * 从 **args** 直接取产出文件 URI 的顶层 file-output 工具(`toolArgs.fileUri`)。
 * 目前仅 `write` —— 它是顶层 LocalTool,不走 shell 信封,产出靠 args 取。
 * `web download` 等 shell 命令的产出改走结构化 `ToolResult.deliverables` 回流
 * (见 `trackDeliverables`),不在此表。
 */
const FILE_OUTPUT_TOOLS: Record<string, true> = {
  write: true,
};

/** summarizeToolArgs 优先匹配的参数名。 */
const TOOL_ARG_PRIORITY_KEYS: ReadonlyArray<string> = [
  'query', 'url', 'path', 'fileUri', 'file_uri', 'command', 'content',
];

// ---------------------------------------------------------------------------
// 类型
// ---------------------------------------------------------------------------


/** 一轮执行后的结果摘要，供 wrapper 决策是否 follow-up。 */
interface TurnSummary {
  /** 最近一轮 assistant 的 text 内容（用于 UI step / follow-up 启发式）。 */
  textContent: string;
  /** 上一轮 pi 的 stopReason；'length' 表示 token 截断，要继续。 */
  stopReason: 'stop' | 'length' | 'toolUse' | 'aborted';
  /** 这一轮是否触发了 toolCall（即将进入新一轮）。 */
  hadToolCalls: boolean;
}

// ---------------------------------------------------------------------------
// 工具
// ---------------------------------------------------------------------------

/** 把文本按行数 + 字符数双重截断，用于 UI 摘要。 */
export function truncateToLines(text: string, maxLines: number, maxChars: number): string {
  if (!text) return '';
  const lines = text.split('\n').filter((l) => l.trim());
  const head = lines.slice(0, maxLines);
  let result = head.join('\n');
  if (result.length > maxChars) {
    result = result.substring(0, maxChars - 3) + '...';
  } else if (lines.length > maxLines) {
    result += '...';
  }
  return result;
}

// ---------------------------------------------------------------------------
// SubAgentChat
// ---------------------------------------------------------------------------

export class SubAgentChat {
  private readonly maxTurns: number;
  private readonly session: SubAgentSession;
  /** wrapper 已完成的对话轮数（不是 pi turn loop 内部 iteration）。 */
  private turnCount = 0;
  private disposed = false;
  /** 此次任务运行期间被 file output 类工具创建/写入的文件路径（去重）。 */
  private readonly deliverables: string[] = [];

  constructor(private readonly options: SubAgentChatOptions) {
    const cfg = options.subAgent.config;
    this.maxTurns = cfg.maxTurns ?? DEFAULT_MAX_TURNS;
    this.session = new SubAgentSession({
      profileId: options.profileId,
      agentId: options.subAgent.parentAgentId,
      sessionId: options.subAgent.parentSessionId,
      model: options.subAgent.inheritedModel,
      compressionThreshold: SUB_AGENT_COMPRESSION_THRESHOLD,
    });
  }

  // -------------------------------------------------------------------------
  // 主入口：跑完整 sub-agent 对话循环并返回最终 assistant 文本
  // -------------------------------------------------------------------------

  public async run(): Promise<string> {
    const catalog = await this.buildToolCatalog();
    const hasTools = catalog.specs.length > 0;
    const systemPromptBase = this.buildSystemPrompt();

    // 首条 user message：任务描述
    this.session.appendUserMessage(createUserMessage({ content: this.options.task }));

    let requireFollowUp = true;
    let consecutiveTextOnlyRounds = 0;

    while (requireFollowUp && this.turnCount < this.maxTurns) {
      // 取消信号在循环边界检查一次：避免 cancel 后还跑一次 Phase 0 压缩 + 一次 runOneTurn
      if (this.options.cancellationSignal.aborted) break;

      this.options.onStepUpdate?.({ type: 'turn_start', turn: this.turnCount + 1 });

      // Phase 0：消息计数压缩
      await this.compactByMessageCount();
      if (this.options.cancellationSignal.aborted) break;

      const transientReminder = wrapInSystemReminder(this.buildTurnProgressHint());

      logger.info({
        msg: '[SubAgentChat] Turn calling LLM',
        mod: 'run',
        subAgent: this.options.subAgent.config.name,
        turn: this.turnCount + 1,
        maxTurns: this.maxTurns,
        model: this.options.subAgent.inheritedModel,
        contextMsgs: this.session.snapshotMessages().length,
        tools: catalog.specs.length,
      });

      // 缺省 Tracer.noop —— sub-agent 在非主链路触发（命令行 / 测试）时仍写
      // chat.subturn 日志，只是没 tid/sid；不再让 trace 字段是否存在决定是否写。
      const subturnTracer = (this.options.tracer ?? Tracer.noop).derive().bind({
        mod: 'chat.subturn',
        subAgent: this.options.subAgent.config.name,
        turn: this.turnCount + 1,
      });
      log.info(subturnTracer.fields({ msg: 'subturn start' }));

      let summary: TurnSummary;
      try {
        summary = await this.runOneTurn(
          systemPromptBase,
          catalog,
          transientReminder,
          subturnTracer,
        );
      } catch (err) {
        log.error(subturnTracer.fields({ msg: 'subturn failed', err }, 'self'));
        throw err;
      }

      log.info(subturnTracer.fields({
        msg: 'subturn done',
        stopReason: summary.stopReason,
        hadToolCalls: summary.hadToolCalls,
        textLen: summary.textContent.length,
      }, 'self'));
      // 派发 text step
      if (summary.textContent) {
        this.options.onStepUpdate?.({
          type: 'text',
          turn: this.turnCount + 1,
          lastTextSnippet: truncateToLines(summary.textContent, 4, 500),
        });
      }

      this.turnCount++;
      this.options.onTurnComplete?.(this.turnCount, summary.textContent);

      // cancel / aborted：不再做 follow-up 判定，直接退出避免遗留 follow-up user message
      if (summary.stopReason === 'aborted' || this.options.cancellationSignal.aborted) break;

      // 决策下一步
      if (summary.hadToolCalls) {
        consecutiveTextOnlyRounds = 0;
        requireFollowUp = true;
        continue;
      }

      consecutiveTextOnlyRounds++;
      if (this.shouldContinueAfterTextResponse(summary, consecutiveTextOnlyRounds, hasTools)) {
        // 注入 follow-up 引导，下一轮 user message
        this.session.appendUserMessage(createUserMessage({
          content:
            'Please proceed with executing the task using the available tools. ' +
            'Do not just describe what you plan to do — actually use the tools to accomplish it now.',
        }));
        requireFollowUp = true;
      } else {
        requireFollowUp = false;
      }
    }

    return this.extractFinalResult();
  }

  public getTurnCount(): number {
    return this.turnCount;
  }

  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.session.dispose();
  }

  // -------------------------------------------------------------------------
  // 单轮执行：委派给 SubAgentSession，注入 hooks 处理 step update / tool 后处理
  // -------------------------------------------------------------------------

  private async runOneTurn(
    systemPrompt: string,
    catalog: ToolCatalog,
    transientReminder: string,
    tracer?: Tracer,
  ): Promise<TurnSummary> {
    const hooks: SubAgentSessionHooks = {
      onLlmStreaming: (text) => {
        this.options.onStepUpdate?.({
          type: 'llm_streaming',
          turn: this.turnCount + 1,
          streamingText: text,
        });
      },
      onToolStart: (toolCallId, toolName, toolArgs) => {
        this.options.onStepUpdate?.({
          type: 'tool_start',
          toolCallId,
          toolName,
          toolArgsSummary: this.summarizeToolArgs(toolName, toolArgs),
          turn: this.turnCount + 1,
        });
      },
      onToolDone: (toolCallId, toolName, durationMs, toolResultLength) => {
        this.options.onStepUpdate?.({
          type: 'tool_done',
          toolCallId,
          toolName,
          turn: this.turnCount + 1,
          durationMs,
          toolResultLength,
        });
      },
      onToolError: (toolCallId, toolName, durationMs) => {
        this.options.onStepUpdate?.({
          type: 'tool_error',
          toolCallId,
          toolName,
          turn: this.turnCount + 1,
          durationMs,
        });
      },
      onToolResultPostprocess: async (toolName, toolArgs, rawContent, deliverables) => {
        this.trackDeliverables(toolName, toolArgs, deliverables);
        return this.maybeCompressToolResult(toolName, rawContent);
      },
    };

    return this.session.runTurn({
      systemPrompt,
      transientReminder,
      catalog,
      signal: this.options.cancellationSignal,
      hooks,
      tracer,
    });
  }

  // -------------------------------------------------------------------------
  // follow-up 启发式
  // -------------------------------------------------------------------------

  private shouldContinueAfterTextResponse(
    summary: TurnSummary,
    consecutiveTextOnlyRounds: number,
    hasTools: boolean,
  ): boolean {
    // length：token 截断，继续
    if (summary.stopReason === 'length') return true;
    if (!hasTools) return false;
    if (consecutiveTextOnlyRounds >= 2) return false;
    if (consecutiveTextOnlyRounds === 1) {
      return this.looksLikeIntentNotResult(summary.textContent);
    }
    return false;
  }

  private looksLikeIntentNotResult(text: string): boolean {
    if (!text || text.length < 10) return false;
    return INTENT_PATTERNS.some((p) => p.test(text));
  }

  // -------------------------------------------------------------------------
  // System prompt 拼装（4 层）
  // -------------------------------------------------------------------------

  private buildSystemPrompt(): string {
    const { subAgent, task: _task, parentContext } = this.options;
    void _task;
    const config = subAgent.config;
    const parts: string[] = [];

    // Layer 1: identity
    parts.push(`# Sub-Agent: ${config.display_name}\n\n${config.system_prompt}`);

    // Layer 2: task context
    parts.push(
      '---\n## Current Task\n\n' +
      'You are a sub-agent working on a specific task delegated by the parent agent.\n' +
      'Complete the task thoroughly and return a clear, structured result.',
    );

    // Layer 2.5: workspace / skills / KB
    const workspaceBlock = this.buildWorkspaceAndSkillsInfo(config);
    if (workspaceBlock) parts.push(workspaceBlock);

    // Layer 3: parent context
    if (parentContext) {
      parts.push(
        '---\n## Parent Agent Context\n\n' +
        'The following context is provided by the parent agent:\n\n' +
        parentContext,
      );
    }

    // Layer 4: operating rules + deliverables hint + efficiency guidelines
    const rules: string[] = [
      '1. Focus exclusively on the assigned task',
      '2. Use available tools as needed to complete the task',
      '3. Return a clear, structured result when done',
      '4. If the task cannot be completed, explain why clearly',
      '5. Do NOT attempt to communicate with the user directly',
    ];
    const deliverablesPath = this.getDeliverablesPath();
    if (deliverablesPath) {
      rules.push(`6. When creating or saving files, use the deliverables directory: ${deliverablesPath}`);
      rules.push(
        '7. After creating files, always mention the file paths and a brief description of each ' +
        'file in your final response, so the parent agent knows what was produced',
      );
    }
    const efficiency = [
      '## Efficiency Guidelines',
      '',
      '- Plan your approach BEFORE executing. Batch related tool calls when possible.',
      '- Do NOT fetch entire web pages if a search result snippet already contains the answer.',
      '- When researching, gather the most important sources first, then synthesize results early.',
      '- If you have enough information to produce a useful result, do so immediately rather than searching for more.',
      '- Prefer concise, targeted tool calls over broad exploratory ones.',
    ].join('\n');

    parts.push(
      '---\n## Operating Rules\n\n' + rules.join('\n') + '\n\n' + efficiency,
    );

    return parts.join('\n\n');
  }

  private buildWorkspaceAndSkillsInfo(config: SubAgentConfig): string {
    const sections: string[] = [];
    const subAgent = this.options.subAgent;

    // Workspace
    if (config.workspace) {
      sections.push('---\n## Workspace\n\nYour workspace directory: ' + config.workspace);
    }

    // Skills（resolvedSkills 优先；空则回退 config.skills）
    const skillNames = subAgent.resolvedSkills.length > 0
      ? subAgent.resolvedSkills.map((s) => s.name)
      : (config.skills ?? []);

    if (skillNames.length > 0) {
      const skillSections: string[] = [];
      for (const skillName of skillNames) {
        try {
          const skillDir = path.join(getProfileSkillsDir(this.options.profileId), skillName);
          const { metadata } = skillManager.getSkillMetadata(skillDir);
          if (metadata) {
            const skillMdPath = path.join(skillDir, 'skill.md');
            const inherited = subAgent.resolvedSkills.find((s) => s.name === skillName)?.inherited;
            const tag = inherited ? ' (inherited from parent)' : '';
            skillSections.push(
              `### Skill: ${skillName}${tag}\n` +
              `- Description: ${metadata.description ?? 'No description'}\n` +
              `- File Path: \`${skillMdPath}\``,
            );
          }
        } catch {
          // 非致命：单个 skill 解析失败不阻塞 sub-agent
        }
      }
      if (skillSections.length > 0) {
        sections.push('---\n## Available Skills\n\n' + skillSections.join('\n\n'));
      }
    }

    // Knowledge base
    const kbPath = subAgent.resolvedKnowledgeBase;
    if (kbPath) {
      sections.push(
        '---\n## Knowledge Base\n\nYour knowledge base directory: ' + kbPath + '\n' +
        'You can read files from this directory for context and reference information.',
      );
    }

    return sections.join('\n\n');
  }

  // -------------------------------------------------------------------------
  // 动态 turn progress hint
  // -------------------------------------------------------------------------

  private buildTurnProgressHint(): string {
    const currentTurn = this.turnCount + 1; // 1-based
    const remaining = this.maxTurns - this.turnCount;

    if (currentTurn <= 1) {
      return `[Turn ${currentTurn}/${this.maxTurns}] You have ${this.maxTurns} turns total. Aim to finish within ${this.maxTurns} turns.`;
    }
    if (remaining <= 3) {
      return `[Turn ${currentTurn}/${this.maxTurns}] ⚠️ ONLY ${remaining} turn(s) remaining! You MUST produce your final result NOW. Do NOT start new research.`;
    }
    return `[Turn ${currentTurn}/${this.maxTurns}] ${remaining} turns remaining (budget: ${this.maxTurns}). Stay efficient.`;
  }

  // -------------------------------------------------------------------------
  // Phase 0：消息计数压缩
  // -------------------------------------------------------------------------

  private async compactByMessageCount(): Promise<void> {
    if (this.options.cancellationSignal.aborted) return;
    const messages = this.session.snapshotMessages();
    if (messages.length <= MSG_COUNT_THRESHOLD) return;

    let batch = Math.min(MSG_COUNT_BATCH, messages.length - 1);
    batch = this.adjustBatchBoundaryForToolPairs(messages, batch);
    if (batch <= 0 || batch >= messages.length) return;

    const early = messages.slice(0, batch);
    const conversationText = early.map((msg, idx) => {
      const role = msg.role.toUpperCase();
      const text = msg.content;
      const truncated = text.length > 2000 ? text.substring(0, 2000) + '...[truncated]' : text;
      // Domain assistant 自带 tool_calls(包含 response);在摘要中把 tool 名 + 是否
      // 成功一起列出,让 LLM 抓住"曾经调过什么工具、结果走向"。
      const toolCallsSection =
        msg.role === 'assistant' && msg.tool_calls.length > 0
          ? '\n  [Tool calls: ' +
            msg.tool_calls
              .map((tc) => `${tc.name}${tc.response ? `(${tc.response.status})` : '(no-result)'}`)
              .join(', ') +
            ']'
          : '';
      return `[${idx + 1}] ${role}: ${truncated}${toolCallsSection}`;
    }).join('\n\n');

    let summaryText: string | null = null;
    try {
      const summaryPromise = runUtilityCompletion({
        modelKey: SUMMARIZE_MODEL_KEY,
        profileId: this.options.profileId,
        systemPrompt:
          'You are a precise conversation summarizer. Create a structured summary of the sub-agent ' +
          'conversation progress. Output only the summary in a clear, organized format. Use sections with headers.',
        userPrompt:
          'Below is the early conversation history of a sub-agent working on a task. ' +
          'Summarize the KEY PROGRESS and FINDINGS so far into a concise structured summary.\n\n' +
          'Preserve:\n' +
          '- What tools were called and their key results\n' +
          '- Important data, URLs, file paths, code discovered\n' +
          '- Decisions made and current progress status\n' +
          '- Any errors encountered and how they were handled\n\n' +
          'Discard:\n' +
          '- Verbatim tool output details (keep only key findings)\n' +
          '- Repetitive or redundant information\n' +
          '- Raw HTML/CSS/JS content\n\n' +
          `CONVERSATION HISTORY:\n${conversationText}`,
        maxTokens: MSG_COUNT_SUMMARIZE_MAX_TOKENS,
        temperature: 0.2,
      });
      const timeoutPromise = new Promise<string>((resolve) =>
        setTimeout(() => resolve(''), MSG_COUNT_SUMMARIZE_TIMEOUT_MS),
      );
      const result = await Promise.race([summaryPromise, timeoutPromise]);
      if (result && result.length > 0) summaryText = result;
    } catch (err) {
      logger.warn({
        msg: '[SubAgentChat] Phase 0 LLM summarize failed; using truncation fallback',
        err: err instanceof Error ? err.message : String(err),
      });
    }

    if (!summaryText) {
      summaryText = this.buildFallbackSummary(early);
    }

    const summaryMessage: UserMessage = createUserMessage({
      content: `[Context Summary — compressed from ${batch} earlier messages]\n\n${summaryText}`,
    });
    this.session.replaceHead(batch, summaryMessage);
  }

  /**
   * 把分批边界往后扩,避免把 assistant(tool_calls) 与对应 tool result 拆开。
   *
   * Domain 形态下 tool response 折回 ToolCall.response 与 assistant 同一条消息;
   * 不会出现"裸 tool 行紧跟 assistant"这种 chatTypes 模型下的边界问题。本函数
   * 现状只需保证不在 assistant w/ tool_calls 之后立刻切边(LLM 看不到工具结果)。
   * 实际上 Domain 中工具结果 *物理* 与 assistant 同行,所以这个修正基本是 no-op,
   * 保留 method 形态便于后续策略迭代。
   */
  private adjustBatchBoundaryForToolPairs(messages: Message[], batchSize: number): number {
    const adjusted = batchSize;
    return Math.min(adjusted, messages.length - 1);
  }

  private buildFallbackSummary(early: Message[]): string {
    const fallback = early.map((msg) => {
      const role = msg.role;
      const text = msg.content;
      return `[${role}]: ${text.substring(0, 500)}`;
    }).join('\n');
    const max = 5_000;
    const truncated = fallback.length > max ? fallback.substring(0, max) + '\n...[truncated]' : fallback;
    return truncated;
  }

  // -------------------------------------------------------------------------
  // 工具结果蒸馏
  // -------------------------------------------------------------------------

  private async maybeCompressToolResult(toolName: string, content: string): Promise<string> {
    const originalLength = content.length;
    if (originalLength <= TOOL_RESULT_SUMMARIZE_THRESHOLD) return content;
    // cancel 后不再为已 abort 的会话烧 haiku 配额 —— 直接 hard truncate
    if (this.options.cancellationSignal.aborted) {
      return this.hardTruncateToolResult(content, toolName, originalLength);
    }

    const inputForLlm = originalLength > TOOL_RESULT_HARD_TRUNCATE_CHARS
      ? content.substring(0, TOOL_RESULT_HARD_TRUNCATE_CHARS)
      : content;

    try {
      const summaryPromise = runUtilityCompletion({
        modelKey: SUMMARIZE_MODEL_KEY,
        profileId: this.options.profileId,
        systemPrompt:
          'You are a precise information extractor. Summarize tool output concisely while preserving ' +
          'all actionable information. Output only the summary, no explanations.',
        userPrompt:
          `Below is the output from a tool called "${toolName}". ` +
          `Extract and summarize the KEY INFORMATION that would be useful for completing the user's task. ` +
          `Preserve:\n` +
          `- Important facts, data points, and findings\n` +
          `- URLs, file paths, code snippets, and structured data\n` +
          `- Error messages or warnings\n` +
          `Discard:\n` +
          `- HTML/CSS/JS boilerplate, navigation menus, ads, footers\n` +
          `- Redundant or repetitive content\n` +
          `- Raw markup/styling\n\n` +
          `TOOL OUTPUT:\n${inputForLlm}`,
        maxTokens: TOOL_RESULT_SUMMARIZE_MAX_TOKENS,
        temperature: 0.2,
      });
      const timeoutPromise = new Promise<string>((resolve) =>
        setTimeout(() => resolve(''), TOOL_RESULT_SUMMARIZE_TIMEOUT_MS),
      );
      const summary = await Promise.race([summaryPromise, timeoutPromise]);
      if (summary && summary.length > 0) {
        return `[Summarized from ${originalLength} chars by ${SUMMARIZE_MODEL_KEY}]\n\n${summary}`;
      }
    } catch (err) {
      logger.warn({
        msg: '[SubAgentChat] tool result LLM summarize failed; using truncation fallback',
        toolName,
        err: err instanceof Error ? err.message : String(err),
      });
    }

    return this.hardTruncateToolResult(content, toolName, originalLength);
  }

  private hardTruncateToolResult(content: string, toolName: string, originalLength: number): string {
    return content.substring(0, TOOL_RESULT_HARD_TRUNCATE_CHARS) +
      `\n\n[... content truncated from ${originalLength} chars to ${TOOL_RESULT_HARD_TRUNCATE_CHARS} chars. ` +
      `The full result was too large for sub-agent context. Tool: ${toolName} ...]`;
  }

  // -------------------------------------------------------------------------
  // 工具列表(本地 `tools` 白名单 + `disallowTools` 黑名单 + 外部 MCP 选择)
  // -------------------------------------------------------------------------

  private async buildToolCatalog(): Promise<ToolCatalog> {
    try {
      const subAgent = this.options.subAgent;
      const config = subAgent.config;
      // resolvedMcpServers 已经是按 inherit / 黑白名单计算后的最终 selection;
      // 缺省时回退到 sub-agent 原始 mcpServers 配置（normalize string-ref → {name, tools}）。
      const mcpSelections = subAgent.resolvedMcpServers.length > 0
        ? subAgent.resolvedMcpServers.map((s) => ({ name: s.name, tools: s.tools }))
        : (config.mcpServers ?? []).map((s) =>
            typeof s === 'string' ? { name: s, tools: [] } : { name: s.name, tools: s.tools ?? [] }
          );
      return await buildToolCatalogForSubAgent(
        { tools: config.tools, disallowTools: config.disallowTools },
        mcpSelections,
      );
    } catch (err) {
      logger.error({
        msg: '[SubAgentChat] Failed to build tool catalog',
        err: err instanceof Error ? err.message : String(err),
      });
      return ToolCatalog.empty();
    }
  }

  // -------------------------------------------------------------------------
  // 工具参数 UI 摘要
  // -------------------------------------------------------------------------

  private summarizeToolArgs(toolName: string, toolArgs: Record<string, unknown>): string {
    const MAX_LEN = 200;
    try {
      for (const key of TOOL_ARG_PRIORITY_KEYS) {
        const v = toolArgs[key];
        if (typeof v === 'string' && v.length > 0) {
          const s = `${toolName}: ${v}`;
          return s.length > MAX_LEN ? s.substring(0, MAX_LEN - 3) + '...' : s;
        }
      }
      for (const [, v] of Object.entries(toolArgs)) {
        if (typeof v === 'string' && v.length > 0) {
          const s = `${toolName}: ${v}`;
          return s.length > MAX_LEN ? s.substring(0, MAX_LEN - 3) + '...' : s;
        }
      }
      return toolName;
    } catch {
      return toolName;
    }
  }

  // -------------------------------------------------------------------------
  // deliverables 跟踪
  // -------------------------------------------------------------------------

  private trackDeliverables(
    toolName: string,
    toolArgs: Record<string, unknown>,
    deliverables?: readonly string[],
  ): void {
    try {
      // 1. 结构化回流:shell 命令(`web download` 等)经 `ToolResult.deliverables`
      //    显式登记产出 —— toolName 无关,直接入册。这是产出型 shell 命令的
      //    唯一可靠来源(cmd 字符串是黑盒,不解析)。
      if (deliverables) {
        for (const uri of deliverables) {
          if (uri && !this.deliverables.includes(uri)) this.deliverables.push(uri);
        }
      }

      // 2. 顶层 file-output 工具(目前仅 `write`):从 args 直接取 fileUri。
      //    它不走 shell 信封,没有结构化 deliverables 回流。
      if (FILE_OUTPUT_TOOLS[toolName]) {
        const fp = readStringArg(toolArgs, 'fileUri') ?? readStringArg(toolArgs, 'file_uri');
        if (fp && !this.deliverables.includes(fp)) this.deliverables.push(fp);
      }

      // `present_deliverables` 工具已下线 —— UI 兜底是 LLM 在最终回复文字里
      // 直接提到产出的 URI,renderer 端通过 `extractFilePathsFromText` 抽取。
      // 后台审计仍依赖上面两条自动跟踪,父 agent 拿到的 `Deliverables` 段不变。
    } catch {
      // 非致命:跟踪失败不影响主流程
    }
  }

  private formatDeliverablesSection(): string {
    if (this.deliverables.length === 0) return '';
    const fileList = this.deliverables.map((fp) => `- ${fp}`).join('\n');
    return `\n\n---\n**Deliverables** (${this.deliverables.length} file(s) created/modified):\n${fileList}`;
  }

  // -------------------------------------------------------------------------
  // 取最终 assistant text
  // -------------------------------------------------------------------------

  private extractFinalResult(): string {
    const messages = this.session.snapshotMessages();
    let resultText = '';
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      if (msg.role === 'assistant') {
        const text = (msg as AssistantMessage).content;
        if (text) {
          const warning = this.turnCount >= this.maxTurns
            ? `\n\n⚠️ Sub-agent reached max turns limit (${this.maxTurns}). Result may be incomplete.`
            : '';
          resultText = text + warning;
          break;
        }
      }
    }
    if (!resultText) {
      resultText = this.turnCount >= this.maxTurns
        ? `Sub-agent reached max turns limit (${this.maxTurns}) without producing a text result.`
        : 'Sub-agent completed without producing a text result.';
    }
    return resultText + this.formatDeliverablesSection();
  }

  private getDeliverablesPath(): string | null {
    if (this.options.deliverablesPath) return this.options.deliverablesPath;
    if (this.options.subAgent.config.workspace) return this.options.subAgent.config.workspace;
    return null;
  }
}

// ---------------------------------------------------------------------------
// 局部 helpers（typed unknown 读取）
// ---------------------------------------------------------------------------

function readStringArg(args: Record<string, unknown>, key: string): string | undefined {
  const v = args[key];
  return typeof v === 'string' ? v : undefined;
}


import type {
  AssistantMessage as PiAssistantMessage,
  ImageContent as PiImageContent,
  Message as PiMessage,
  TextContent as PiTextContent,
  ToolCall as PiToolCall,
} from '@earendil-works/pi-ai';
import type { DoctorInquiryPayload } from '@shared/ipc/doctor';

import { log } from '@main/log';
import { MAX_TURNS, TOOL_DEFINITIONS, SYSTEM_PROMPT } from './agentConfig';
import { executeTool } from './toolExecutor';
import { clearDebugLog, appendDebugLog } from './log';
import { callDoctorLlm } from './llmClient';
import type { ProfileStore } from '@main/persist';
import type { DoctorTask } from './task';
import {
  compressImageFirstPass,
  MAX_IMAGE_BYTES_FOR_INLINE,
  MAX_COMPRESSED_IMAGE_BYTES_FOR_INLINE,
} from '../utilities/imageStorageCompression';

const SUPPORTED_IMAGE_MIME: Record<string, true> = {
  'image/png': true,
  'image/jpeg': true,
  'image/gif': true,
  'image/webp': true,
  'image/bmp': true,
};

const logger = log;

export type RunResult =
  | { success: true; issueUrl: string }
  | { success: false; error: string };


/** Tool name → one-line step description (auto-pushed to UI by the runner). */
const TOOL_STEP_INFO: Record<string, string> = {
  get_app_info: 'Collecting runtime environment info...',
  get_app_knowledge: 'Loading app knowledge base...',
  read_app_logs: 'Querying application logs...',
  read_chat_session: 'Fetching session skeleton...',
  get_chat_messages: 'Reading conversation messages...',
  get_crash_status: 'Checking for crash reports...',
  read_crash_bundle: 'Reading crash bundle details...',
  read_schedules: 'Inspecting scheduled jobs...',
  ask_user_question: 'Waiting for your answer...',
  create_github_issue: 'Generating diagnostic report...',
};

/** 把 assistant message 里所有 text 块拼成一段纯文本（用于 debug log 摘要）。 */
function assistantText(msg: PiAssistantMessage): string {
  let text = '';
  for (const block of msg.content) {
    if (block.type === 'text') text += block.text;
  }
  return text;
}

/** 抽出 assistant message 里的 toolCall 块。 */
function toolCallsOf(msg: PiAssistantMessage): PiToolCall[] {
  return msg.content.filter((b): b is PiToolCall => b.type === 'toolCall');
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new Error('Doctor task cancelled.');
}

export class DoctorAgentRunner {
  public constructor(private readonly store: ProfileStore) {}

  public async run(
    payload: DoctorInquiryPayload,
    task: DoctorTask,
  ): Promise<RunResult> {
    const { id: taskId, signal } = task;
    throwIfAborted(signal);
    clearDebugLog(taskId);
    appendDebugLog(taskId, 'Agent Started', `**TaskId:** ${taskId}\n**MaxTurns:** ${MAX_TURNS}`);
    task.pushStepInfo('Preparing analysis...');

    // 全程 pi 原生 message；system prompt 由 pi.Context.systemPrompt 承载，不入 messages。
    const messages: PiMessage[] = [await this.buildUserMessage(payload, taskId)];

    appendDebugLog(
      taskId,
      'User Bug Report',
      `**Description:** ${payload.description}\n` +
      `**Steps:** ${payload.stepsToReproduce}\n` +
      `**OccurredAt:** ${payload.occurredAt}\n` +
      `**AgentId:** ${payload.agentId || 'N/A'}\n` +
      `**SessionId:** ${payload.chatSessionId || 'N/A'}\n` +
      `**Screenshots:** ${payload.screenshots?.length || 0}`,
    );

    let issueUrl: string | undefined;

    task.pushStepInfo('Thinking...');
    for (let turn = 0; turn < MAX_TURNS; turn++) {
      throwIfAborted(signal);
      logger.info({ msg: `[DoctorAgent] Turn ${turn + 1}/${MAX_TURNS}`, mod: 'run' });
      appendDebugLog(taskId, `Turn ${turn + 1}/${MAX_TURNS}`, 'Calling LLM...');

      const response = await callDoctorLlm(this.store.id, SYSTEM_PROMPT, messages, TOOL_DEFINITIONS, payload.modelKey, signal);
      throwIfAborted(signal);
      const toolCalls = toolCallsOf(response);
      const content = assistantText(response);

      appendDebugLog(
        taskId,
        `LLM Response (Turn ${turn + 1})`,
        `**StopReason:** ${response.stopReason}\n` +
        `**Content:** ${content ? content.slice(0, 500) + (content.length > 500 ? '...' : '') : '(none)'}\n` +
        `**ToolCalls:** ${toolCalls.length}`,
      );

      // pi.AssistantMessage 直接进 history —— 不重建、不丢 usage/provider。
      messages.push(response);

      // Termination condition: no tool_calls
      if (toolCalls.length === 0) {
        logger.info({ msg: '[DoctorAgent] Agent finished (no more tool calls)', mod: 'run' });
        appendDebugLog(taskId, 'Agent Finished', 'No more tool calls.');
        break;
      }

      // Execute tools sequentially
      for (const toolCall of toolCalls) {
        const { name, arguments: args } = toolCall;

        const stepText = TOOL_STEP_INFO[name] ?? `Running ${name}...`;
        task.pushStepInfo(stepText);

        appendDebugLog(taskId, `Tool Call: ${name}`, `**Args:**\n\`\`\`json\n${JSON.stringify(args, null, 2)}\n\`\`\``);

        const result = await executeTool(name, args, { task, store: this.store });
        throwIfAborted(signal);

        appendDebugLog(
          taskId,
          `Tool Result: ${name}`,
          `\`\`\`\n${result.slice(0, 2000)}${result.length > 2000 ? '\n...(truncated)' : ''}\n\`\`\``,
        );

        if (name === 'create_github_issue') {
          try {
            const parsed = JSON.parse(result);
            if (parsed.issueUrl) {
              issueUrl = parsed.issueUrl;
              appendDebugLog(taskId, 'Issue Created', `**URL:** ${issueUrl}`);
            }
          } catch { /* ignore */ }
        }

        messages.push({
          role: 'toolResult',
          toolCallId: toolCall.id,
          toolName: name,
          content: [{ type: 'text', text: result }],
          isError: false,
          timestamp: Date.now(),
        });
      }
    }

    if (issueUrl) {
      appendDebugLog(taskId, 'Run Complete', `**Success:** true\n**IssueUrl:** ${issueUrl}`);
      return { success: true, issueUrl };
    }

    appendDebugLog(taskId, 'Run Complete', '**Success:** false — Agent did not create a GitHub issue.');
    return { success: false, error: 'Agent completed but did not create a GitHub issue.' };
  }

  private async buildUserMessage(payload: DoctorInquiryPayload, taskId: string): Promise<PiMessage> {
    let text = `## Bug Report\n\n`;
    text += `**Description:**\n${payload.description}\n\n`;
    text += `**Steps to Reproduce:**\n${payload.stepsToReproduce}\n\n`;
    text += `**When It Last Occurred (user's words):**\n${payload.occurredAt}\n\n`;

    if (payload.agentId) {
      text += `**Affected Agent ID:** ${payload.agentId}\n\n`;
    }
    if (payload.chatSessionId) {
      text += `**Affected Chat Session ID:** ${payload.chatSessionId}\n\n`;
    }

    if (payload.screenshots && payload.screenshots.length > 0) {
      const images: PiImageContent[] = [];
      const skippedNotes: string[] = [];

      for (const shot of payload.screenshots) {
        const rawMime = (shot.mimeType || 'image/png').toLowerCase();
        const inputMime = SUPPORTED_IMAGE_MIME[rawMime] ? rawMime : 'image/png';
        const originalBytes = shot.bytes.byteLength;

        if (originalBytes > MAX_IMAGE_BYTES_FOR_INLINE) {
          const note = `[Screenshot "${shot.name}" is too large (${Math.round(originalBytes / 1024 / 1024)}MB); inline embedding was skipped.]`;
          skippedNotes.push(note);
          appendDebugLog(taskId, 'Screenshot Skipped (too large)', `**Name:** ${shot.name}\n**Size:** ${originalBytes} bytes`);
          continue;
        }

        const rawBase64 = Buffer.from(shot.bytes).toString('base64');
        try {
          const compressed = await compressImageFirstPass(rawBase64, inputMime, {
            maxDimension: 2048,
            targetShortSide: 768,
            quality: 80,
          });
          if (compressed.compressedSize > MAX_COMPRESSED_IMAGE_BYTES_FOR_INLINE) {
            const note = `[Screenshot "${shot.name}" is still too large after compression (${Math.round(compressed.compressedSize / 1024 / 1024)}MB); inline embedding was skipped.]`;
            skippedNotes.push(note);
            appendDebugLog(taskId, 'Screenshot Skipped (post-compress)', `**Name:** ${shot.name}\n**Compressed:** ${compressed.compressedSize} bytes`);
            continue;
          }
          appendDebugLog(
            taskId,
            'Screenshot Compressed',
            `**Name:** ${shot.name}\n` +
              `**Original:** ${compressed.originalSize} bytes (${inputMime})\n` +
              `**Compressed:** ${compressed.compressedSize} bytes (${compressed.mimeType}, ${compressed.width}x${compressed.height})`,
          );
          images.push({
            type: 'image',
            data: compressed.base64Data,
            mimeType: compressed.mimeType,
          });
        } catch (err) {
          const note = `[Screenshot "${shot.name}" compression failed; inline embedding was skipped.]`;
          skippedNotes.push(note);
          appendDebugLog(
            taskId,
            'Screenshot Compression Failed',
            `**Name:** ${shot.name}\n**Error:** ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }

      text += `\n**Screenshots:** ${images.length} of ${payload.screenshots.length} screenshot(s) embedded above.\n`;
      if (skippedNotes.length > 0) {
        text += skippedNotes.map((n) => `- ${n}`).join('\n') + '\n';
      }

      const content: (PiTextContent | PiImageContent)[] = [{ type: 'text', text }, ...images];
      return { role: 'user', content, timestamp: Date.now() };
    }

    return { role: 'user', content: text, timestamp: Date.now() };
  }
}

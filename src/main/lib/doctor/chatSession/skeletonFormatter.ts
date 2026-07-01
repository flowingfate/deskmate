/**
 * L1 skeleton formatter: convert a DoctorSessionFile into compact markdown.
 *
 * Output contains a Header and 3 tables (messages / attachments / tool_calls).
 * All fields are preserved; long content like text/think/arguments/base64 image data is shown
 * only as a length number.
 *
 * Domain Message 形态:top-level 只有 user/assistant;`user.attachments[]` 列出图片/文件,
 * `assistant.tool_calls[]` 列出工具调用 (并把 response 折在内部)。
 */

import type { Message, ToolCall, Attachment } from '@shared/types/message';
import { truncateMiddle } from './truncate';
import type { DoctorSessionFile, SkeletonOptions } from './types';

const TITLE_MAX_CHARS = 200;

const MESSAGE_COLS = [
  '#',
  'id',
  'role',
  'time',
  'content.len',
  'think.len',
  'attachments',
  'tool_calls',
  'outcome',
  'model',
  'usage.input',
  'usage.output',
  'usage.cacheR',
  'usage.cacheW',
  'usage.total',
] as const;

const ATTACHMENT_COLS = [
  'msg#',
  'attach#',
  'kind',
  'fileName',
  'fileSize',
  'mimeType',
  'image.width',
  'image.height',
  'image.source.kind',
  'image.detail',
  'file.fileUri',
  'file.lines',
  'file.pages',
  'file.lastModified',
  'file.encoding',
  'file.detail',
  'file.truncated',
  'opaque.fileExtension',
  'opaque.description',
] as const;

const TOOL_CALL_COLS = [
  'msg#',
  'call#',
  'id',
  'name',
  'time',
  'args.len',
  'response.status',
  'response.result.len',
  'response.time',
] as const;

export function formatSkeleton(file: DoctorSessionFile, opts: SkeletonOptions = {}): string {
  if (!file || typeof file !== 'object') {
    return '## Error\n\nformatSkeleton received an invalid session file (not an object).';
  }

  const messages = Array.isArray(file.messages) ? file.messages : [];
  const contextState = file.contextState ?? { compressions: [] };

  const out: string[] = [];

  out.push('## Session');
  out.push(`- chatSession_id: ${file.chatSession_id ?? ''}`);
  out.push(`- title: ${escapeCell(truncateMiddle(file.title ?? '', TITLE_MAX_CHARS))}`);
  out.push(`- last_updated: ${file.last_updated ?? ''}`);
  out.push(`- messages.length: ${messages.length}`);
  out.push(`- contextState.compressions: ${contextState.compressions.length > 0 ? contextState.compressions.map((c, i) => `[${i}] ep=${c.earlyPreservedCount} cbi=${c.compressedBeforeIndex}`).join(', ') : 'none'}`);
  out.push('');

  out.push('## messages');
  out.push(...formatHistorySection(messages));

  const body = out.join('\n');
  const originalBytes = Buffer.byteLength(JSON.stringify(file), 'utf8');
  const skeletonBytes = Buffer.byteLength(body, 'utf8');
  const ratio = originalBytes > 0 ? ((skeletonBytes / originalBytes) * 100).toFixed(1) : '0.0';

  const banner = [
    '<!--',
    `  Original JSON size: ${originalBytes} bytes (${(originalBytes / 1024).toFixed(1)} KB)`,
    `  Skeleton size:      ${skeletonBytes} bytes (${(skeletonBytes / 1024).toFixed(1)} KB)`,
    `  Compression ratio:  ${ratio}% of original`,
    '-->',
  ].join('\n');

  return [banner, READING_GUIDE, body].join('\n\n');
}

const READING_GUIDE = `## Reading Guide

A skeleton of one chat session in **Domain Message** form. All fields preserved; long content
(text, base64 images, tool-call args, tool results) replaced by length numbers. Use this to
locate suspicious messages, then call \`get_chat_messages\` with their indices to read real content.

### Domain shape recap
- Top-level messages are only \`user\` / \`assistant\`. There is no separate \`tool\` / \`system\` role.
- A \`user\` message carries plain string \`content\` plus an \`attachments[]\` array of
  image / file / office / opaque entries.
- An \`assistant\` message carries \`content\` (string), \`think\` (reasoning string),
  \`tool_calls[]\` (each ToolCall holds its own \`response\` once executed), \`outcome\`,
  \`model\`, \`usage\`.
- Tool results live **inside** \`assistant.tool_calls[i].response\` — they are not separate rows
  in the messages table.

### Tables
- **messages**: one row per message. Primary table.
- **attachments**: one row per \`user.attachments[i]\`. Joined via \`msg#\`.
- **tool calls**: one row per \`assistant.tool_calls[i]\`. Joined via \`msg#\`.

### Conventions
- Column names mirror Domain field paths.
- The attachments table is the union of fields across all attachment kinds; cells not applicable
  to the row's \`kind\` are empty. Empty cell = \`undefined\` / \`null\` / not applicable.
- \`*.len\` columns = original length in chars; the body itself is gone. Image base64 \`source.data\`
  is never shown (size/dims/name are). To read any of these, call \`get_chat_messages\`
  (≤10 indices/call; long fields then truncated head 60% + tail 40%).

### messages vs contextState
- \`messages\` = the single authoritative conversation history. \`contextState\` records how the LLM context
  differs from it: \`compression\` (summary + preserved ranges).
- A message at index in \`[earlyPreservedCount, compressedBeforeIndex)\` of the top compression was
  compressed into the summary.
- \`get_chat_messages\` with \`view='llm'\` returns \`status: 'dropped'\` when a message was compressed away.
  Worth flagging in the Issue.`;

function formatHistorySection(history: Message[]): string[] {
  const messageRows = history.map((msg, idx) => formatMessageRow(msg, idx));

  const attachmentRows: string[][] = [];
  const toolCallRows: string[][] = [];
  history.forEach((msg, msgIdx) => {
    if (msg.role === 'user') {
      (msg.attachments ?? []).forEach((att, attIdx) => {
        attachmentRows.push(formatAttachmentRow(att, msgIdx, attIdx));
      });
    } else {
      (msg.tool_calls ?? []).forEach((call, callIdx) => {
        toolCallRows.push(formatToolCallRow(call, msgIdx, callIdx));
      });
    }
  });

  return [
    '### messages',
    renderTable(MESSAGE_COLS, messageRows),
    '',
    '### attachments',
    renderTable(ATTACHMENT_COLS, attachmentRows),
    '',
    '### tool calls',
    renderTable(TOOL_CALL_COLS, toolCallRows),
  ];
}

function formatMessageRow(msg: Message, idx: number): string[] {
  let thinkLen = '';
  let attachments = '';
  let toolCalls = '';
  let outcome = '';
  let model = '';
  let usageInput = '';
  let usageOutput = '';
  let usageCacheR = '';
  let usageCacheW = '';
  let usageTotal = '';

  if (msg.role === 'user') {
    const list = msg.attachments ?? [];
    attachments = list.length === 0 ? '' : `${list.length}:${list.map((a) => a.kind).join(',')}`;
  } else {
    thinkLen = String((msg.think ?? '').length);
    const calls = msg.tool_calls ?? [];
    toolCalls = calls.length === 0 ? '' : `${calls.length}:${calls.map((c) => c.name).join(',')}`;
    outcome = msg.outcome ? msg.outcome.kind : '';
    model = msg.model ?? '';
    usageInput = strOrEmpty(msg.usage?.in);
    usageOutput = strOrEmpty(msg.usage?.out);
    usageCacheR = strOrEmpty(msg.usage?.cache[0]);
    usageCacheW = strOrEmpty(msg.usage?.cache[1]);
    usageTotal = strOrEmpty(msg.usage?.total);
  }

  return [
    String(idx),
    msg.id ?? '',
    msg.role,
    String(msg.time),
    String((msg.content ?? '').length),
    thinkLen,
    attachments,
    toolCalls,
    outcome,
    model,
    usageInput,
    usageOutput,
    usageCacheR,
    usageCacheW,
    usageTotal,
  ];
}

function formatAttachmentRow(att: Attachment, msgIdx: number, attIdx: number): string[] {
  const row: Record<(typeof ATTACHMENT_COLS)[number], string> = Object.fromEntries(
    ATTACHMENT_COLS.map((c) => [c, '']),
  ) as Record<(typeof ATTACHMENT_COLS)[number], string>;

  row['msg#'] = String(msgIdx);
  row['attach#'] = String(attIdx);
  row['kind'] = att.kind;
  row['fileName'] = att.fileName ?? '';
  row['fileSize'] = strOrEmpty(att.fileSize);
  row['mimeType'] = att.mimeType ?? '';

  switch (att.kind) {
    case 'image': {
      row['image.width'] = strOrEmpty(att.width);
      row['image.height'] = strOrEmpty(att.height);
      row['image.source.kind'] = att.source.kind;
      row['image.detail'] = strOrEmpty(att.detail);
      break;
    }
    case 'text':
    case 'office': {
      row['file.fileUri'] = att.fileUri;
      row['file.lines'] = strOrEmpty(att.lines);
      row['file.pages'] = strOrEmpty(att.kind === 'office' ? att.pages : undefined);
      row['file.lastModified'] = strOrEmpty(att.lastModified);
      row['file.encoding'] = strOrEmpty(att.encoding);
      row['file.detail'] = strOrEmpty(att.detail);
      row['file.truncated'] = strOrEmpty(att.truncated);
      break;
    }
    case 'opaque': {
      row['file.fileUri'] = att.fileUri;
      row['opaque.fileExtension'] = strOrEmpty(att.fileExtension);
      row['opaque.description'] = strOrEmpty(att.description);
      break;
    }
  }

  return ATTACHMENT_COLS.map((c) => row[c]);
}

function formatToolCallRow(call: ToolCall, msgIdx: number, callIdx: number): string[] {
  let argsLen = '0';
  try {
    argsLen = String(JSON.stringify(call.args ?? {}).length);
  } catch {
    argsLen = '?';
  }
  const r = call.response;
  return [
    String(msgIdx),
    String(callIdx),
    call.id ?? '',
    call.name ?? '',
    strOrEmpty(call.time),
    argsLen,
    r ? r.status : '',
    r ? String((r.result ?? '').length) : '',
    r ? String(r.time) : '',
  ];
}

function strOrEmpty(v: unknown): string {
  if (v === undefined || v === null) return '';
  return String(v);
}

function escapeCell(s: string): string {
  return s.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

function renderTable(cols: readonly string[], rows: string[][]): string {
  const header = `| ${cols.join(' | ')} |`;
  const sep = `| ${cols.map(() => '---').join(' | ')} |`;
  if (rows.length === 0) {
    return [header, sep, `| ${cols.map(() => '').join(' | ')} |`].join('\n');
  }
  const body = rows
    .map((r) => `| ${r.map((c) => escapeCell(c)).join(' | ')} |`)
    .join('\n');
  return [header, sep, body].join('\n');
}

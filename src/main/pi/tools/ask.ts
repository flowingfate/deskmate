/**
 * `ask`:模型主动向用户索取结构化输入。
 *
 * 校验通过后,本工具**自身**把 schema 派发成 choice/form 卡片到 renderer、
 * 阻塞等用户提交/跳过、返回最终结果 JSON(`dispatchInteractiveCard`)——
 * 与 `shell` 的 device-auth 同范式,不再由 `pi/tool.ts` 按 name 特判回调。
 *
 * Phase 8a 把 LLM-visible name 从 `request_interactive_input` 简化为 `ask`;
 * Phase 8b 把文件名 / 内部 type / 变量名一并对齐 —— 旧 `RequestInteractiveInput*`
 * 类型已退役,统一用 `AskArgs` / `AskToolResult`。
 */

import type { AskArgs, AskToolResult } from '@shared/types/askTypes';
import type {
  ChoiceInteractionRequest,
  ChoiceInteractionResponse,
  FormInteractionRequest,
  FormInteractionResponse,
  InteractiveMap,
  InteractiveRequestType,
} from '@shared/types/interactiveRequestTypes';
import { request as humanLoopRequest } from '@shared/ipc/human-loop';
import type { WebContents } from 'electron';
import { z } from 'zod';

import { jsonSchema } from './schema';
import type { LocalTool, ToolContext, ToolResult } from './types';

const choiceOptionSchema = z.object({
  value: z.string().min(1),
  label: z.string().min(1),
  description: z.string().optional(),
  disabled: z.boolean().optional(),
});

const choiceSchema = z.object({
  kind: z.literal('choice'),
  mode: z.enum(['single', 'multi']),
  options: z.array(choiceOptionSchema).min(1),
  minSelections: z.number().int().nonnegative().optional(),
  maxSelections: z.number().int().positive().optional(),
});

const formFieldSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  control: z.enum(['text', 'textarea', 'time', 'folder', 'file', 'number', 'checkbox', 'select', 'multiselect']),
  required: z.boolean().optional(),
  placeholder: z.string().optional(),
  description: z.string().optional(),
  defaultValue: z.union([z.string(), z.number(), z.boolean(), z.array(z.string())]).optional(),
  options: z.array(choiceOptionSchema).optional(),
  minSelections: z.number().int().nonnegative().optional(),
  maxSelections: z.number().int().positive().optional(),
});

const formSchema = z.object({
  kind: z.literal('form'),
  fields: z.array(formFieldSchema).min(1),
});

const askArgsSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  source: z.enum(['assistant', 'tool', 'system']).optional(),
  submitLabel: z.string().min(1).optional(),
  skipLabel: z.string().min(1).optional(),
  schema: z.discriminatedUnion('kind', [choiceSchema, formSchema]),
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeChoiceOption(option: unknown): unknown {
  if (typeof option === 'string') {
    return {
      value: option,
      label: option,
    };
  }

  if (!isRecord(option)) {
    return option;
  }

  const value = typeof option.value === 'string'
    ? option.value
    : typeof option.label === 'string'
      ? option.label
      : undefined;
  const label = typeof option.label === 'string'
    ? option.label
    : typeof option.value === 'string'
      ? option.value
      : undefined;

  return {
    ...option,
    ...(value ? { value } : {}),
    ...(label ? { label } : {}),
  };
}

function normalizeChoiceOptions(options: unknown): unknown {
  if (!Array.isArray(options)) {
    return options;
  }

  return options.map((option) => normalizeChoiceOption(option));
}

const FOLDER_PATH_PATTERN = /\b(folder|directory|dir|working.?path|work.?dir|output.?path|output.?dir|root.?path|base.?path|project.?path|workspace|install.?path|install.?dir|save.?dir|save.?path|dest.?dir|dest.?path|target.?dir|target.?path)\b/i;
const FILE_PATH_PATTERN = /\b(file.?path|file.?location|config.?file|log.?file|input.?file|output.?file|script.?path|template.?file|cert.?file|key.?file|credential.?file)\b/i;

function inferPathControl(field: Record<string, unknown>): 'folder' | 'file' | null {
  const signals = [field.key, field.label, field.description, field.placeholder]
    .filter((v): v is string => typeof v === 'string')
    .join(' ');

  if (FOLDER_PATH_PATTERN.test(signals)) {
    return 'folder';
  }

  if (FILE_PATH_PATTERN.test(signals)) {
    return 'file';
  }

  return null;
}

function normalizeFormField(field: unknown): unknown {
  if (!isRecord(field)) {
    return field;
  }

  const normalizedKey = typeof field.key === 'string'
    ? field.key
    : typeof field.id === 'string'
      ? field.id
      : typeof field.fieldName === 'string'
        ? field.fieldName
        : typeof field.name === 'string'
          ? field.name
          : field.key;

  let control = field.control;
  if (control === 'email') {
    control = 'text';
  }
  if (control === 'text' || control === undefined) {
    const inferred = inferPathControl(field);
    if (inferred) {
      control = inferred;
    }
  }

  return {
    ...field,
    key: normalizedKey,
    control,
    options: normalizeChoiceOptions(field.options),
  };
}

function normalizeInteractiveInputArgs(args: unknown): unknown {
  if (!isRecord(args) || !isRecord(args.schema)) {
    return args;
  }

  if (args.schema.kind === 'choice') {
    const normalizedDescription = typeof args.description === 'string'
      ? args.description
      : typeof args.schema.question === 'string'
        ? args.schema.question
        : args.description;

    return {
      ...args,
      ...(normalizedDescription ? { description: normalizedDescription } : {}),
      schema: {
        ...args.schema,
        mode: args.schema.mode === 'single' || args.schema.mode === 'multi'
          ? args.schema.mode
          : 'single',
        options: normalizeChoiceOptions(args.schema.options),
      },
    };
  }

  if (args.schema.kind === 'form' && Array.isArray(args.schema.fields)) {
    return {
      ...args,
      schema: {
        ...args.schema,
        fields: args.schema.fields.map((field) => normalizeFormField(field)),
      },
    };
  }

  return args;
}

function validateNormalizedArgs(args: AskArgs): string | null {
  if (args.schema.kind === 'choice') {
    if (
      typeof args.schema.minSelections === 'number' &&
      typeof args.schema.maxSelections === 'number' &&
      args.schema.minSelections > args.schema.maxSelections
    ) {
      return 'minSelections must be less than or equal to maxSelections';
    }

    return null;
  }

  const seenKeys = new Set<string>();
  for (const field of args.schema.fields) {
    if (seenKeys.has(field.key)) {
      return `Duplicate field key: ${field.key}`;
    }
    seenKeys.add(field.key);

    const needsOptions = field.control === 'select' || field.control === 'multiselect';
    if (needsOptions && (!field.options || field.options.length === 0)) {
      return `options are required for ${field.control} controls`;
    }

    if (
      typeof field.minSelections === 'number' &&
      typeof field.maxSelections === 'number' &&
      field.minSelections > field.maxSelections
    ) {
      return `minSelections must be less than or equal to maxSelections for field ${field.key}`;
    }
  }

  return null;
}

const PARAMETERS = jsonSchema({
  type: 'object',
  properties: {
    title: { type: 'string', description: 'Short title shown at the top of the interaction card.' },
    description: { type: 'string', description: 'Optional supporting explanation. HTML is allowed for existing chat card rendering.' },
    source: {
      type: 'string',
      enum: ['assistant', 'tool', 'system'],
      description: 'Logical source of the request. Defaults to assistant.',
    },
    submitLabel: { type: 'string', description: 'Optional custom label for the submit button.' },
    skipLabel: { type: 'string', description: 'Optional custom label for the skip button.' },
    schema: {
      type: 'object',
      properties: {},
      additionalProperties: true,
      description: 'Structured interaction schema. Use kind=choice for a single question with options, or kind=form for structured multi-field input. For form fields, supported controls include: text, textarea, time, email, number, checkbox, select, multiselect, folder (renders a native folder picker dialog), and file (renders a native file picker dialog). Use control=time for HH:MM time selection, control=folder for directory/path fields, and control=file for file path fields.',
    },
  },
  required: ['title', 'schema'],
});

const DESCRIPTION =
  'Request structured user input during the current chat turn. Use this tool when you know the missing information and can describe it as a controlled choice or form schema. Do not ask follow-up questions in plain assistant text when a structured interaction card would be clearer. The tool returns only validated schema metadata; the main chat runtime will pause, render the card, collect the user response, and continue the turn.';

export const ask: LocalTool = {
  spec: {
    name: 'ask',
    description: DESCRIPTION,
    parameters: PARAMETERS,
  },
  async handler(args, ctx): Promise<ToolResult> {
    // normalize → zod parse → 二次结构校验 → 落字段默认值。校验失败直接把
    // `{ success: false, error: 'INVALID_INPUT', message }` 作为 tool_result 回给
    // LLM(不弹卡片);通过则派发交互卡片并阻塞等用户。
    const parsed = askArgsSchema.safeParse(normalizeInteractiveInputArgs(args));
    if (!parsed.success) {
      const result: AskToolResult = {
        success: false,
        error: 'INVALID_INPUT',
        message: parsed.error.issues.map((issue) => issue.message).join('; '),
      };
      return { ok: true, content: JSON.stringify(result) };
    }

    const normalizedArgs = {
      ...parsed.data,
      source: parsed.data.source || 'assistant',
      submitLabel: parsed.data.submitLabel || 'Continue',
      skipLabel: parsed.data.skipLabel || 'Skip',
      schema: parsed.data.schema.kind === 'choice'
        ? {
            ...parsed.data.schema,
            minSelections: typeof parsed.data.schema.minSelections === 'number'
              ? parsed.data.schema.minSelections
              : parsed.data.schema.mode === 'single' ? 1 : 0,
            maxSelections: typeof parsed.data.schema.maxSelections === 'number'
              ? parsed.data.schema.maxSelections
              : parsed.data.schema.mode === 'single' ? 1 : undefined,
          }
        : parsed.data.schema,
    };

    const validationError = validateNormalizedArgs(normalizedArgs as AskArgs);
    if (validationError) {
      const result: AskToolResult = {
        success: false,
        error: 'INVALID_INPUT',
        message: validationError,
      };
      return { ok: true, content: JSON.stringify(result) };
    }

    // 校验通过 → 直接把 choice/form 卡片派发到 renderer,阻塞等用户提交/跳过,
    // 返回最终结果 JSON。以前这段 human-loop 在 `pi/tool.ts` 按 name==='ask'
    // 特判触发;现已内聚到工具本体(与 `shell` 的 device-auth 同范式)。
    return { ok: true, content: await dispatchInteractiveCard(normalizedArgs as AskArgs, ctx) };
  },
};

/**
 * 把已校验的 `AskArgs` 派发成 choice/form 卡片到 renderer,阻塞等用户提交/跳过,
 * 返回给 LLM 的最终结果 JSON。`eventSender` 为空(JobRun / 测试路径)时 human-loop
 * 退化为"用户跳过"等价语义。
 */
async function dispatchInteractiveCard(args: AskArgs, ctx: ToolContext): Promise<string> {
  if (args.schema.kind === 'choice') {
    const id = generateInteractionId('choice');
    const request: ChoiceInteractionRequest = {
      chatSessionId: ctx.sessionId,
      title: args.title,
      description: args.description,
      submitLabel: args.submitLabel,
      skipLabel: args.skipLabel,
      mode: args.schema.mode,
      options: args.schema.options,
      minSelections: args.schema.minSelections,
      maxSelections: args.schema.maxSelections,
    };
    const cancel: ChoiceInteractionResponse = { action: 'skip', selectedValues: [] };
    const response = await sendHumanLoopRequest(ctx.eventSender, 'choice', id, request, cancel, ctx.signal);

    if (response.action === 'skip') {
      return JSON.stringify({
        success: true,
        status: 'skipped',
        request_type: 'choice',
        skipped_by_user: true,
        user_action: 'skip',
        message:
          'The user explicitly skipped or cancelled this interactive input request. Do not ask the same interactive question again unless the user later reopens the topic or provides new context.',
        selected_values: [],
      });
    }
    return JSON.stringify({
      success: true,
      status: 'submitted',
      request_type: 'choice',
      skipped_by_user: false,
      user_action: 'submit',
      message: 'The user submitted a response to this interactive input request.',
      selected_values: response.selectedValues || [],
    });
  }

  const id = generateInteractionId('form');
  const request: FormInteractionRequest = {
    chatSessionId: ctx.sessionId,
    title: args.title,
    description: args.description,
    submitLabel: args.submitLabel,
    skipLabel: args.skipLabel,
    fields: args.schema.fields.map((field) => ({
      key: field.key,
      label: field.label,
      control: field.control,
      type: field.control === 'checkbox' ? 'boolean' : field.control === 'number' ? 'double' : 'string',
      required: field.required,
      defaultValue: field.defaultValue,
      placeholder: field.placeholder,
      description: field.description,
      options: field.options,
      minSelections: field.minSelections,
      maxSelections: field.maxSelections,
    })),
  };
  const cancel: FormInteractionResponse = { action: 'skip', formValues: {} };
  const response = await sendHumanLoopRequest(ctx.eventSender, 'form', id, request, cancel, ctx.signal);

  if (response.action === 'skip') {
    return JSON.stringify({
      success: true,
      status: 'skipped',
      request_type: 'form',
      skipped_by_user: true,
      user_action: 'skip',
      message:
        'The user explicitly skipped or cancelled this interactive input request. Do not ask the same interactive question again unless the user later reopens the topic or provides new context.',
      form_values: null,
    });
  }
  return JSON.stringify({
    success: true,
    status: 'submitted',
    request_type: 'form',
    skipped_by_user: false,
    user_action: 'submit',
    message: 'The user submitted a response to this interactive input request.',
    form_values: response.formValues || {},
  });
}

function generateInteractionId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

async function sendHumanLoopRequest<K extends InteractiveRequestType>(
  sender: WebContents | null,
  type: K,
  id: string,
  request: InteractiveMap[K]['in'],
  cancelResponse: InteractiveMap[K]['out'],
  signal: AbortSignal,
): Promise<InteractiveMap[K]['out']> {
  if (!sender || sender.isDestroyed()) return cancelResponse;

  const task = humanLoopRequest(type, request, id).to(sender);
  if (signal.aborted) {
    task.resolve(cancelResponse);
  } else {
    signal.addEventListener('abort', () => { task.resolve(cancelResponse); }, { once: true });
  }
  return await task;
}

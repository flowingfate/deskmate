import type {
  Api as PiApi,
  AssistantMessage as PiAssistantMessage,
  Model as PiModel,
  Tool as PiTool,
} from '@earendil-works/pi-ai';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ContextState, Message, SubAgentRunRequest } from '../../../../shared/persist/types';
import {
  createAssistantMessage,
  createUserMessage,
} from '../../../../shared/utils/messageFactory';
import { Subrun, type SubrunParent } from '../../../persist/subrun';
import type { StreamOneRoundArgs } from '../../session/base';

vi.mock('../../utils/config', () => ({
  readAgentRuntimeConfig: async () => ({
    ok: true,
    agent: {
      emoji: '',
      name: 'Delegate',
      model: 'openai::test-model',
      mcpServers: [],
      systemPrompt: '',
    },
    parsedModel: { provider: 'openai', modelId: 'test-model' },
  }),
}));

vi.mock('../../model', () => {
  const model: PiModel<PiApi> = {
    id: 'test-model',
    name: 'Test Model',
    api: 'openai-completions',
    provider: 'openai',
    baseUrl: 'https://example.invalid',
    reasoning: false,
    input: ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128_000,
    maxTokens: 4_000,
  };

  return {
    getModelInfo: async () => ({
      model,
      capabilities: {
        reasoning: false,
        reasoningLevels: [],
        tools: true,
        images: false,
        temperature: true,
        maxTokens: model.maxTokens,
        contextWindow: model.contextWindow,
      },
    }),
    resolveCredentials: async (baseModel: PiModel<PiApi>) => ({
      apiKey: 'test-key',
      model: baseModel,
    }),
  };
});

vi.mock('../../compression', () => ({
  checkAndCompress: async (input: {
    messages: Message[];
    contextState: ContextState;
  }) => ({
    applied: false,
    nextContextState: input.contextState,
    usage: {
      tokenCount: 0,
      totalMessages: input.messages.length,
      contextMessages: input.messages.length,
      compressionRatio: 1,
    },
    llmContext: input.messages,
  }),
}));

vi.mock('../prompt', () => ({
  buildDelegatedSystemPrompt: async () => 'Delegated test prompt.',
}));

vi.mock('../../tool', () => {
  class TestToolCatalog {
    public constructor(public readonly specs: PiTool[]) {}

    public static empty(): TestToolCatalog {
      return new TestToolCatalog([]);
    }

    public withSubmitResult(tool: { spec: PiTool }): TestToolCatalog {
      return new TestToolCatalog([...this.specs, tool.spec]);
    }

    public resolveIdentity(name: string): { name: string; mcp: undefined } {
      return { name, mcp: undefined };
    }
  }

  return {
    ToolCatalog: TestToolCatalog,
    buildToolCatalogForAgent: async () => TestToolCatalog.empty(),
    deriveToolTracer: () => {
      throw new Error('Unexpected tool tracer derivation.');
    },
    executeToolCall: async () => {
      throw new Error('Unexpected tool execution.');
    },
  };
});



import { SubAgentSession } from '../session';

const request: SubAgentRunRequest = {
  delegateAgentId: 'a_delegate',
  task: 'Write the report.',
  expectedOutput: 'A report.',
  context: { kind: 'isolated' },
  policy: { maxTurns: 25, timeoutMs: 60_000 },
};

let tmpRoot = '';

function parent(): SubrunParent {
  return {
    profileId: 'p_test',
    parentAgentId: 'a_parent',
    parentSessionId: 's_parent',
    subrunsDir: path.join(tmpRoot, 'subruns'),
  };
}

function assistantResponse(content: string): PiAssistantMessage {
  return {
    role: 'assistant',
    content: [{ type: 'text', text: content }],
    api: 'openai-completions',
    provider: 'openai',
    model: 'test-model',
    usage: {
      input: 10,
      output: 5,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 15,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: 'stop',
    timestamp: Date.now(),
  };
}

class TestSubAgentSession extends SubAgentSession {
  public constructor(
    options: ConstructorParameters<typeof SubAgentSession>[0],
    private readonly responses: PiAssistantMessage[],
  ) {
    super(options);
  }

  protected override async streamOneRound(_args: StreamOneRoundArgs): Promise<PiAssistantMessage> {
    const response = this.responses.shift();
    if (!response) throw new Error('Unexpected extra model turn.');
    return response;
  }
}

beforeEach(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'subagent-session-test-'));
});

afterEach(async () => {
  await fs.rm(tmpRoot, { recursive: true, force: true });
});

describe('SubAgentSession continuation', () => {
  it('uses the continuation turn limit without appending an unanswered reminder', async () => {
    const created = await Subrun.create(parent(), request);
    if (created.kind !== 'created') throw new Error('Expected an allocated subrun.');

    const subrun = created.subrun;
    await subrun.start();
    subrun.appendDomainMessage(createUserMessage({ content: request.task }));
    subrun.appendDomainMessage(createAssistantMessage({ content: 'Initial report.' }));
    await subrun.flushMessages();
    await subrun.finish({
      status: 'completed',
      subrunId: subrun.subrunId,
      delegateAgentId: subrun.delegateAgentId,
      content: 'Initial report.',
      deliverables: [],
      warnings: [],
      usage: { turns: 1, durationMs: 10 },
    });

    await subrun.continueConversation('Add rollout risks.', {
      maxTurns: 1,
      timeoutMs: 60_000,
    });
    const session = new TestSubAgentSession({
      subrun,
      signal: new AbortController().signal,
    }, [assistantResponse('Rollout risks added.')]);

    await expect(session.run()).resolves.toMatchObject({
      kind: 'result',
      result: {
        status: 'partial',
        content: 'Rollout risks added.',
        usage: { turns: 1 },
      },
    });

    const { messages } = await subrun.loadDomainMessages();
    expect(messages.map((message) => ({
      role: message.role,
      content: message.content,
    }))).toEqual([
      { role: 'user', content: 'Write the report.' },
      { role: 'assistant', content: 'Initial report.' },
      { role: 'user', content: 'Add rollout risks.' },
      { role: 'assistant', content: 'Rollout risks added.' },
    ]);
  });
});

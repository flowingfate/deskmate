// src/main/lib/evalHarness/evalAgentRunner.ts
import { generateEvalSessionId } from '../utilities/idFactory';
import type { RunTestRequest, RunTestResponse, RunTestMessageOutput } from './evalProtocol';
import type { Message, AssistantMessage } from '@shared/types/message';
import { createUserMessage } from '@shared/utils/messageFactory';
import type { ContextState } from '@shared/types/agentChatTypes';
import type { StreamingChunk } from '@shared/types/streamingTypes';
import Stream from '@shared/stream-iterator';
import { Profiles } from '../../persist';
import { RegularSession, type PersistSessionLike } from '../../pi';
import { newEntityId } from '../../../shared/persist/id';
import { log } from '@main/log';

const logger = log;

const SESSION_IDLE_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes
const MAX_SESSIONS = 10;

interface CachedSession {
  piSession: RegularSession;
  lastUsed: number;
  idleTimer: ReturnType<typeof setTimeout>;
  /** Message count before the current turn — used to slice "messages added this turn". */
  messageCount: number;
  /** Per-session mutex: resolves when the current turn finishes. */
  turnLock: Promise<void>;
}

/**
 * Handles 'run_test' requests: full agent e2e loop on top of the pi orchestrator.
 *
 * Single-turn (no session_id): creates an in-memory pi.RegularSession backed by a noop
 * persistence shim (磁盘上不留任何痕迹，与老 setSkipPersistence(true) 等价),
 * runs the prompt, returns. The session is cached so the orchestrator can
 * continue if it turns out to be multi-turn.
 *
 * Multi-turn (session_id): reuses a cached pi.RegularSession.
 * Sessions are evicted after 15 minutes of inactivity, and on error.
 *
 * Concurrency: each session serializes turns via a per-session lock.
 */
export class EvalAgentRunner {
  private sessions: Map<string, CachedSession> = new Map();

  // 老接口 EvalHttpServer 传 profileId，新路径只跟当前 active profile 工作。
  // 参数静默忽略而不是改签名，避免无意义的调用方联动。
  constructor(profileId: string) {}

  async run(request: RunTestRequest): Promise<RunTestResponse> {
    const sessionId = request.session_id;
    return sessionId ? this.runWithSession(request, sessionId) : this.runOneShot(request);
  }

  /**
   * 单轮：建一个 in-memory pi.RegularSession，跑 prompt，缓存供后续多轮复用。
   * 调用方已 abort 则不缓存，session 随返回直接进 GC。
   */
  async runOneShot(request: RunTestRequest, signal?: AbortSignal): Promise<RunTestResponse> {
    const agentId = await this.getDefaultAgentId();
    const profile = await Profiles.get().active();
    const piSession = this.makeEphemeralSession(profile.id, agentId);

    const evalSessionId = generateEvalSessionId();

    try {
      const userMessage = createUserMessage({ content: request.data.prompt });
      const newMessages = await this.runTurn(piSession, userMessage);

      if (signal?.aborted) {
        throw new Error('Request was aborted before caching');
      }

      const outputMessages = this.convertMessages(newMessages);
      const subAgentMessages = this.extractSubAgentMessages(newMessages);

      this.cacheSession(evalSessionId, piSession, piSession.messages.length);

      return {
        messages: outputMessages,
        sub_agent_messages: subAgentMessages,
        metadata: { session_id: evalSessionId },
        session_id: evalSessionId,
      };
    } catch (error) {
      // 内存 session：异常时不缓存即可，无落盘清理。
      throw error;
    }
  }

  /**
   * 多轮：复用缓存的 pi.RegularSession。按 session 串行 turns（前一个未完时新请求排队）。
   */
  private async runWithSession(
    request: RunTestRequest,
    sessionId: string,
  ): Promise<RunTestResponse> {
    const cached = this.sessions.get(sessionId);
    if (!cached) {
      throw new Error(
        `Session not found: ${sessionId}. It may have expired (idle timeout: ${SESSION_IDLE_TIMEOUT_MS / 1000}s).`,
      );
    }

    const previousTurn = cached.turnLock;
    let resolveTurn!: () => void;
    const turnPromise = new Promise<void>((resolve) => { resolveTurn = resolve; });
    cached.turnLock = turnPromise;

    await previousTurn;

    clearTimeout(cached.idleTimer);
    cached.lastUsed = Date.now();
    cached.idleTimer = setTimeout(
      () => this.evictSession(sessionId),
      SESSION_IDLE_TIMEOUT_MS,
    );

    try {
      const userMessage = createUserMessage({ content: request.data.prompt });
      const messageCountBefore = cached.messageCount;

      await this.runTurn(cached.piSession, userMessage);

      const allMessages = cached.piSession.messages;
      const newMessages = allMessages.slice(messageCountBefore);
      cached.messageCount = allMessages.length;

      const outputMessages = this.convertMessages(newMessages);
      const subAgentMessages = this.extractSubAgentMessages(newMessages);

      return {
        messages: outputMessages,
        sub_agent_messages: subAgentMessages,
        metadata: { session_id: sessionId },
        session_id: sessionId,
      };
    } catch (error) {
      this.evictSession(sessionId);
      throw error;
    } finally {
      resolveTurn();
    }
  }

  /**
   * 给 pi.RegularSession 提供一个内存 PersistSessionLike：所有 IO 都 no-op，状态完全在内存。
   * 老 evalAgentRunner 通过 `agent.setSkipPersistence(true)` 达到同样效果。
   */
  private makeEphemeralSession(profileId: string, agentId: string): RegularSession {
    const persistShim: PersistSessionLike = {
      config: {
        title: '',
        updatedAt: new Date().toISOString(),
        contextState: { compressions: [] },
      },
      loadDomainMessages: async () => ({ messages: [], orphanResponses: [] }),
      appendDomainMessage: () => {},
      appendToolResponse: () => {},
      rewriteMessages: async () => {},
      flushMessages: async () => {},
      persist: async () => {},
    };
    const sessionId = newEntityId('s');
    return new RegularSession(sessionId, profileId, agentId, persistShim);
  }

  /**
   * 运行一轮 pi turn loop（headless：eventSender 是 noop stub，streaming chunk 全部丢弃）。
   * 返回这一轮新增的消息（含 user / assistant / tool）。
   */
  private async runTurn(piSession: RegularSession, userMessage: Message): Promise<Message[]> {
    if (userMessage.role !== 'user') throw new Error('runTurn requires user message');
    const before = piSession.messages.length;
    const chunkStream = new Stream<StreamingChunk>();
    // 丢弃所有 chunk —— eval 只关心 message 终态。
    void (async () => {
      try {
        for await (const _chunk of chunkStream) {
          void _chunk;
        }
      } catch {
        // stream consumer 异常不影响主流程
      }
    })();
    // pi.RegularSession.startStream 签名要求 Electron.WebContents（renderer 是事实源）。
    // headless eval 路径没有 renderer：tool 层可能在 human-loop / form 工具上调
    // sender.send + 等 IPC 回包；stub 把 isDestroyed 永久置 true 让这些路径在
    // 进入 send 之前就 fail-fast，而不是 noop send 死等。
    await piSession.startStream(userMessage, chunkStream, makeHeadlessWebContents());
    return piSession.messages.slice(before);
  }

  /**
   * 缓存一个 pi.RegularSession 供多轮复用。容量满则按 LRU 驱逐最旧的。
   */
  private cacheSession(
    sessionId: string,
    piSession: RegularSession,
    messageCount: number,
  ): void {
    if (this.sessions.size >= MAX_SESSIONS) {
      let oldestId: string | null = null;
      let oldestTime = Infinity;
      for (const [id, s] of this.sessions) {
        if (s.lastUsed < oldestTime) {
          oldestTime = s.lastUsed;
          oldestId = id;
        }
      }
      if (oldestId) this.evictSession(oldestId);
    }

    const idleTimer = setTimeout(
      () => this.evictSession(sessionId),
      SESSION_IDLE_TIMEOUT_MS,
    );

    this.sessions.set(sessionId, {
      piSession,
      lastUsed: Date.now(),
      idleTimer,
      messageCount,
      turnLock: Promise.resolve(),
    });
  }

  private evictSession(sessionId: string): void {
    const cached = this.sessions.get(sessionId);
    if (!cached) return;
    clearTimeout(cached.idleTimer);
    // 内存 session：从 Map 摘掉就能 GC，无落盘要清。
    this.sessions.delete(sessionId);
    logger.info({ msg: '[EvalAgentRunner] Session evicted', mod: 'evictSession', sessionId });
  }

  destroyAllSessions(): void {
    // 拷贝 keys 避免迭代中 mutate Map。
    for (const sessionId of [...this.sessions.keys()]) {
      this.evictSession(sessionId);
    }
  }

  /**
   * Gets the default agent's agentId from the user's profile.
   */
  private async getDefaultAgentId(): Promise<string> {
    const profile = await Profiles.get().active();
    const primary = profile.getPrimaryAgentId();
    if (primary) {
      const agent = await profile.getAgent(primary);
      if (agent) return primary;
    }
    const records = profile.listAgents();
    const byName = records.find((r) => r.name === 'Kobi') ?? records[0];
    if (!byName) {
      throw new Error(`No agents found under profile "${profile.id}"`);
    }
    return byName.id;
  }

  /**
   * Domain Message[] → 扁平 RunTestMessageOutput[]。
   * 1→N 展开：assistant 后立刻按 tool_calls 顺序追加合成的 'tool' 条目，
   * 用于 eval 输出的扁平断言形态。
   */
  private convertMessages(messages: Message[]): RunTestMessageOutput[] {
    const out: RunTestMessageOutput[] = [];
    for (const msg of messages) {
      if (msg.role === 'user') {
        out.push({ role: 'user', content: msg.content });
        continue;
      }
      // assistant
      const a: AssistantMessage = msg;
      out.push({
        role: 'assistant',
        content: a.content,
        tool_calls: a.tool_calls.length > 0
          ? a.tool_calls.map((tc) => ({
              id: tc.id,
              name: tc.name,
              arguments: JSON.stringify(tc.args ?? {}),
            }))
          : undefined,
      });
      for (const tc of a.tool_calls) {
        if (!tc.response) continue;
        out.push({
          role: 'tool',
          content: tc.response.result,
          tool_call_id: tc.id,
        });
      }
    }
    return out;
  }

  /**
   * 从 tool result 文本里嗅探 sub-agent message 列表。
   * 老 spawn_subagent 结果会把 messages 数组 JSON 嵌进 tool result text。
   */
  private extractSubAgentMessages(messages: Message[]): RunTestMessageOutput[][] {
    const subAgentResults: RunTestMessageOutput[][] = [];

    for (const msg of messages) {
      if (msg.role !== 'assistant') continue;
      for (const tc of msg.tool_calls) {
        const text = tc.response?.result;
        if (!text) continue;
        try {
          const parsed = JSON.parse(text);
          if (parsed && Array.isArray(parsed.messages)) {
            subAgentResults.push(
              parsed.messages.map((m: { role?: string; content?: unknown }) => ({
                role: (m.role || 'assistant') as RunTestMessageOutput['role'],
                content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
              })),
            );
          }
        } catch {
          // Not JSON or no sub-agent data — skip
        }
      }
    }

    return subAgentResults;
  }
}

/**
 * 给 headless eval 路径用的 WebContents stub。
 * `isDestroyed()` 永远返回 true —— pi.RegularSession 内的 send 调用都在 `.isDestroyed()` 守卫后
 * 触发；human-loop / form 工具如果在 eval 路径上被调用，会立刻 fail 而不是死等 IPC 回包。
 */
function makeHeadlessWebContents(): Electron.WebContents {
  const noop = () => undefined;
  return new Proxy({} as Electron.WebContents, {
    get(_t, prop) {
      if (prop === 'isDestroyed') return () => true;
      return noop;
    },
  });
}



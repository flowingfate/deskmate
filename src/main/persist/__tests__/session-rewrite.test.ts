/**
 * Phase 1 持久化层新增能力的集成测试：
 *   - `Session.appendToolResponse` 把 tool_res 行追加进 pendingMessages
 *     并在 flushMessages 时落到 jsonl
 *   - `Session.rewriteMessages` 原子覆盖写 messages.jsonl
 *   - `SessionConfig.turn` 字段在 data.json 上的持久化 round-trip
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Message } from '@shared/persist/types'
import type { PersistedJsonLine, PersistedToolResponse } from '@shared/persist/types';

let tmpRoot = '';

async function freshModules() {
  vi.resetModules();
  const root = await import('../lib/root');
  root.setRootForTesting(tmpRoot);
  const registry = await import('../../profileRegistry');
  registry.ProfileRegistry.resetForTesting();
  const dbMod = await import('../lib/db/db');
  dbMod.ProfileDb.resetForTesting();
  return {
    ProfileRegistry: registry.ProfileRegistry,
    ProfileDb: dbMod.ProfileDb,
  };
}

async function makeAgent() {
  const fresh = await freshModules();
  await fresh.ProfileRegistry.bootstrap();
  const store = fresh.ProfileRegistry.require(fresh.ProfileRegistry.defaultProfileId).store
  const agent = await store.createAgent({ name: 'T', version: '1' });
  return { store, agent, fresh };
}

function readJsonl(file: string): PersistedJsonLine[] {
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, 'utf8')
    .split('\n')
    .filter((l) => l.length > 0)
    .map((l) => JSON.parse(l) as PersistedJsonLine);
}

function messagesFilePath(profileId: string, agentId: string, month: string, sessionId: string): string {
  return path.join(tmpRoot, 'profiles', profileId, 'agents', agentId, 'sessions', month, sessionId, 'messages.jsonl');
}

function dataFilePath(profileId: string, agentId: string, month: string, sessionId: string): string {
  return path.join(tmpRoot, 'profiles', profileId, 'agents', agentId, 'sessions', month, sessionId, 'data.json');
}

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'persist-phase1-'));
});

afterEach(async () => {
  const dbMod = await import('../lib/db/db');
  dbMod.ProfileDb.closeAll();
  try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch { /* ignore */ }
});

// ---------------------------------------------------------------------------
// appendToolResponse
// ---------------------------------------------------------------------------

describe('Session.appendToolResponse', () => {
  it('追加 tool_res 行进 pendingMessages，flush 后落到 messages.jsonl', async () => {
    const { store, agent } = await makeAgent();
    const s = await agent.createSession({});

    s.appendToolResponse('tc-1', { time: 1234, status: 'success', result: 'OK', images: [] });
    s.appendToolResponse('tc-2', { time: 5678, status: 'fail', result: 'denied', images: [] });
    await s.flushMessages();

    const file = messagesFilePath(store.id, agent.id, s.month, s.id);
    const lines = readJsonl(file);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toEqual({ role: 'tool_res', id: 'tc-1', time: 1234, status: 'success', result: 'OK' } satisfies PersistedToolResponse);
    expect(lines[1]).toEqual({ role: 'tool_res', id: 'tc-2', time: 5678, status: 'fail', result: 'denied' } satisfies PersistedToolResponse);
  });
});

// ---------------------------------------------------------------------------
// rewriteMessages
// ---------------------------------------------------------------------------

describe('Session.rewriteMessages', () => {
  it('把 messages.jsonl 整体覆盖写为 dehydrate(messages) 的结果', async () => {
    const { store, agent } = await makeAgent();
    const s = await agent.createSession({});

    // 先写 5 条老消息
    const file = messagesFilePath(store.id, agent.id, s.month, s.id);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(
      file,
      ['a', 'b', 'c', 'd', 'e'].map((c, i) => JSON.stringify({ role: 'user', id: `old-${i}`, time: i, content: c })).join('\n') + '\n',
    );
    expect(readJsonl(file)).toHaveLength(5);

    // 重写为 2 条全新 Domain Message
    const newMsgs: Message[] = [
      { role: 'user', id: 'new-u', time: 100, content: 'fresh', attachments: [] },
      { role: 'assistant', id: 'new-a', time: 101, think: '', content: 'reply', tool_calls: [] },
    ];
    await s.rewriteMessages(newMsgs);

    const lines = readJsonl(file);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({ role: 'user', id: 'new-u', content: 'fresh' });
    expect(lines[1]).toMatchObject({ role: 'assistant', id: 'new-a', content: 'reply' });
    // 空 attachments / 空 tool_calls 没出现在文件中
    expect(lines[0]).not.toHaveProperty('attachments');
    expect(lines[1]).not.toHaveProperty('tool_calls');
  });

  it('空数组重写 → 删除 messages.jsonl 文件', async () => {
    const { store, agent } = await makeAgent();
    const s = await agent.createSession({});

    const file = messagesFilePath(store.id, agent.id, s.month, s.id);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ role: 'user', id: 'x', time: 0, content: 'x' }) + '\n');
    expect(fs.existsSync(file)).toBe(true);

    await s.rewriteMessages([]);
    expect(fs.existsSync(file)).toBe(false);
  });

  it('rewriteMessages 后调 appendMessage 不会从前一轮 pending 中复活幽灵尾巴', async () => {
    // 验证 §2.4 描述：rewriteMessages 前清空 pendingMessages，避免 buffer 残留被
    // append 到新文件末尾。
    const { store, agent } = await makeAgent();
    const s = await agent.createSession({});

    // 故意往 buffer 塞两条 user message 不 flush
    s.appendMessage({ role: 'user', content: 'ghost1' } as never);
    s.appendMessage({ role: 'user', content: 'ghost2' } as never);

    // rewrite → 文件只剩 1 条新内容；buffer 里的 ghost 不应再出现
    await s.rewriteMessages([
      { role: 'user', id: 'kept', time: 1, content: 'kept', attachments: [] },
    ]);
    await s.flushMessages(); // 再 flush，确保 ghost 真的丢了

    const file = messagesFilePath(store.id, agent.id, s.month, s.id);
    const lines = readJsonl(file);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ id: 'kept', content: 'kept' });
  });

  it('rehydrate 一轮 dehydrate 的产物得到原始 Domain messages', async () => {
    // 与 messageWire.test.ts 的 round-trip 不同：这里走 Session.rewriteMessages →
    // 真磁盘 → streamMessages 读回 → rehydrate，覆盖落盘 + 读回的端到端链路。
    const { store, agent } = await makeAgent();
    const s = await agent.createSession({});

    const original: Message[] = [
      { role: 'user', id: 'u1', time: 1, content: 'hi', attachments: [] },
      {
        role: 'assistant', id: 'a1', time: 2, think: 'reason', content: 'ok',
        tool_calls: [
          { id: 't1', name: 'read', time: 3, args: { p: 'x' }, response: { time: 4, status: 'success', result: 'OK', images: [] } },
        ],
        outcome: { kind: 'stop' },
      },
    ];

    await s.rewriteMessages(original);

    const file = messagesFilePath(store.id, agent.id, s.month, s.id);
    const lines = readJsonl(file);
    const { rehydrate } = await import('../messageWire');
    const { messages: restored, orphanResponses } = rehydrate(lines);

    expect(orphanResponses).toEqual([]);
    expect(restored).toEqual(original);
  });
});

// ---------------------------------------------------------------------------
// turn 字段
// ---------------------------------------------------------------------------

describe('SessionConfig.turn 字段持久化', () => {
  it('未显式设置时 data.json 不含 turn 键', async () => {
    const { store, agent } = await makeAgent();
    const s = await agent.createSession({});
    await s.persist();
    const data = JSON.parse(fs.readFileSync(dataFilePath(store.id, agent.id, s.month, s.id), 'utf8'));
    expect('turn' in data).toBe(false);
  });

  it('设置 turn.status=running → 落盘 → 重载后 config.turn 可见', async () => {
    const { store, agent } = await makeAgent();
    const s = await agent.createSession({});
    s.config.turn = { status: 'running', startedAt: 99 };
    await s.persist();

    const raw = JSON.parse(fs.readFileSync(dataFilePath(store.id, agent.id, s.month, s.id), 'utf8'));
    expect(raw.turn).toEqual({ status: 'running', startedAt: 99 });

    const fresh = await freshModules();
    await fresh.ProfileRegistry.bootstrap();
    const store2 = fresh.ProfileRegistry.require(fresh.ProfileRegistry.defaultProfileId).store
    const reloaded = await (await store2.getAgent(agent.id))?.getSession(s.id);
    expect(reloaded?.config.turn).toEqual({ status: 'running', startedAt: 99 });
  });

  it('turn 从 running 回 idle → 落盘 → 重载', async () => {
    const { store, agent } = await makeAgent();
    const s = await agent.createSession({});
    s.config.turn = { status: 'running', startedAt: 1 };
    await s.persist();
    s.config.turn = { status: 'idle' };
    await s.persist();

    const raw = JSON.parse(fs.readFileSync(dataFilePath(store.id, agent.id, s.month, s.id), 'utf8'));
    expect(raw.turn).toEqual({ status: 'idle' });

    const fresh = await freshModules();
    await fresh.ProfileRegistry.bootstrap();
    const store2 = fresh.ProfileRegistry.require(fresh.ProfileRegistry.defaultProfileId).store
    const reloaded = await (await store2.getAgent(agent.id))?.getSession(s.id);
    expect(reloaded?.config.turn).toEqual({ status: 'idle' });
  });
});

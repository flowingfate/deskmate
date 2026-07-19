/**
 * `storageOverview.ts` 集成测试 —— 「本地数据透明」聚合器。
 *
 * 用真 tmp 盘（与 `session-schedule.test.ts` 同理由）：`Profile` 构造即打开 better-sqlite3
 * 的 `index.db`，无法被 mock fs 拦截；且本聚合器的核心正是"递归 stat 真实文件字节"，
 * mock fs 会让统计失真。
 *
 * 覆盖：
 *  - 空 profile：totalBytes > 0（settings.json 等），分类字节之和 == totalBytes。
 *  - 有会话时：conversations 分类计数正确、字节 > 0。
 *  - 不变量：sum(categories.bytes) === totalBytes（无遗漏，无重复）。
 *  - resolveRevealTarget：profile 内路径放行，越界路径拒绝。
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ChatHistoryItem } from '@shared/persist/types';

function msg(role: 'user' | 'assistant', content: string): ChatHistoryItem {
  return { role, content } as unknown as ChatHistoryItem;
}

let tmpRoot = '';

// vi.resetModules() 后必须重新 import 以拿到绑定了新 tmpRoot 的模块单例——
// 这是「测试故意穿越模块加载边界」的场景，静态 import 无法满足。
async function freshModules() {
  vi.resetModules();
  const root = await import('../lib/root');
  root.setRootForTesting(tmpRoot);
  const registry = await import('../../profileRegistry');
  registry.ProfileRegistry.resetForTesting();
  const dbMod = await import('../lib/db/db');
  dbMod.ProfileDb.resetForTesting();
  const storage = await import('../storageOverview');
  return {
    ProfileRegistry: registry.ProfileRegistry,
    computeStorageOverview: storage.computeStorageOverview,
    computeRuntimeStorageOverview: storage.computeRuntimeStorageOverview,
    resolveRevealTarget: storage.resolveRevealTarget,
  };
}

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'persist-storage-it-'));
});

afterEach(async () => {
  const dbMod = await import('../lib/db/db');
  dbMod.ProfileDb.closeAll();
  try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch { /* ignore */ }
});

describe('computeStorageOverview', () => {
  it('空 profile：无 agent 分组，Σ(agents + shared) == totalBytes，计数全 0', async () => {
    const fresh = await freshModules();
    const profiles = fresh.ProfileRegistry;
    await fresh.ProfileRegistry.bootstrap();
    const store = fresh.ProfileRegistry.require(profiles.defaultProfileId).store
    const defaultAgentId = store.getPrimaryAgentId();
    if (!defaultAgentId) throw new Error('Expected a default primary agent.');
    await store.archiveAgent(defaultAgentId);

    const overview = await fresh.computeStorageOverview(store, profiles);

    expect(overview.totalBytes).toBeGreaterThan(0);
    expect(overview.agents).toHaveLength(0);
    expect(overview.agentsTotalBytes).toBe(0);

    const sharedSum = overview.shared.reduce((acc, c) => acc + c.bytes, 0);
    expect(overview.agentsTotalBytes + sharedSum).toBe(overview.totalBytes);

    expect(overview.stats.agents).toBe(0);
    expect(overview.stats.conversations).toBe(0);
    expect(overview.shared.map((c) => c.key)).toContain('profileConfig');
  });

  it('有 agent + 会话：按 agent 分组，子项 count/bytes 正确，两级总和守恒', async () => {
    const fresh = await freshModules();
    const profiles = fresh.ProfileRegistry;
    await fresh.ProfileRegistry.bootstrap();
    const store = fresh.ProfileRegistry.require(profiles.defaultProfileId).store
    const defaultAgentId = store.getPrimaryAgentId();
    if (!defaultAgentId) throw new Error('Expected a default primary agent.');
    await store.archiveAgent(defaultAgentId);

    const agent = await store.createAgent({ name: 'Scout', version: '1', emoji: '🛰️' });
    const s = await agent.createSession({ title: 'hello' });
    s.appendMessage(msg('user', 'hi there'));
    s.appendMessage(msg('assistant', 'hey back'));
    await s.flushMessages();
    await s.persist();

    const overview = await fresh.computeStorageOverview(store, profiles);

    expect(overview.stats.agents).toBe(1);
    expect(overview.stats.conversations).toBe(1);
    expect(overview.agents).toHaveLength(1);

    const group = overview.agents[0];
    expect(group.agentId).toBe(agent.id);
    expect(group.name).toBe('Scout');
    expect(group.emoji).toBe('🛰️');
    expect(group.totalBytes).toBeGreaterThan(0);

    // 该 agent 的四个子项都在，conversations 计数 = 1 且字节 > 0。
    const partKeys = group.parts.map((p) => p.key).sort();
    expect(partKeys).toEqual(['config', 'conversations', 'knowledge', 'scheduledRuns']);
    const conv = group.parts.find((p) => p.key === 'conversations')!;
    expect(conv.count).toBe(1);
    expect(conv.bytes).toBeGreaterThan(0);

    // agent 内子项之和守恒。
    const partSum = group.parts.reduce((acc, p) => acc + p.bytes, 0);
    expect(partSum).toBe(group.totalBytes);

    // 顶层守恒：Σ(agents 总字节) + Σ(shared 字节) == totalBytes。
    const sharedSum = overview.shared.reduce((acc, c) => acc + c.bytes, 0);
    expect(overview.agentsTotalBytes).toBe(group.totalBytes);
    expect(overview.agentsTotalBytes + sharedSum).toBe(overview.totalBytes);

    // 每个子项 / 分类字节非负。
    for (const p of group.parts) expect(p.bytes).toBeGreaterThanOrEqual(0);
    for (const c of overview.shared) expect(c.bytes).toBeGreaterThanOrEqual(0);
  });

  it('多 agent 按 totalBytes 倒序排列', async () => {
    const fresh = await freshModules();
    const profiles = fresh.ProfileRegistry;
    await fresh.ProfileRegistry.bootstrap();
    const store = fresh.ProfileRegistry.require(profiles.defaultProfileId).store
    const defaultAgentId = store.getPrimaryAgentId();
    if (!defaultAgentId) throw new Error('Expected a default primary agent.');
    await store.archiveAgent(defaultAgentId);

    const a1 = await store.createAgent({ name: 'Light', version: '1' });
    const a2 = await store.createAgent({ name: 'Heavy', version: '1' });
    // 给 a2 塞更多会话内容，使其占盘更大。
    for (let i = 0; i < 4; i++) {
      const s = await a2.createSession({ title: `s${i}` });
      s.appendMessage(msg('user', 'x'.repeat(500)));
      s.appendMessage(msg('assistant', 'y'.repeat(500)));
      await s.flushMessages();
      await s.persist();
    }
    const s1 = await a1.createSession({ title: 'tiny' });
    s1.appendMessage(msg('user', 'hi'));
    await s1.flushMessages();
    await s1.persist();

    const overview = await fresh.computeStorageOverview(store, profiles);
    expect(overview.agents).toHaveLength(2);
    expect(overview.agents[0].agentId).toBe(a2.id);
    expect(overview.agents[0].totalBytes).toBeGreaterThanOrEqual(overview.agents[1].totalBytes);
  });
});

describe('computeRuntimeStorageOverview', () => {
  it('单遍归类 env 文件，保持字节与文件数守恒', async () => {
    const fresh = await freshModules();
    const envRoot = path.join(tmpRoot, 'env');
    fs.mkdirSync(path.join(envRoot, 'bun', 'install', 'global'), { recursive: true });
    fs.mkdirSync(path.join(envRoot, 'python', 'cpython-3.13'), { recursive: true });
    fs.mkdirSync(path.join(envRoot, 'bin'), { recursive: true });
    fs.writeFileSync(path.join(envRoot, 'bun', 'install', 'global', 'package.json'), 'bun');
    fs.writeFileSync(path.join(envRoot, 'python', 'cpython-3.13', 'python'), 'python');
    fs.writeFileSync(path.join(envRoot, 'bin', 'bun'), 'shim');
    fs.writeFileSync(path.join(envRoot, 'runtime.json'), 'runtime');

    const overview = await fresh.computeRuntimeStorageOverview();
    const categories = new Map(overview.categories.map((category) => [category.key, category]));

    expect(overview.exists).toBe(true);
    expect(overview.totalBytes).toBe(20);
    expect(overview.fileCount).toBe(4);
    expect(categories.get('bun')?.bytes).toBe(3);
    expect(categories.get('python')?.bytes).toBe(6);
    expect(categories.get('bin')?.bytes).toBe(4);
    expect(categories.get('other')?.bytes).toBe(7);
    expect(overview.categories.reduce((total, category) => total + category.bytes, 0)).toBe(overview.totalBytes);
    expect(overview.categories.reduce((total, category) => total + category.fileCount, 0)).toBe(overview.fileCount);
  });

  it('env 目录不存在时返回空概览', async () => {
    const fresh = await freshModules();

    const overview = await fresh.computeRuntimeStorageOverview();

    expect(overview.exists).toBe(false);
    expect(overview.totalBytes).toBe(0);
    expect(overview.fileCount).toBe(0);
    expect(overview.categories).toEqual([]);
  });
});

describe('resolveRevealTarget', () => {
  it('放行 profile 与 runtime env 树，拒绝越界 / 不存在路径', async () => {
    const fresh = await freshModules();
    const profiles = fresh.ProfileRegistry;
    await fresh.ProfileRegistry.bootstrap();
    const store = fresh.ProfileRegistry.require(profiles.defaultProfileId).store

    const profileRoot = path.join(tmpRoot, 'profiles', store.id);
    const dataRoot = tmpRoot;
    const runtimeFile = path.join(tmpRoot, 'env', 'bun', 'bun');
    fs.mkdirSync(path.dirname(runtimeFile), { recursive: true });
    fs.writeFileSync(runtimeFile, 'bun');

    // profile 根目录本身放行（是目录）。
    const ok = await fresh.resolveRevealTarget(profileRoot, dataRoot, profileRoot);
    expect(ok).not.toBeNull();
    expect(ok!.isFile).toBe(false);

    // data root 本身放行。
    const okRoot = await fresh.resolveRevealTarget(profileRoot, dataRoot, dataRoot);
    expect(okRoot).not.toBeNull();

    // app-managed runtime env 树内文件放行。
    const okRuntime = await fresh.resolveRevealTarget(profileRoot, dataRoot, runtimeFile);
    expect(okRuntime).not.toBeNull();
    expect(okRuntime!.isFile).toBe(true);

    // 越界路径拒绝。
    const outside = await fresh.resolveRevealTarget(profileRoot, dataRoot, '/etc');
    expect(outside).toBeNull();

    // profile 内但不存在的路径拒绝。
    const missing = await fresh.resolveRevealTarget(
      profileRoot,
      dataRoot,
      path.join(profileRoot, 'does-not-exist'),
    );
    expect(missing).toBeNull();
  });
});

/**
 * `buildToolCatalog*` 关键不变量:
 *
 * - 本地工具白名单空 ⇒ 全开;非空 ⇒ 仅列表内,未注册的名字直接跳过(不报错)。
 * - 外部 MCP 选择空 ⇒ 不出现外部工具;非空 ⇒ server-scoped 路由,
 *   每条 route 必须带 `serverName`(消灭旧路径"按裸 toolName 路由"歧义)。
 * - 同名工具(local ∩ mcp,或 mcp ∩ mcp)→ 构建期 throw,fail-fast。
 * - sub-agent catalog **不再**按 spec.name 二次过滤(spawn_* 防递归保护已下沉
 *   到 `app subagent` 命令内部的 `ensureSpawnPrerequisites`)—— `app` 是
 *   sub-agent 触达全部应用能力的唯一入口,按 name 移除等于禁掉所有能力。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';


vi.mock('@main/pi/mcp', () => ({
  listAllMcpTools: vi.fn(),
}));

// pi-ai 是 ESM-only 动态 import;mock 它的 Type.Unsafe 让 catalog 构造的
// `parameters` 是可被断言的对象(原 schema 透传)。
vi.mock('@earendil-works/pi-ai', async () => ({
  Type: {
    Unsafe: (schema: Record<string, unknown>) => schema,
  },
}));

import { listAllMcpTools } from '../mcp';
import { buildToolCatalogForAgent, buildToolCatalogForSubAgent } from '../toolCatalog';
import { tools as localRegistry } from '../tools/registry';

// 把 tools/index 副作用先跑一遍(它会注册所有真实工具),让后续
// `freshRegistry()` 清空再灌假工具时,`ensureToolsRegistered()` 内的
// 静态 toolsReady promise 已经 resolved —— 不会再重新注册。
import '../tools/index';

const mockedListAllMcp = vi.mocked(listAllMcpTools);

function freshRegistry(): void {
  const internalEntries = (localRegistry as unknown as { entries: Map<string, unknown> }).entries;
  internalEntries.clear();
  localRegistry.register({
    spec: { name: 'local_a', description: 'a', parameters: {} as never },
    handler: async () => ({ ok: true, content: 'a' }),
  });
  localRegistry.register({
    spec: { name: 'local_b', description: 'b', parameters: {} as never },
    handler: async () => ({ ok: true, content: 'b' }),
  });
  localRegistry.register({
    // 第三个虚拟本地工具 —— 没有特殊语义,仅用来证明 sub-agent catalog
    // 不会再"按 name 移除"它(老代码会硬过滤 spawn_*;新世界不再做)。
    spec: { name: 'app', description: 'mock app facade', parameters: {} as never },
    handler: async () => ({ ok: true, content: 'app' }),
  });
}

describe('buildToolCatalogForAgent', () => {
  beforeEach(() => {
    freshRegistry();
    mockedListAllMcp.mockReset();
    mockedListAllMcp.mockResolvedValue([]);
  });

  it('tools 缺席 ⇒ 全开本地工具', async () => {
    const catalog = await buildToolCatalogForAgent({
      emoji: '', name: 'A', model: 'p::m',
      mcpServers: [], systemPrompt: '',
    });
    expect(catalog.specs.map((s) => s.name).sort()).toEqual(['app', 'local_a', 'local_b']);
    for (const route of catalog.routes.values()) {
      expect(route.kind).toBe('local');
    }
  });

  it('tools=[] ⇒ 全开(与缺席等价)', async () => {
    const catalog = await buildToolCatalogForAgent({
      emoji: '', name: 'A', model: 'p::m',
      tools: [], mcpServers: [], systemPrompt: '',
    });
    expect(catalog.specs.length).toBe(3);
  });

  it('tools=[...] ⇒ 仅列表内,未知名字静默跳过', async () => {
    const catalog = await buildToolCatalogForAgent({
      emoji: '', name: 'A', model: 'p::m',
      tools: ['local_a', 'nonexistent'], mcpServers: [], systemPrompt: '',
    });
    expect(catalog.specs.map((s) => s.name)).toEqual(['local_a']);
  });

  it('mcpServers 注入 server-scoped 路由', async () => {
    mockedListAllMcp.mockResolvedValue([
      { serverName: 'srv1', name: 'mcp_x', description: 'x', inputSchema: { type: 'object' } },
      { serverName: 'srv2', name: 'mcp_y', description: 'y', inputSchema: { type: 'object' } },
    ]);
    const catalog = await buildToolCatalogForAgent({
      emoji: '', name: 'A', model: 'p::m',
      tools: [],
      mcpServers: [{ name: 'srv1', tools: [] }],
      systemPrompt: '',
    });
    expect(catalog.specs.map((s) => s.name).sort()).toEqual(['app', 'local_a', 'local_b', 'mcp_x']);
    expect(catalog.routes.get('mcp_x')).toEqual({ kind: 'mcp', serverName: 'srv1' });
    expect(catalog.routes.get('mcp_y')).toBeUndefined();
  });

  it('本地与 mcp 同名 ⇒ 构建期 throw', async () => {
    mockedListAllMcp.mockResolvedValue([
      { serverName: 'srv1', name: 'local_a', description: 'collision', inputSchema: { type: 'object' } },
    ]);
    await expect(
      buildToolCatalogForAgent({
        emoji: '', name: 'A', model: 'p::m',
        tools: [], mcpServers: [{ name: 'srv1', tools: [] }], systemPrompt: '',
      }),
    ).rejects.toThrow(/duplicate tool name "local_a"/);
  });

  it('两个 mcp server 同名 ⇒ 构建期 throw', async () => {
    mockedListAllMcp.mockResolvedValue([
      { serverName: 'srv1', name: 'shared', description: 'x', inputSchema: { type: 'object' } },
      { serverName: 'srv2', name: 'shared', description: 'y', inputSchema: { type: 'object' } },
    ]);
    await expect(
      buildToolCatalogForAgent({
        emoji: '', name: 'A', model: 'p::m',
        // 给一个不存在的名字 -> 本地白名单结果为空集,避免 local_a 占用 'shared'。
        tools: ['nothing'],
        mcpServers: [
          { name: 'srv1', tools: [] },
          { name: 'srv2', tools: [] },
        ],
        systemPrompt: '',
      }),
    ).rejects.toThrow(/duplicate tool name "shared"/);
  });
});

describe('buildToolCatalogForSubAgent', () => {
  beforeEach(() => {
    freshRegistry();
    mockedListAllMcp.mockReset();
    mockedListAllMcp.mockResolvedValue([]);
  });

  it('sub-agent catalog 保留 app 工具(spawn 递归保护已下沉到 `app subagent` 命令)', async () => {
    const catalog = await buildToolCatalogForSubAgent(
      { tools: ['local_a', 'app'] },
      [],
    );
    // 老语义会强制移除 `app`(那时是 spawn_subagent);新语义保留。
    expect(catalog.specs.map((s) => s.name).sort()).toEqual(['app', 'local_a']);
  });

  it('sub-agent catalog 仍尊重 disallowTools 黑名单(普通 tool 名)', async () => {
    const catalog = await buildToolCatalogForSubAgent(
      { tools: ['local_a', 'local_b'], disallowTools: ['local_b'] },
      [],
    );
    expect(catalog.specs.map((s) => s.name)).toEqual(['local_a']);
  });
});

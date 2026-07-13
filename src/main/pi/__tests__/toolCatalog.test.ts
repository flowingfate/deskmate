/**
 * `buildToolCatalog*` 关键不变量:
 *
 * - 本地工具白名单空 ⇒ 全开;非空 ⇒ 仅列表内,未注册的名字直接跳过(不报错)。
 * - 外部 MCP tool 以 `serverName/toolName` 注册给 LLM，同名 tool 可由多个
 *   server 同时暴露；route 保存原始 serverName / toolName 供精确执行。
 * - 仅 LLM 限定名碰撞才构建期 throw，避免静默覆盖。
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
import { buildToolCatalogForAgent, buildToolCatalogForSubAgent, ToolCatalog } from '../toolCatalog';
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
    expect(catalog.getRoute('local_a')).toEqual({ kind: 'local', toolName: 'local_a' });
    expect(catalog.getRoute('local_b')).toEqual({ kind: 'local', toolName: 'local_b' });
    expect(catalog.getRoute('app')).toEqual({ kind: 'local', toolName: 'app' });
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

  it('mcpServers 以 serverName/toolName 注入 LLM 目录', async () => {
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
    expect(catalog.specs.map((s) => s.name).sort()).toEqual(['app', 'local_a', 'local_b', 'srv1/mcp_x']);
    expect(catalog.getRoute('srv1/mcp_x')).toEqual({ kind: 'mcp', serverName: 'srv1', toolName: 'mcp_x' });
    expect(catalog.getRoute('srv2/mcp_y')).toBeUndefined();
  });

  it('本地与 MCP 同名 tool 可同时暴露', async () => {
    mockedListAllMcp.mockResolvedValue([
      { serverName: 'srv1', name: 'local_a', description: 'collision', inputSchema: { type: 'object' } },
    ]);
    const catalog = await buildToolCatalogForAgent({
      emoji: '', name: 'A', model: 'p::m',
      tools: [], mcpServers: [{ name: 'srv1', tools: [] }], systemPrompt: '',
    });
    expect(catalog.specs.map((s) => s.name).sort()).toEqual(['app', 'local_a', 'local_b', 'srv1/local_a']);
    expect(catalog.getRoute('local_a')).toEqual({ kind: 'local', toolName: 'local_a' });
    expect(catalog.getRoute('srv1/local_a')).toEqual({ kind: 'mcp', serverName: 'srv1', toolName: 'local_a' });
  });

  it('两个 MCP server 的同名 tool 可同时暴露', async () => {
    mockedListAllMcp.mockResolvedValue([
      { serverName: 'srv1', name: 'shared', description: 'x', inputSchema: { type: 'object' } },
      { serverName: 'srv2', name: 'shared', description: 'y', inputSchema: { type: 'object' } },
    ]);
    const catalog = await buildToolCatalogForAgent({
      emoji: '', name: 'A', model: 'p::m',
      tools: ['nothing'],
      mcpServers: [
        { name: 'srv1', tools: [] },
        { name: 'srv2', tools: [] },
      ],
      systemPrompt: '',
    });
    expect(catalog.specs.map((s) => s.name).sort()).toEqual(['srv1/shared', 'srv2/shared']);
    expect(catalog.getRoute('srv1/shared')).toEqual({ kind: 'mcp', serverName: 'srv1', toolName: 'shared' });
    expect(catalog.getRoute('srv2/shared')).toEqual({ kind: 'mcp', serverName: 'srv2', toolName: 'shared' });
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

describe('ToolCatalog.resolveIdentity', () => {
  it('MCP 限定名 → 自然 toolName + mcp server', () => {
    const catalog = new ToolCatalog([], new Map([
      ['brave/search', { kind: 'mcp', serverName: 'brave', toolName: 'search' }],
    ]));
    expect(catalog.resolveIdentity('brave/search')).toEqual({ name: 'search', mcp: 'brave' });
  });

  it('local 名 → 自然 toolName, mcp 缺席', () => {
    const catalog = new ToolCatalog([], new Map([
      ['read', { kind: 'local', toolName: 'read' }],
    ]));
    expect(catalog.resolveIdentity('read')).toEqual({ name: 'read', mcp: undefined });
  });

  it('route 缺席 → name 回退到 llmName, mcp 缺席', () => {
    expect(ToolCatalog.empty().resolveIdentity('ghost')).toEqual({ name: 'ghost', mcp: undefined });
  });
});

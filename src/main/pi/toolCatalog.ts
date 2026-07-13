/**
 * Per-turn 工具目录:把"本轮 LLM 看得见的 pi.Tool[]"与"执行时按工具名找到
 * 应去哪个 runtime"两件事打包成一个不可变快照。
 *
 * MCP 工具名在 LLM 侧按 `${serverName}/${toolName}` 限定，允许不同 server
 * 暴露同名工具。入境调用以 routes 精确查表，**绝不**按 `/` 反解。
 *
 * 若限定名仍冲突（例如 server / tool 本身含 `/` 导致拼接相同），构建期 throw，
 * 不做优先级或静默覆盖。
 */

import type { Tool as PiTool } from '@earendil-works/pi-ai';

import type { AgentConfig } from './utils/config';
import { listAllMcpTools } from './mcp';
import { tools as localTools, ensureToolsRegistered } from './tools/registry';
import type { LocalTool } from './tools/types';


/** 每条 route 都保存其原始 toolName；MCP route 额外保存 serverName。 */
export type ToolRoute =
  | { kind: 'local'; toolName: string }
  | { kind: 'mcp'; serverName: string; toolName: string };

/**
 * per-turn 工具目录快照。`specs` 直接喂给 pi-ai(公开只读);`routes` 是执行侧
 * dispatch 表,收为 private —— 消费方一律走方法,不直接摸 Map:
 *   - `getRoute(llmName)`:按 LLM 限定名精确取 route(执行 dispatch)。
 *   - `resolveIdentity(llmName)`:把限定名 demux 回自然 `name` + `mcp` server。
 */
export class ToolCatalog {
  constructor(
    readonly specs: PiTool[],
    private readonly routes: ReadonlyMap<string, ToolRoute>,
  ) {}

  /** 无工具能力 / 构建失败时的空目录。 */
  static empty(): ToolCatalog {
    return new ToolCatalog([], new Map());
  }

  /** 按 LLM 限定名精确取 route(执行 dispatch);缺席(LLM 叫了不在 list 的 tool)返回 undefined。 */
  getRoute(llmName: string): ToolRoute | undefined {
    return this.routes.get(llmName);
  }

  /**
   * 把 LLM 限定名还原为 Domain 侧可读的自然 `name` + MCP `mcp` server。
   * 「LLM 限定名 → 自然名+mcp」这条 demux 规则的**唯一实现** —— messageBridge
   * 入境、session 流式 chunk、sub-agent hooks 展示名都调它,绝不各自 inline
   * `route.toolName` / `route.kind === 'mcp'` 判别。route 缺席(不该发生)时
   * name 回退到原始 llmName。
   */
  resolveIdentity(llmName: string): { name: string; mcp: string | undefined } {
    const route = this.routes.get(llmName);
    if (route?.kind === 'mcp') return { name: route.toolName, mcp: route.serverName };
    return { name: route?.toolName ?? llmName, mcp: undefined };
  }
}

/**
 * Sub-agent 视角的 MCP server 选择:已经被 `subAgentMcpResolver` 解析到具体
 * server name + 该 server 的工具白名单(空数组 = 该 server 全部)。
 */
export interface SubAgentMcpSelection {
  name: string;
  tools: string[];
}

/**
 * 给主 agent 构建 catalog。
 *
 * 语义(参考 task.md §3.5 故意不对称):
 *   - `agentCfg.tools` 缺席 / `undefined` ⇒ 全部本地工具(默认全开)
 *   - `agentCfg.tools = []` ⇒ 同上(全开),与"未配置"语义一致
 *   - `agentCfg.tools = [...names]` ⇒ 仅列表内
 *   - `agentCfg.mcpServers` 缺席 / `[]` ⇒ 不启用任何外部 MCP
 *   - `agentCfg.mcpServers = [...]` ⇒ 仅列表内,每项 `tools` 同样空=该 server 全部
 *
 * 本地工具列表里如果引用了未注册的名字(uninstall 后残留 / typo),保留为
 * "unavailable selection" —— 这里直接跳过,UI 侧负责显示警示。
 */
export async function buildToolCatalogForAgent(agentCfg: AgentConfig): Promise<ToolCatalog> {
  await ensureToolsRegistered();
  const routes = new Map<string, ToolRoute>();
  const specs: PiTool[] = [];

  const selectedLocal = pickLocalSubset(agentCfg.tools);
  for (const tool of selectedLocal) {
    routes.set(tool.spec.name, { kind: 'local', toolName: tool.spec.name });
    specs.push(tool.spec);
  }

  await appendMcpTools(routes, specs, agentCfg.mcpServers ?? []);
  return new ToolCatalog(specs, routes);
}

/**
 * 给 sub-agent 构建 catalog。
 *
 * 与主 agent 不同点:
 *   - mcp 白/黑名单已由 `subAgentMcpResolver` 解析为 `mcpSelections`,这里
 *     不再走 inherit 合并逻辑。
 *   - 本地工具读 `cfg.tools`(白名单)与 `cfg.disallowTools`(黑名单);
 *     语义与主 agent 主体一致 + 黑名单二次过滤。
 *
 * **递归保护**走 `app subagent ...` 命令内部的 `ensureSpawnPrerequisites`
 * —— sub-agent 调到那条命令时 `ctx.isSubAgent === true`,命令立即 exit 1
 * 并写 stderr。这里**不**再按 spec.name 二次过滤:
 *   - 老 `spawn_subagent` / `spawn_subagents` LocalTool 已物理删除,catalog
 *     不可能再列。
 *   - 替代品 `app` 工具是 sub-agent 触达全部应用能力的**唯一**入口,绝不
 *     能整体移除;按 name 移除等于禁掉所有应用能力,与设计文档 §4
 *     "`app` 永远 always-visible" 红线冲突。
 */
export async function buildToolCatalogForSubAgent(
  cfg: { tools?: string[]; disallowTools?: string[] },
  mcpSelections: SubAgentMcpSelection[],
): Promise<ToolCatalog> {
  await ensureToolsRegistered();
  const routes = new Map<string, ToolRoute>();
  const specs: PiTool[] = [];

  let selectedLocal = pickLocalSubset(cfg.tools);
  if (cfg.disallowTools && cfg.disallowTools.length > 0) {
    const denied = new Set(cfg.disallowTools);
    selectedLocal = selectedLocal.filter((t) => !denied.has(t.spec.name));
  }
  for (const tool of selectedLocal) {
    routes.set(tool.spec.name, { kind: 'local', toolName: tool.spec.name });
    specs.push(tool.spec);
  }

  await appendMcpTools(routes, specs, mcpSelections);
  return new ToolCatalog(specs, routes);
}

// ─── internal ────────────────────────────────────────────────────────────

/**
 * 主 agent / sub-agent 共用的"本地工具白名单解析":
 *   - 未给(undefined)或给了空数组 = 全开(取 registry 全集)
 *   - 给了非空数组 = 取名字在列表里且已注册的工具(未注册的静默跳过)
 *
 * 主 agent / sub-agent / 测试三处需要 lock-step 同一份"全开 vs 白名单"
 * 语义,所以这里值得提一个共享 helper。
 */
function pickLocalSubset(selection: string[] | undefined): LocalTool[] {
  if (!selection || selection.length === 0) return localTools.list();
  const wanted = new Set(selection);
  return localTools.list().filter((t) => wanted.has(t.spec.name));
}

/**
 * 追加 MCP 工具到正在构建的 catalog。LLM 名称以 serverName 限定；只有完整
 * 限定名碰撞才 fail-fast。空 selection 不调 mcpClientManager，给无外部 MCP
 * agent 省一次远端 round-trip。
 */
async function appendMcpTools(
  routes: Map<string, ToolRoute>,
  specs: PiTool[],
  mcpSelections: SubAgentMcpSelection[],
): Promise<void> {
  if (mcpSelections.length === 0) return;

  const allMcpTools = await listAllMcpTools();
  const wantedByServer = new Map<string, Set<string> | null>();
  for (const sel of mcpSelections) {
    // 空 tools 列表 = 该 server 全部工具
    wantedByServer.set(sel.name, sel.tools && sel.tools.length > 0 ? new Set(sel.tools) : null);
  }

  // pi-ai 是 ESM-only,主进程 CJS bundle 静态 import 会触发 interop;
  // 项目 invariant 是"pi-ai 全仓库统一动态 import"。见 pi/ai.prompt.md。
  const pi = await import('@earendil-works/pi-ai');

  for (const t of allMcpTools) {
    const selected = wantedByServer.get(t.serverName);
    if (selected === undefined) continue; // 该 server 未在白名单
    if (selected !== null && !selected.has(t.name)) continue;
    const llmToolName = `${t.serverName}/${t.name}`;
    const prev = routes.get(llmToolName);
    if (prev) {
      const prevDesc = prev.kind === 'local' ? 'local' : `mcp[${prev.serverName}/${prev.toolName}]`;
      throw new Error(
        `[toolCatalog] duplicate LLM tool name "${llmToolName}": already from ${prevDesc}, also exposed by mcp[${t.serverName}/${t.name}]`,
      );
    }
    routes.set(llmToolName, { kind: 'mcp', serverName: t.serverName, toolName: t.name });
    specs.push({
      name: llmToolName,
      description: t.description ?? '',
      parameters: pi.Type.Unsafe(t.inputSchema ?? {}),
    });
  }
}

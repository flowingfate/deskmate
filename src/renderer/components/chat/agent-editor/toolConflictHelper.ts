/**
 * Agent editor 跨 tab 共享的"工具名冲突检测"工具。
 *
 * 冲突判定语义:同一 toolName 同时被两条来源(两个 MCP server / local +
 * MCP server)选中。冲突时不能保存(LLM API 会因重名 tool 拒绝整个 tool list)。
 *
 * 输入是抽象"selection",不绑特定 React component;Agent editor 的 MCP
 * tab 与 tools tab 都用同一组算子:
 * - `detectGlobalConflicts({ selections })` — 返回 `toolName → Conflict` 的映射。
 * - `isToolConflicted` / `sourceHasConflicts` / `getConflictTooltip` — 派生查询。
 * - `checkToolConflict` — 选中前的快速冲突预检。
 *
 * 这里**只**关心 name → source 的多对一关系,不关心"工具来自 local 还是
 * external" —— Phase 2 内 tools tab 只检测 tools 自己集合内的重复(不应有),
 * 但通常 local 工具是单一来源,所以更多用于 MCP tab 中两 server 间的冲突。
 * 跨 tab 冲突(local 与 mcp 同名)Phase 1 `buildToolCatalogForAgent` 会在
 * pi 层运行时 fail-fast 报错;UI 端不必再做。
 */

/** 来源:`{ name, availableTools }` 表示一个工具来源(server / local)及其可选工具集。 */
export interface ToolSource {
  /** 来源标识(MCP server name,或 "local")。 */
  name: string;
  /** 该来源全量可选工具集。 */
  availableTools: { name: string }[];
}

/** 选中集合:来源名 → 选中的工具名集合。空 Set ≡ "全选"。 */
export type SelectionsMap = ReadonlyMap<string, ReadonlySet<string>>;

export interface ToolConflict {
  toolName: string;
  /** 此工具被多少来源同时选中。 */
  sources: string[];
}

export type ConflictMap = ReadonlyMap<string, ToolConflict>;

/**
 * 全量扫描:遍历每个选中来源,展开其实际选中的工具,聚合"toolName → sources[]";
 * sources 长度 >1 即冲突。
 *
 * `sources` 提供来源元数据(name + availableTools),`selections` 提供选中态。
 * 来源若在 `selections` 中缺席则视为未选中,完全跳过。
 */
export function detectGlobalConflicts(
  sources: readonly ToolSource[],
  selections: SelectionsMap,
): ConflictMap {
  const toolToSources = new Map<string, string[]>();

  selections.forEach((selectedTools, sourceName) => {
    const source = sources.find((s) => s.name === sourceName);
    if (!source) return;

    const actualSelected =
      selectedTools.size === 0
        ? source.availableTools
        : source.availableTools.filter((t) => selectedTools.has(t.name));

    actualSelected.forEach((tool) => {
      const list = toolToSources.get(tool.name) || [];
      if (!list.includes(sourceName)) {
        list.push(sourceName);
      }
      toolToSources.set(tool.name, list);
    });
  });

  const conflicts = new Map<string, ToolConflict>();
  toolToSources.forEach((list, toolName) => {
    if (list.length > 1) {
      conflicts.set(toolName, { toolName, sources: list });
    }
  });
  return conflicts;
}

/** 某条工具在某来源下是否处于冲突态。 */
export function isToolConflicted(
  conflicts: ConflictMap,
  toolName: string,
  sourceName: string,
): boolean {
  const conflict = conflicts.get(toolName);
  return conflict !== undefined && conflict.sources.includes(sourceName);
}

/** 某来源是否参与任何冲突。 */
export function sourceHasConflicts(
  conflicts: ConflictMap,
  sourceName: string,
): boolean {
  for (const conflict of conflicts.values()) {
    if (conflict.sources.includes(sourceName)) return true;
  }
  return false;
}

/** 多行 tooltip 文案:罗列同名冲突的所有来源 + 警示。 */
export function getConflictTooltip(
  conflicts: ConflictMap,
  toolName: string,
): string {
  const conflict = conflicts.get(toolName);
  if (!conflict) return '';
  return `⚠️ Tool Name Conflict!\n"${toolName}" appears in:\n${conflict.sources
    .map((s) => `  • ${s}`)
    .join(
      '\n',
    )}\n\n⚠️ IMPORTANT: LLM API will discard the entire tool list!`;
}

/**
 * 在选中操作触发前的快速预检:给定当前选择状态,询问"如果我把 `toolName`
 * 加进 `currentSourceName` 的选中集,是否会冲突"。
 *
 * 实现等价于:把当前来源 `currentSourceName` 排除,看其它来源的展开选中
 * 集是否已经包含 `toolName`。
 */
export function checkToolConflict(
  sources: readonly ToolSource[],
  selections: SelectionsMap,
  toolName: string,
  currentSourceName: string,
): boolean {
  const otherSelected = new Set<string>();

  selections.forEach((selectedTools, sourceName) => {
    if (sourceName === currentSourceName) return;
    const source = sources.find((s) => s.name === sourceName);
    if (!source) return;

    if (selectedTools.size === 0) {
      source.availableTools.forEach((t) => otherSelected.add(t.name));
    } else {
      selectedTools.forEach((name) => otherSelected.add(name));
    }
  });

  return otherSelected.has(toolName);
}

// 从 LogRow[] 重建 span 森林。
//
// 设计：一个 span = 同一个 (trace_id, span_id) 下的所有 log row 合并。
//   - 一个 span 一般是 INFO 始 + INFO 终（共享 sid），终行带 dur。
//   - 但也可能：只有终（始被裁了）/ 只有始（进程崩了）/ 多于 2（中间错误 WARN 复用同 sid）。
//     这些都退化成"取最早 ts 当 startTs，取带 dur 的那行算 endTs，否则 endTs = max(ts)"。
//   - psid → sid 拼父子；找不到 parent 的就是 root（多 root 视为森林）。
//
// 排序：兄弟按 startTs 升序，父子按 DFS。
//
// 注意：这个文件是 viewer-only 的纯逻辑，不依赖 React / Electron / dom。
// 易于在 vitest 里跑、也方便未来 doctor / CLI 复用。

import type { LogRow } from '@shared/log/types';

export interface SpanNode {
  sid: string;
  /** psid；root 节点为 null。 */
  psid: string | null;
  /** component 名（trace 设计里就是 mod，如 chat.turn）。null 表示同 sid 内 component 不一致（罕见）。 */
  mod: string | null;
  /** 起始时间戳（ms）。取该 span 行里最小的 ts。 */
  startTs: number;
  /** 结束时间戳。优先用 (startTs + dur) 当带 dur 的行；否则取 max(ts)。 */
  endTs: number;
  /** 是否带 dur（即收到了"span 终"那条 log）。无 dur 表示这是一个孤儿 span。 */
  hasDur: boolean;
  /** span 内所有 log 的 max(level)，用于 lane 边色与点的 status。 */
  maxLevel: number;
  /** 是否任意行带 err_message。 */
  hasError: boolean;
  /** 进程类型集合（一个 span 可能跨进程？理论上不会，但兜底） */
  processTypes: Set<string>;
  /** 关联的所有 log row（按 ts 升序）。 */
  rows: LogRow[];
  /** 子 span 列表（DFS 排序后填入）。 */
  children: SpanNode[];
  /** DFS 时的层级，0 = root。 */
  depth: number;
}

/** 没有 span_id 的孤儿行（业务 log，未挂 trace）。 */
export interface OrphanRow {
  row: LogRow;
}

export interface SpanForest {
  /** 顶层 span，按 startTs 升序。 */
  roots: SpanNode[];
  /** DFS 展开顺序，方便直接渲染（depth 已填好）。 */
  flat: SpanNode[];
  /** 没有 span_id 的孤儿（一般是无 trace 的业务 log）。 */
  orphans: OrphanRow[];
  /** 全局时间窗。 */
  minTs: number;
  maxTs: number;
}

/**
 * 把 trace 内的 LogRow[] 折叠成 span 森林。
 *
 * 不会修改入参；返回的 SpanNode 引用稳定（同次调用内）。
 */
export function buildSpanForest(rows: LogRow[]): SpanForest {
  if (rows.length === 0) {
    return { roots: [], flat: [], orphans: [], minTs: 0, maxTs: 0 };
  }

  // 按 ts 升序，便于聚合时"起" 在前、"终"在后。
  const sorted = [...rows].sort((a, b) => a.ts - b.ts);

  const bySid = new Map<string, SpanNode>();
  const orphans: OrphanRow[] = [];
  let minTs = sorted[0].ts;
  let maxTs = sorted[0].ts;

  for (const r of sorted) {
    if (r.ts < minTs) minTs = r.ts;
    if (r.ts > maxTs) maxTs = r.ts;
    if (!r.span_id) {
      orphans.push({ row: r });
      continue;
    }
    let node = bySid.get(r.span_id);
    if (!node) {
      node = {
        sid: r.span_id,
        psid: r.parent_span_id,
        mod: r.component,
        startTs: r.ts,
        endTs: r.ts,
        hasDur: false,
        maxLevel: r.level,
        hasError: !!r.err_message,
        processTypes: new Set([r.process_type]),
        rows: [r],
        children: [],
        depth: 0,
      };
      bySid.set(r.span_id, node);
    } else {
      // 累积：同一 sid 的后续行
      node.rows.push(r);
      if (r.level > node.maxLevel) node.maxLevel = r.level;
      if (r.err_message) node.hasError = true;
      if (r.parent_span_id && !node.psid) node.psid = r.parent_span_id;
      if (node.mod && r.component !== node.mod) {
        // 同 sid 内 component 不一致：保守置 null，UI 用 "(mixed)" 展示。
        // 实际不会发生，但宁可显式空。
        node.mod = null;
      }
      node.processTypes.add(r.process_type);
      // startTs 已经是最早的（因为 sorted ascending），不更新；
      // endTs：先以 max(ts) 兜底，下面再用 dur 修正。
      if (r.ts > node.endTs) node.endTs = r.ts;
    }
    // dur 字段在 fields JSON 里；遇到第一条带 dur 的行就用 startTs + dur 当 endTs。
    // 这样比 max(ts) 精确（虽然单 ms 内两者基本相同）。
    if (!node.hasDur) {
      const dur = readDur(r);
      if (dur != null) {
        node.endTs = node.startTs + dur;
        node.hasDur = true;
      }
    }
  }

  // 拼父子：psid → bySid 找 parent；找不到的就是 root。
  const roots: SpanNode[] = [];
  for (const node of bySid.values()) {
    if (node.psid && bySid.has(node.psid)) {
      bySid.get(node.psid)!.children.push(node);
    } else {
      // 没有 psid 或 psid 不在本 trace 里：当 root 处理（孤立子树仍可呈现）
      roots.push(node);
    }
  }

  // 兄弟按 startTs 排序，递归子树。
  roots.sort((a, b) => a.startTs - b.startTs);
  for (const node of bySid.values()) {
    node.children.sort((a, b) => a.startTs - b.startTs);
  }

  // DFS 展平并填 depth。
  const flat: SpanNode[] = [];
  function visit(node: SpanNode, depth: number) {
    node.depth = depth;
    flat.push(node);
    for (const c of node.children) visit(c, depth + 1);
  }
  for (const r of roots) visit(r, 0);

  return { roots, flat, orphans, minTs, maxTs };
}

/** 从 row.fields JSON 里读 dur 字段；失败/缺失返回 null。 */
function readDur(row: LogRow): number | null {
  if (!row.fields) return null;
  try {
    const obj: unknown = JSON.parse(row.fields);
    if (obj && typeof obj === 'object' && 'dur' in obj) {
      const v = (obj as { dur: unknown }).dur;
      if (typeof v === 'number' && Number.isFinite(v) && v >= 0) return v;
    }
  } catch {
    // fields 不一定是合法 JSON（极少数情况）；当无 dur 处理。
  }
  return null;
}


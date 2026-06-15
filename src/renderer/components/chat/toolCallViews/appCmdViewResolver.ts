// src/renderer/components/chat/toolCallViews/appCmdViewResolver.ts
// 把 `app` LocalTool 的 cmdline 字符串映射到具体的 custom view 组件。
//
// 设计纪律(ai.prompt/tool-system.md §9.5 "UI resolver 的纪律"):
//   - **纯函数 + renderer 侧**;不引入 main 进程的 vendored argsTokenizer ——
//     renderer 要的是"足够好让 UI dispatch",不是"语法完美"。
//   - 只切前若干非 flag token:`subagent spawn` → 单 task view,
//     `subagent spawn-many` → 并行 view;空 / 解析失败 → null(走默认 view)。
//   - 不试图解析 flag value;只用第一个 / 第二个非 flag token 决定 dispatch。
//     **flag 数据由 view 内部 helper 解析**,资源各自承担,resolver 不偷跑。
//
// 与 main 进程的 `parseCmdline` 关系:不共用。renderer 只需要"找到子命令名"
// 这个最弱契约,不需要正确处理 `'a"b'c\\d` 边角 case —— 那些 LLM 没在 view
// dispatch 路径上写。任何过于花哨的 cmdline 会 fallback 到默认 view,损失只
// 是"展示成纯文本",不会崩。
import type React from 'react';
import type { ToolCallViewProps } from './types';
import { SubAgentToolCallView, ParallelSubAgentsToolCallView } from './SubAgentToolCallView';

/**
 * 切 cmdline 前 N 个**非 flag** token —— 用最朴素的空白切分。
 *
 * - 不处理 quoting/escape;含引号的 token 会被切错,但 dispatch 只看前
 *   2 个 token,引号通常出现在 task 描述等后置 positional,影响很小。
 * - flag(`-` 或 `--` 开头)与其紧跟的 value(`--foo bar`)都跳过 ——
 *   "value" 用启发式:flag spec 在 renderer 不可见,所以一律把"`--foo`
 *   之后的下一个非 `--` 开头的 token"也跳过。简单但有 corner case
 *   (boolean flag 后第一个 positional 会被吞)—— 但实践里 LLM 把 positional
 *   写在 flag 前面(`subagent spawn foo "task" --share-context`),所以
 *   命中率很高。
 *
 * 这条 helper **只**给 view dispatch 用,不要被复用到任何带语义的位置。
 */
function firstNonFlagTokens(cmdline: string, max: number): string[] {
  const out: string[] = [];
  const tokens = cmdline.trim().split(/\s+/);
  let i = 0;
  while (i < tokens.length && out.length < max) {
    const t = tokens[i];
    if (t.startsWith('--') || (t.startsWith('-') && t.length > 1)) {
      // 启发式跳过 flag value:下一个不以 `-` 开头的 token 也跳过。
      // 真假阳性都接受 —— resolver 只关心命中"前 2 个 positional"。
      i++;
      if (i < tokens.length && !tokens[i].startsWith('-')) i++;
      continue;
    }
    out.push(t);
    i++;
  }
  return out;
}

/**
 * `app` 工具 args 形态:`{ cmd: string }`。Domain ToolCall.args 已是结构化
 * 对象;直接读取 `args.cmd`,缺失返回空字符串。
 */
export function extractAppCmdline(rawArgs: Record<string, unknown> | undefined): string {
  if (!rawArgs) return '';
  const cmd = (rawArgs as { cmd?: unknown }).cmd;
  return typeof cmd === 'string' ? cmd : '';
}

/**
 * 把 `app` cmdline 映射成形如 `app:<command>` / `app:<command>.<subcommand>`
 * 的虚拟 view key。用于 `getToolCallView` 内部 switch。
 *
 * 例子:
 *   "subagent spawn researcher \"...\""        → "app:subagent.spawn"
 *   "subagent spawn-many --task ..."          → "app:subagent.spawn-many"
 *   "mcp install brave"                       → "app:mcp.install"
 *   ""                                         → "app"
 *   "--help"                                   → "app"
 *   "subagent --help"                          → "app:subagent"
 *
 * 形态选 `app:<x>.<y>` 而不是 `app.<x>.<y>` —— 与 mcp/agent 等子命令域的
 * "命名空间感"对齐(冒号 = 跨命名空间,点 = 命名空间内分隔)。`hasCustomView`
 * / `getToolCallView` 不依赖此精确字符串格式,只 switch case;留出符号便于
 * 调试时人眼区分。
 */
export function resolveAppCmdViewKey(rawArgs: Record<string, unknown> | undefined): string {
  const cmdline = extractAppCmdline(rawArgs);
  if (!cmdline.trim()) return 'app';
  const tokens = firstNonFlagTokens(cmdline, 2);
  if (tokens.length === 0) return 'app';
  if (tokens.length === 1) return `app:${tokens[0]}`;
  return `app:${tokens[0]}.${tokens[1]}`;
}

/**
 * 给定 toolName + 原始 args,返回对应 view 组件(无匹配 → null,走默认 view)。
 *
 * `toolName !== 'app'` 时返回 null —— 老工具的 dispatch 仍走 `getToolCallView`
 * 主 switch,本 resolver **只**接管 `app` 域。
 */
export function resolveAppCmdView(
  toolName: string,
  rawArgs: Record<string, unknown> | undefined,
): React.ComponentType<ToolCallViewProps> | null {
  if (toolName !== 'app') return null;
  const key = resolveAppCmdViewKey(rawArgs);
  switch (key) {
    case 'app:subagent.spawn':
      return SubAgentToolCallView;
    case 'app:subagent.spawn-many':
      return ParallelSubAgentsToolCallView;
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Cmdline → 子命令参数解析(view 内部使用)
// ---------------------------------------------------------------------------

/**
 * 把 cmdline tokenize 成 argv —— renderer 简化版,只处理双 / 单引号包裹的
 * 字面值,不处理转义,不展开 `$VAR` / `~` / 任何 shell 特殊语法。
 *
 * 与 main 的 vendored `argsTokenizer` 不完全等价 —— renderer 用它只为给
 * view 取 `sub_agent_name` / `task` 等展示字段,容错偏向"宁可显示原 cmdline,
 * 别崩"。任何不可解析的 cmdline 走 fallback,view 拿到空字段照样能渲染骨架。
 */
function tokenizeForView(cmdline: string): string[] {
  const out: string[] = [];
  let buf = '';
  let quote: '"' | "'" | null = null;
  for (let i = 0; i < cmdline.length; i++) {
    const c = cmdline[i];
    if (quote) {
      if (c === quote) {
        quote = null;
      } else {
        buf += c;
      }
    } else if (c === '"' || c === "'") {
      quote = c as '"' | "'";
    } else if (/\s/.test(c)) {
      if (buf) {
        out.push(buf);
        buf = '';
      }
    } else {
      buf += c;
    }
  }
  if (buf) out.push(buf);
  return out;
}

export interface SpawnViewArgs {
  sub_agent_name: string;
  task: string;
  share_context: boolean;
}

/**
 * 从 `subagent spawn <name> <task> [--share-context]` 形态的 cmdline 抽出
 * view 渲染所需字段。`name` / `task` 解析不到时回落到空串 —— 与 view 自带
 * 的 "Unknown" / "No task description" fallback 衔接。
 */
export function parseSpawnArgsForView(rawArgs: Record<string, unknown> | undefined): SpawnViewArgs {
  const cmdline = extractAppCmdline(rawArgs);
  const tokens = tokenizeForView(cmdline);
  let name = '';
  let task = '';
  let shareContext = false;
  const positional: string[] = [];

  // 跳过前导 "subagent spawn" 两个 token,与 main router 一致。
  let i = 0;
  if (tokens[i] === 'subagent') i++;
  if (tokens[i] === 'spawn') i++;

  for (; i < tokens.length; i++) {
    const t = tokens[i];
    if (t === '--share-context') {
      shareContext = true;
    } else if (t === '--help' || t === '-h' || t === '--json' || t === '--dry-run' || t === '--yes' || t === '-y') {
      // ignore — 不影响 view 展示
    } else if (t.startsWith('--')) {
      // 未知 flag:跳过它本身;若后面紧跟非 flag,姑且当 flag value 一并跳过。
      if (i + 1 < tokens.length && !tokens[i + 1].startsWith('-')) i++;
    } else {
      positional.push(t);
    }
  }

  if (positional.length >= 1) name = positional[0];
  if (positional.length >= 2) task = positional[1];

  return { sub_agent_name: name, task, share_context: shareContext };
}

export interface SpawnManyViewArgs {
  tasks: Array<{ sub_agent_name: string; task: string }>;
}

/**
 * 从 `subagent spawn-many` 形态的 cmdline 抽出 task 列表。两条来源:
 *   - `--task "name:task description"` 可重复 → 主路径
 *   - `--config-json '<JSON>'` → escape hatch,直接 JSON.parse
 *
 * 任何 parse 失败都返回空 tasks —— view 顶部会展示 "0 tasks",符合 LLM
 * 拿到 exit 2 后的"我得改下命令"反馈循环;不在 renderer 弹错误。
 */
export function parseSpawnManyArgsForView(rawArgs: Record<string, unknown> | undefined): SpawnManyViewArgs {
  const cmdline = extractAppCmdline(rawArgs);
  const tokens = tokenizeForView(cmdline);
  const tasks: Array<{ sub_agent_name: string; task: string }> = [];

  // 跳过前导 "subagent spawn-many"。
  let i = 0;
  if (tokens[i] === 'subagent') i++;
  if (tokens[i] === 'spawn-many') i++;

  let configJsonRaw: string | undefined;
  const taskEntries: string[] = [];

  for (; i < tokens.length; i++) {
    const t = tokens[i];
    if (t === '--task' && i + 1 < tokens.length) {
      taskEntries.push(tokens[++i]);
    } else if (t.startsWith('--task=')) {
      taskEntries.push(t.slice('--task='.length));
    } else if (t === '--config-json' && i + 1 < tokens.length) {
      configJsonRaw = tokens[++i];
    } else if (t.startsWith('--config-json=')) {
      configJsonRaw = t.slice('--config-json='.length);
    }
    // 其它 flag / positional 一律忽略 —— view 不用。
  }

  if (configJsonRaw !== undefined) {
    try {
      const parsed = JSON.parse(configJsonRaw);
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          if (item && typeof item === 'object') {
            const name = typeof item.name === 'string' ? item.name : '';
            const task = typeof item.task === 'string' ? item.task : '';
            if (name) tasks.push({ sub_agent_name: name, task });
          }
        }
      }
    } catch {
      // ignore — fall through, tasks 留空
    }
  } else {
    for (const entry of taskEntries) {
      const colon = entry.indexOf(':');
      if (colon < 0) continue;
      const name = entry.slice(0, colon).trim();
      const task = entry.slice(colon + 1).trim();
      if (name) tasks.push({ sub_agent_name: name, task });
    }
  }

  return { tasks };
}

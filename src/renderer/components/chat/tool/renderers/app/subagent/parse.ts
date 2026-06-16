// src/renderer/components/chat/tool/renderers/app/subagent/parse.ts
// `app subagent spawn` / `spawn-many` cmdline 的字段抽取 —— 仅供本子目录
// 的 input slot 提取展示字段(sub-agent 名、task 描述、share_context)。
//
// 任何 parse 失败都回落到空字段:view 顶部会展示骨架(name="Unknown",
// 0 tasks),符合 LLM 拿到 exit 2 后"我得改下命令"的反馈循环;不在 renderer
// 弹错误。

import { extractAppCmdline, tokenizeForView } from '../cmdline';

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
 * 任何 parse 失败都返回空 tasks。
 */
export function parseSpawnManyArgsForView(
  rawArgs: Record<string, unknown> | undefined,
): SpawnManyViewArgs {
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

// src/renderer/components/chat/tool/renderers/app/cmdline.ts
// `app` LocalTool 的 cmdline 解析 helpers —— 仅供 app renderer 内部子命令
// 分派 + 子命令各自的 input slot 提取展示字段。
//
// 设计纪律(ai.prompt/tool-system.md §9.5 "UI resolver 的纪律"):
//   - **纯函数 + renderer 侧**;不引入 main 进程的 vendored argsTokenizer ——
//     renderer 要的是"足够好让 UI 取值",不是"语法完美"。
//   - 只解析 view 实际要展示的字段;flag value 各自承担。
//
// 与 main 进程的 `parseCmdline` 关系:不共用。任何过于花哨的 cmdline 会
// fallback 到默认渲染,损失只是"展示成纯文本",不会崩。

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
 * 切 cmdline 前 N 个**非 flag** token —— 用最朴素的空白切分。
 *
 * - 不处理 quoting/escape;含引号的 token 会被切错,但子命令分派只看前 1-2
 *   个 token,引号通常出现在 task 描述等后置 positional,影响很小。
 * - flag(`-` 或 `--` 开头)与其紧跟的 value(`--foo bar`)都跳过 ——
 *   "value" 用启发式:flag spec 在 renderer 不可见,所以一律把"`--foo`
 *   之后的下一个非 `--` 开头的 token"也跳过。简单但有 corner case
 *   (boolean flag 后第一个 positional 会被吞)—— 但实践里 LLM 把 positional
 *   写在 flag 前面(`subagent spawn foo "task" --share-context`),所以
 *   命中率很高。
 *
 * **只**给 view dispatch / chip label 用,不要被复用到任何带语义的位置。
 */
export function firstNonFlagTokens(cmdline: string, max: number): string[] {
  const out: string[] = [];
  const tokens = cmdline.trim().split(/\s+/);
  let i = 0;
  while (i < tokens.length && out.length < max) {
    const t = tokens[i];
    if (t.startsWith('--') || (t.startsWith('-') && t.length > 1)) {
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
 * 把 cmdline tokenize 成 argv —— renderer 简化版,只处理双 / 单引号包裹的
 * 字面值,不处理转义,不展开 `$VAR` / `~` / 任何 shell 特殊语法。
 *
 * 与 main 的 vendored `argsTokenizer` 不完全等价 —— renderer 用它只为给
 * view 取 `sub_agent_name` / `task` 等展示字段,容错偏向"宁可显示原 cmdline,
 * 别崩"。任何不可解析的 cmdline 走 fallback,view 拿到空字段照样能渲染骨架。
 */
export function tokenizeForView(cmdline: string): string[] {
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

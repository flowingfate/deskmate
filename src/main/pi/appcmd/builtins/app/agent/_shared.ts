/**
 * `agent` 命令族的内部 helper —— 多个 subcommand 共享的小函数。
 *
 * 命名以 `_` 前缀,显式与"subcommand 文件"区分:
 *   - `_shared.ts` = 内部 util,**不**对应任何 LLM 可见命令
 *   - `add.ts` / `update.ts` / ... = 一个 subcommand
 *
 * 这里的 helper 都是纯函数 + 单一职责。任何与 persist 的真实交互都在对应
 * subcommand 或 kernel 文件里,**不**外溢到 _shared.ts —— 避免"shared util
 * 偷偷做副作用"的陷阱。
 */


/**
 * 校验 agent name。subcommand 拿到 positional[0] 后立即调本函数 ——
 * 把"name 必填、非空、trim 后非空"这条约束集中在一处。
 */
export function validateName(
  raw: string | undefined,
): { ok: true; name: string } | { ok: false; error: string } {
  if (!raw || typeof raw !== 'string') {
    return { ok: false, error: 'missing required <name> argument.' };
  }
  const name = raw.trim();
  if (!name) {
    return { ok: false, error: '<name> must be non-empty after trim.' };
  }
  return { ok: true, name };
}

// ---------------------------------------------------------------------------
// flag normalisers —— 把 parseFlags 给的 string | boolean | readonly string[] | undefined
// 收敛成命令业务方便消费的形态。失败一律走 `{ ok: false, error }`,caller 不
// 包 try/catch,直接 printErr + exit 2。
// ---------------------------------------------------------------------------

type FlagRaw = string | boolean | readonly string[] | undefined;

/** 把可重复的 string[] flag(`--xxx foo --xxx bar`)规范成 trimmed 非空数组。 */
function normalizeArrayFlag(raw: FlagRaw): string[] {
  if (raw === undefined || raw === false) return [];
  if (raw === true) return [];
  if (typeof raw === 'string') return [raw];
  return Array.from(raw);
}

/**
 * 解析 `--mcp-server name` × N。返回原始 string[]。
 *
 * 与 `--mcp-tool server:tool` 配合后由 caller 用 `buildMcpServersArray` 拼成
 * `{ name, tools }[]`。
 */
export function parseMcpServerFlag(raw: FlagRaw): string[] {
  return normalizeArrayFlag(raw)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * 解析 `--mcp-tool server:tool` × N → `{ server: [tool, tool, ...] }`。
 *
 * 规则:
 *   - 缺 `:` → 整段视为错误(明确给 LLM 错误信号,而不是默默吞)
 *   - `server:` 后空 → 错误(必须有 tool 名)
 *   - 重复 server 累积 tool
 */
export function parseMcpToolFlag(
  raw: FlagRaw,
): { ok: true; filter?: Record<string, string[]> } | { ok: false; error: string } {
  const entries = normalizeArrayFlag(raw);
  if (entries.length === 0) return { ok: true, filter: undefined };
  const filter: Record<string, string[]> = {};
  for (const entry of entries) {
    const trimmed = entry.trim();
    const colon = trimmed.indexOf(':');
    if (colon < 0) {
      return {
        ok: false,
        error: `invalid --mcp-tool "${entry}". Expected "server:tool".`,
      };
    }
    const server = trimmed.slice(0, colon).trim();
    const tool = trimmed.slice(colon + 1).trim();
    if (!server || !tool) {
      return {
        ok: false,
        error: `invalid --mcp-tool "${entry}". Both server and tool must be non-empty.`,
      };
    }
    if (!filter[server]) filter[server] = [];
    if (!filter[server].includes(tool)) filter[server].push(tool);
  }
  return { ok: true, filter };
}

/**
 * 解析 `--skill name` × N。
 */
export function parseSkillFlag(raw: FlagRaw): string[] {
  return parseMcpServerFlag(raw); // 同 shape,复用
}

/**
 * 把 string[] server name + 可选 tool filter 转成
 * `[{ name, tools }, ...]` 形态(persist + UI 接受的形态)。
 *
 * tool filter 缺失 → tools = [](语义:启用 server 的所有工具)。
 */
export function buildMcpServersArray(
  serverNames: string[],
  toolFilter?: Record<string, string[]>,
): Array<{ name: string; tools: string[] }> {
  return serverNames.map((serverName) => ({
    name: serverName,
    tools: toolFilter?.[serverName] || [],
  }));
}

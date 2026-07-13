/**
 * 把一段文本里所有 internal URI token 就地翻成绝对路径。
 *
 * `shell` 用它让 LLM 能直接 `python skill://pdf/scripts/fill.py` 执行 skill 脚本,
 * 而不必先查绝对路径。抽成独立 util(而非内联在 shell.ts)是为了可单测 ——
 * 与 `workspaceRoot.ts` 同一 `util/` 层的定位。
 *
 * 规则:
 * - token 形态 `scheme://<path>`,以空白 / 引号 / shell 控制符为边界。
 * - 只解析 handler 能 `resolveToPath` 的 scheme(`skill://` / `local://` /
 *   `knowledge://`);`http(s)://` 等未注册 scheme `canResolveToPath=false`,原样保留。
 * - `inlineQuote`:command 串里替换后要自己加引号(路径可能含空格);args / cwd
 *   分别由 `quoteArg` / terminalConfig.cwd 处理,传裸路径。
 * - 解析失败(如 skill 不存在)不抛错,token 原样保留 —— 让底层命令自然报"文件不存在",
 *   与手写绝对路径的失败语义一致。
 */
import * as nodePath from 'node:path';

import {
  InternalUrlRouter,
  toResolveContext,
} from '@main/pi/internal-urls';
import { quoteArg } from '@main/lib/backgroundProcessManager/commandLineUtils';
import type { ToolContext } from '../types';

/**
 * token 边界:空白、引号(`"` `'`)、shell 元字符(`` ` `` `$` `|` `&` `;`
 * `<` `>` `(` `)`)都终止一个 URI。
 *
 * ⚠️ **安全职责**:这个字符类不只是"切 token"——它同时保证解析出的相对路径段
 * 里**不含 shell 元字符**,于是替换进命令行的绝对路径不会引入命令注入
 * (`quoteArg` 的双引号挡不住 `$` / `` ` `` 展开,真正的防线在这里)。放宽这个
 * 字符类前务必想清楚:新放行的字符若能出现在绝对路径里,会直接打开注入面。
 */
const URI_TOKEN_RE = /[a-z][a-z0-9+.-]*:\/\/[^\s"'`|&;<>()$]+/gi;

export async function resolveUriTokens(
  text: string,
  ctx: ToolContext,
  inlineQuote: boolean,
): Promise<string> {
  const tokens = text.match(URI_TOKEN_RE);
  if (!tokens) return text;

  const router = InternalUrlRouter.get();
  const resolveCtx = toResolveContext(ctx);
  // 先把每个唯一 token 解析成替换串,再单次正则替换 —— 不用迭代 split/join,
  // 避免 token 互为前缀时(`skill://pdf` vs `skill://pdf-tools`)前者吃掉后者。
  const replacements = new Map<string, string>();
  for (const token of new Set(tokens)) {
    if (!router.canResolveToPath(token)) continue;
    try {
      const abs = await router.resolveToPath(token, resolveCtx);
      replacements.set(token, inlineQuote ? quoteArg(abs) : abs);
    } catch {
      // 解析失败:不入 map,token 原样保留,底层命令自然报错。
    }
  }
  if (replacements.size === 0) return text;

  // 整 token 从左到右匹配替换,无前缀污染。regex 用新实例避免 lastIndex 复用。
  return text.replace(new RegExp(URI_TOKEN_RE.source, 'gi'), (m) => replacements.get(m) ?? m);
}

/**
 * 解析 shell 的工作目录。
 *
 * `skill://<name>` 在读资源语义中表示该 skill 的 `SKILL.md`；但 cwd 必须是目录，
 * 因而仅在 cwd 位置把这个裸 URI 映射到 skill 根目录。含子路径的 URI 保持原样解析，
 * 不能把显式文件路径静默改为其父目录。
 */
export async function resolveCwdUri(
  cwd: string,
  ctx: ToolContext,
): Promise<string> {
  const resolved = await resolveUriTokens(cwd, ctx, false);
  if (!isBareSkillUri(cwd) || resolved === cwd) return resolved;
  return nodePath.dirname(resolved);
}

function isBareSkillUri(input: string): boolean {
  return /^skill:\/\/[^/]+$/i.test(input);
}
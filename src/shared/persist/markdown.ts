/**
 * AGENT.md 的纯字符串解析 / 序列化 / 局部 patch。
 * 顶层 Agent 与 sub-agent 共用同一份解析器。
 * 不读磁盘 —— 调用方负责 io。
 */

// @ts-expect-error js-yaml 无类型声明
import yaml from 'js-yaml';

import type { AgentMarkdownFile, AgentMarkdownFront } from './types';

/** 兼容 `---` 后追加空白/CR 的写法。 */
const FRONT_MATTER_RE = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---\r?\n?/;

interface YamlDumpOpts {
  lineWidth?: number;
  noRefs?: boolean;
  quotingType?: '"' | "'";
  forceQuotes?: boolean;
}

interface YamlApi {
  load(text: string): unknown;
  dump(value: unknown, opts?: YamlDumpOpts): string;
}
const yamlApi = yaml as YamlApi;

/**
 * Schema-无关的 AGENT.md 切分：把 raw 拆成 `frontMatterRaw`（未窄化的 YAML 解析结果）
 * 与 `body`（front-matter 之后的剩余内容）。调用方负责对 frontMatter 做窄化和默认值。
 *
 * `body` 仅剥掉序列化器追加的一个空行（与本模块 `joinFrontMatter` 配对幂等）；
 * 是否进一步 trim 由调用方决定。
 */
export function splitFrontMatter(raw: string): { frontMatterRaw: unknown; body: string } {
  const match = FRONT_MATTER_RE.exec(raw);
  if (!match) {
    throw new Error('AGENT.md missing YAML front-matter (--- ... ---)');
  }
  let body = raw.slice(match[0].length);
  if (body.startsWith('\n')) body = body.slice(1);
  return { frontMatterRaw: yamlApi.load(match[1]), body };
}

/**
 * Schema-无关的 AGENT.md 序列化。结构固定为 `---\nYAML\n---\n\nbody\n`。
 * 若调用方传入的 body 末尾无换行会自动补一个。
 */
export function joinFrontMatter(
  frontMatter: Record<string, unknown>,
  body: string,
  yamlOpts?: YamlDumpOpts,
): string {
  const yamlText = yamlApi.dump(frontMatter, { lineWidth: -1, noRefs: true, ...yamlOpts });
  const normalizedBody = body.endsWith('\n') ? body : body + '\n';
  // yaml.dump 总是以 `\n` 结尾，不需要再补。
  return `---\n${yamlText}---\n\n${normalizedBody}`;
}

/** 把 yaml.load 的结果窄化为 AgentMarkdownFront;缺关键字段时抛错。 */
function narrowFrontMatter(value: unknown): AgentMarkdownFront {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('AGENT.md front-matter must be a YAML mapping');
  }
  const fm = value as Record<string, unknown>;
  if (typeof fm.name !== 'string' || fm.name.length === 0) {
    throw new Error('AGENT.md front-matter missing required field: name');
  }
  if (typeof fm.version !== 'string' || fm.version.length === 0) {
    throw new Error('AGENT.md front-matter missing required field: version');
  }
  if (typeof fm.model !== 'string') {
    throw new Error('AGENT.md front-matter invalid model field');
  }

  return fm as unknown as AgentMarkdownFront;
}

export function parseAgentMarkdown(raw: string): AgentMarkdownFile {
  const { frontMatterRaw, body } = splitFrontMatter(raw);
  return { frontMatter: narrowFrontMatter(frontMatterRaw), systemPrompt: body };
}

/** 序列化为 `---\nYAML\n---\n\nbody\n` 格式。body 末尾自动补换行。 */
export function serializeAgentMarkdown(file: AgentMarkdownFile): string {
  return joinFrontMatter(
    file.frontMatter as unknown as Record<string, unknown>,
    file.systemPrompt,
  );
}

/** 仅替换 front-matter 的部分字段，保留 body 原样。 */
export function patchFrontMatter(raw: string, partial: Partial<AgentMarkdownFront>): string {
  const file = parseAgentMarkdown(raw);
  const merged = { ...file.frontMatter, ...partial } as AgentMarkdownFront;
  return serializeAgentMarkdown({ frontMatter: merged, systemPrompt: file.systemPrompt });
}

/** 仅替换 body（system prompt），保留 front-matter 原样。 */
export function patchSystemPrompt(raw: string, systemPrompt: string): string {
  const file = parseAgentMarkdown(raw);
  return serializeAgentMarkdown({ frontMatter: file.frontMatter, systemPrompt });
}

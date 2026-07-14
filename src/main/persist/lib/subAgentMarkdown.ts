/**
 * SubAgent AGENT.md parse/serialize/import/export 纯函数。
 *
 * 目录 CRUD / cache / writeLock 在 `persist/subAgents.ts`（统一所有权链）。
 *
 * 不依赖 Electron / persist 任何模块；只依赖 js-yaml + shared types。
 */

import { joinFrontMatter, splitFrontMatter } from '@shared/persist/markdown';
import type { SubAgentConfig,
SubAgentContextAccess,
SubAgentMcpServerConfig,
AgentMcpServer, } from '@shared/persist/types'

/** SubAgentConfig 默认值（仅取本模块用到的 2 项；与产品历史默认值一致）。 */
const DEFAULT_EMOJI = '🤖';
const DEFAULT_MAX_TURNS = 25;

export const AGENT_MD_FILENAME = 'AGENT.md';

/** Sub-agent name: lowercase letters + digits + hyphens, 不能首尾连字符 */
const AGENT_NAME_PATTERN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;


export interface ParseResult<T> {
  data: T | null;
  error?: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

/** 校验 sub-agent name。 */
export function validateSubAgentName(name: string): ValidationResult {
  const errors: string[] = [];
  if (!name || name.trim() === '') {
    errors.push('Agent name cannot be empty');
  } else if (!AGENT_NAME_PATTERN.test(name)) {
    errors.push(
      'Agent name can only contain lowercase letters (a-z), numbers (0-9), and hyphens (-). Cannot start or end with hyphen.',
    );
  }
  return { valid: errors.length === 0, errors };
}

export function validateSubAgentConfig(config: Partial<SubAgentConfig>): ValidationResult {
  const errors: string[] = [];
  if (!config.name) {
    errors.push('name is required');
  } else {
    errors.push(...validateSubAgentName(config.name).errors);
  }
  if (!config.description) errors.push('description is required');
  if (config.maxTurns != null && (config.maxTurns < 1 || config.maxTurns > 100)) {
    errors.push('maxTurns must be between 1 and 100');
  }
  if (
    config.context_access &&
    !['isolated', 'parent_summary', 'full_history'].includes(config.context_access)
  ) {
    errors.push('context_access must be one of: isolated, parent_summary, full_history');
  }
  return { valid: errors.length === 0, errors };
}

/** 解析 AGENT.md → SubAgentConfig。 */
export function parseSubAgentMarkdown(content: string): ParseResult<SubAgentConfig> {
  if (!content.startsWith('---')) {
    return {
      data: null,
      error:
        'AGENT.md must start with YAML front-matter (---). Expected format:\n---\nname: agent-name\ndescription: "description"\n---',
    };
  }

  let frontMatterRaw: unknown;
  let body: string;
  try {
    const split = splitFrontMatter(content);
    frontMatterRaw = split.frontMatterRaw;
    body = split.body;
  } catch (error) {
    return {
      data: null,
      error: `Failed to parse AGENT.md: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  try {
    if (!frontMatterRaw || typeof frontMatterRaw !== 'object') {
      return { data: null, error: 'Invalid YAML front-matter structure' };
    }
    const yamlData = frontMatterRaw as Record<string, unknown>;
    if (!yamlData.name || typeof yamlData.name !== 'string' || !yamlData.name.trim()) {
      return { data: null, error: 'AGENT.md front-matter must contain a valid "name" field' };
    }
    if (
      !yamlData.description ||
      typeof yamlData.description !== 'string' ||
      !yamlData.description.trim()
    ) {
      return {
        data: null,
        error: 'AGENT.md front-matter must contain a valid "description" field',
      };
    }

    // shared splitFrontMatter 已经剥掉序列化器追加的首个空行；这里再 trim 去掉
    // 历史文件可能存在的额外空白（与旧实现一致）。
    const markdownBody = body.trim();

    const xDeskmate = (yamlData['x-deskmate'] as Record<string, unknown>) || {};
    const mcpServers = parseMcpServers(yamlData.mcpServers);
    const skills = parseStringArray(yamlData.skills);
    const localTools = parseStringArray(xDeskmate.tools);
    const localDisallow = parseStringArray(xDeskmate.disallowTools);

    const config: SubAgentConfig = {
      name: String(yamlData.name).trim(),
      description: String(yamlData.description).trim(),
      model: yamlData.model != null ? String(yamlData.model) : 'inherit',
      maxTurns: parseNumber(yamlData.maxTurns, DEFAULT_MAX_TURNS),
      skills: skills.length > 0 ? skills : [],
      mcpServers: mcpServers.length > 0 ? mcpServers : [],

      display_name: String(xDeskmate.display_name || nameToDisplayName(String(yamlData.name))),
      emoji: String(xDeskmate.emoji || DEFAULT_EMOJI),
      version: String(xDeskmate.version || '1.0.0'),
      tools: localTools.length > 0 ? localTools : undefined,
      disallowTools: localDisallow.length > 0 ? localDisallow : undefined,
      workspace: xDeskmate.workspace != null ? String(xDeskmate.workspace) : '',
      knowledgeBase: xDeskmate.knowledgeBase != null ? String(xDeskmate.knowledgeBase) : '',
      context_access: parseContextAccess(xDeskmate.context_access),
      inherit_mcp_servers:
        xDeskmate.inherit_mcp_servers != null ? Boolean(xDeskmate.inherit_mcp_servers) : true,
      inherit_skills:
        xDeskmate.inherit_skills != null ? Boolean(xDeskmate.inherit_skills) : true,
      inherit_knowledge_base:
        xDeskmate.inherit_knowledge_base != null
          ? Boolean(xDeskmate.inherit_knowledge_base)
          : true,

      system_prompt: markdownBody,
    };

    return { data: config };
  } catch (error) {
    return {
      data: null,
      error: `Failed to parse AGENT.md: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/** SubAgentConfig → AGENT.md 文件内容（含 x-deskmate 命名空间）。 */
export function serializeSubAgentMarkdown(config: SubAgentConfig): string {
  const standardFields: Record<string, unknown> = {
    name: config.name,
    description: config.description,
  };
  if (config.model && config.model !== 'inherit') standardFields.model = config.model;

  if (config.maxTurns != null && config.maxTurns !== DEFAULT_MAX_TURNS) {
    standardFields.maxTurns = config.maxTurns;
  }
  if (config.skills && config.skills.length > 0) standardFields.skills = config.skills;

  const mcpServers = config.mcpServers;
  if (mcpServers && mcpServers.length > 0) {
    standardFields.mcpServers = mcpServers.map((s) =>
      typeof s === 'string' ? s : { name: s.name, tools: s.tools },
    );
  }

  const xDeskmate: Record<string, unknown> = {};
  if (config.display_name) xDeskmate.display_name = config.display_name;
  if (config.emoji && config.emoji !== DEFAULT_EMOJI) xDeskmate.emoji = config.emoji;
  if (config.version) xDeskmate.version = config.version;
  if (config.tools && config.tools.length > 0) xDeskmate.tools = config.tools;
  if (config.disallowTools && config.disallowTools.length > 0) {
    xDeskmate.disallowTools = config.disallowTools;
  }
  if (config.context_access && config.context_access !== 'isolated') {
    xDeskmate.context_access = config.context_access;
  }
  if (config.workspace) xDeskmate.workspace = config.workspace;
  if (config.knowledgeBase) xDeskmate.knowledgeBase = config.knowledgeBase;
  if (config.inherit_mcp_servers === false) xDeskmate.inherit_mcp_servers = false;
  if (config.inherit_skills === false) xDeskmate.inherit_skills = false;
  if (config.inherit_knowledge_base === false) xDeskmate.inherit_knowledge_base = false;

  const yamlObj: Record<string, unknown> = { ...standardFields };
  if (Object.keys(xDeskmate).length > 0) yamlObj['x-deskmate'] = xDeskmate;

  return joinFrontMatter(yamlObj, config.system_prompt || '', {
    quotingType: '"',
    forceQuotes: false,
  });
}

/** 导出为 Claude Code 标准格式（剥离 x-deskmate 命名空间）。 */
export function exportSubAgentAsClaudeCode(config: SubAgentConfig): string {
  // Deskmate 与 Claude Code 的 tool 命名空间不互译;export 不带 `tools` /
  // `disallowedTools` —— 让 Claude Code 端按自家默认全开 tool。MCP server
  // 列表不带 deskmate 端 server-level tool selection,只导出 server names。
  const standardFields: Record<string, unknown> = {
    name: config.name,
    description: config.description,
  };
  if (config.model && config.model !== 'inherit') standardFields.model = config.model;
  if (config.maxTurns != null && config.maxTurns !== DEFAULT_MAX_TURNS) standardFields.maxTurns = config.maxTurns;
  if (config.skills && config.skills.length > 0) standardFields.skills = config.skills;

  const mcpServers = config.mcpServers;
  if (mcpServers && mcpServers.length > 0) {
    standardFields.mcpServers = mcpServers.map((s) => (typeof s === 'string' ? s : s.name));
  }

  return joinFrontMatter(standardFields, config.system_prompt || '', {
    quotingType: '"',
    forceQuotes: false,
  });
}

// ─── 内部 helper ─────────────────────────────────────────────────────────

function parseStringArray(value: unknown): string[] {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value.filter((v) => typeof v === 'string' && v.trim()).map((v) => String(v).trim());
  }
  if (typeof value === 'string') return [value.trim()].filter(Boolean);
  return [];
}

function parseMcpServers(value: unknown): SubAgentMcpServerConfig[] {
  if (!value || !Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (typeof item === 'string') return item;
      if (item && typeof item === 'object' && 'name' in item) {
        return {
          name: String(item.name),
          tools: Array.isArray(item.tools) ? item.tools.map(String) : [],
        } as AgentMcpServer;
      }
      return null;
    })
    .filter((v): v is SubAgentMcpServerConfig => v !== null);
}

function parseNumber(value: unknown, defaultValue: number): number {
  if (typeof value === 'number' && !isNaN(value)) return value;
  if (typeof value === 'string') {
    const n = parseInt(value, 10);
    if (!isNaN(n)) return n;
  }
  return defaultValue;
}

function parseContextAccess(value: unknown): SubAgentContextAccess {
  if (
    typeof value === 'string' &&
    ['isolated', 'parent_summary', 'full_history'].includes(value)
  ) {
    return value as SubAgentContextAccess;
  }
  return 'isolated';
}

function nameToDisplayName(name: string): string {
  return name
    .split('-')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

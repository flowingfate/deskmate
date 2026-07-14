import type {
  SubAgentRecord,
  SubAgentsIndexFile,
} from '../../shared/persist/types';
import type { SubAgentConfig } from '@shared/persist/types'
import { PERSIST_PATH } from '../../shared/persist/path';
import { emit } from './lib/emit';
import { getAppRoot } from './lib/root';
import { PersistBase } from './lib/persistBase';
import {
  listDirs,
  readJsonOrNull,
  readTextOrNull,
  removeDirIfExists,
  writeJson,
  writeText,
} from './lib/atomic';
import * as fsp from 'node:fs/promises';
import {
  AGENT_MD_FILENAME,
  exportSubAgentAsClaudeCode,
  parseSubAgentMarkdown,
  serializeSubAgentMarkdown,
} from './lib/subAgentMarkdown';

function subAgentDir(root: string, profileId: string, id: string): string {
  return `${PERSIST_PATH.subAgentsDir(root, profileId)}/${id}`;
}

function markdownPath(root: string, profileId: string, id: string): string {
  return `${subAgentDir(root, profileId, id)}/${AGENT_MD_FILENAME}`;
}

/** 从 SubAgentConfig 推一个 index entry（id == name）。 */
function configToRecord(config: SubAgentConfig): SubAgentRecord {
  return {
    id: config.name,
    name: config.name,
    version: config.version || '1.0.0',
  };
}

/**
 * 对应 sub-agents/sub-agents.json + sub-agents/{id}/AGENT.md。id == name。
 *
 * - `items` 是轻量索引（name / version），index.json 落盘。
 * - 完整 SubAgentConfig 懒读 AGENT.md，命中内存 cache；写时 writeLock 串行化。
 */
export class SubAgents extends PersistBase {
  constructor(public readonly profileId: string) {
    super();
  }

  public items: SubAgentRecord[] = [];

  /** id → SubAgentConfig 内存 cache。 */
  private configCache = new Map<string, SubAgentConfig>();
  /** id → 串行化写盘 promise。 */
  private writeLocks = new Map<string, Promise<void>>();

  private indexFile(): string {
    return PERSIST_PATH.subAgentsIndex(getAppRoot(), this.profileId);
  }

  public async load(): Promise<void> {
    const file = await readJsonOrNull<SubAgentsIndexFile>(this.indexFile());
    this.items = file?.items ?? [];
  }

  protected async doPersist(): Promise<void> {
    await writeJson(this.indexFile(), this.toFile());
    emit('agent:registry:updated', {
      profileId: this.profileId,
      kind: 'subAgents',
      items: this.items,
    });
  }

  public get(id: string): SubAgentRecord | undefined {
    return this.items.find((s) => s.id === id);
  }

  /** index 级 upsert（仅改 record，不动 AGENT.md）。 */
  public async upsert(sub: SubAgentRecord): Promise<void> {
    const idx = this.items.findIndex((s) => s.id === sub.id);
    if (idx >= 0) this.items[idx] = sub;
    else this.items.push(sub);
    await this.persist();
  }

  /** 删 index entry + 物理目录 + cache。 */
  public async remove(id: string): Promise<void> {
    const before = this.items.length;
    this.items = this.items.filter((s) => s.id !== id);
    this.configCache.delete(id);
    await removeDirIfExists(subAgentDir(getAppRoot(), this.profileId, id));
    if (this.items.length !== before) await this.persist();
  }

  /** 读 AGENT.md 原文（不解析）。 */
  public async readMarkdown(id: string): Promise<string | undefined> {
    const raw = await readTextOrNull(markdownPath(getAppRoot(), this.profileId, id));
    return raw ?? undefined;
  }

  /** 写 AGENT.md 原文（不更新 index/cache）。底层 IO 入口；通常用 writeConfig。 */
  public async writeMarkdown(id: string, content: string): Promise<void> {
    await writeText(markdownPath(getAppRoot(), this.profileId, id), content);
  }

  /** 读完整 SubAgentConfig；先 cache 后 disk。文件不存在/解析失败返回 null。 */
  public async getConfig(id: string): Promise<SubAgentConfig | null> {
    const cached = this.configCache.get(id);
    if (cached) return cached;

    const raw = await this.readMarkdown(id);
    if (raw == null) return null;

    const parsed = parseSubAgentMarkdown(raw);
    if (!parsed.data) return null;

    this.configCache.set(id, parsed.data);
    return parsed.data;
  }

  /** 列出所有 sub-agent 完整 config（按 index 顺序；缺文件的跳过）。 */
  public async listConfigs(): Promise<SubAgentConfig[]> {
    const out: SubAgentConfig[] = [];
    for (const rec of this.items) {
      const cfg = await this.getConfig(rec.id);
      if (cfg) out.push(cfg);
    }
    return out;
  }

  /**
   * 写 SubAgentConfig：serialize → 原子写 AGENT.md → 更新 cache → upsert index → emit。
   * 同 id 并发写串行化（writeLock）。
   */
  public async writeConfig(config: SubAgentConfig): Promise<void> {
    const id = config.name;
    const existing = this.writeLocks.get(id) || Promise.resolve();
    const next = existing.then(async () => {
      const content = serializeSubAgentMarkdown(config);
      await this.writeMarkdown(id, content);
      this.configCache.set(id, config);
      // index 同步
      const rec = configToRecord(config);
      const idx = this.items.findIndex((s) => s.id === id);
      if (idx >= 0) this.items[idx] = rec;
      else this.items.push(rec);
      await this.persist();
    });
    this.writeLocks.set(id, next.catch(() => {}));
    await next;
  }

  /** 从 Claude Code 格式 .md 文件导入；按 AGENT.md 标准落盘 + index 同步。 */
  public async importFromClaudeCodeFile(filePath: string): Promise<SubAgentConfig> {
    const raw = await fsp.readFile(filePath, 'utf-8');
    const parsed = parseSubAgentMarkdown(raw);
    if (!parsed.data) {
      throw new Error(`Failed to parse Claude Code agent file: ${parsed.error}`);
    }
    await this.writeConfig(parsed.data);
    return parsed.data;
  }

  /** 导出为 Claude Code 标准格式（剥离 x-deskmate 命名空间）。找不到返回 null。 */
  public async exportAsClaudeCode(id: string): Promise<string | null> {
    const cfg = await this.getConfig(id);
    if (!cfg) return null;
    return exportSubAgentAsClaudeCode(cfg);
  }

  /**
   * 扫描 sub-agents/ 目录与 index 对账：磁盘有 / index 无 → 补 index entry；
   * 磁盘无 / index 有 → 剔除 index entry。返回完整 config 列表。
   * 用于 syncFromDisk IPC handler 与 startup reconcile。
   */
  public async scanFromDisk(): Promise<SubAgentConfig[]> {
    const root = getAppRoot();
    this.configCache.clear();

    const dirs = await listDirs(PERSIST_PATH.subAgentsDir(root, this.profileId));
    const present = new Set<string>();
    const configs: SubAgentConfig[] = [];

    for (const name of dirs) {
      const raw = await readTextOrNull(markdownPath(root, this.profileId, name));
      if (raw == null) continue;
      const parsed = parseSubAgentMarkdown(raw);
      if (!parsed.data) continue;
      present.add(name);
      this.configCache.set(name, parsed.data);
      configs.push(parsed.data);

      const existing = this.items.find((s) => s.id === name);
      if (!existing) this.items.push(configToRecord(parsed.data));
    }

    const before = this.items.length;
    this.items = this.items.filter((s) => present.has(s.id));
    if (this.items.length !== before || configs.length > 0) {
      await this.persist();
    }
    return configs;
  }

  /** 物理目录路径（IPC openInExplorer 用）。 */
  public agentDirPath(id: string): string {
    return subAgentDir(getAppRoot(), this.profileId, id);
  }

  public toFile(): SubAgentsIndexFile {
    return { version: 1, items: this.items };
  }
}

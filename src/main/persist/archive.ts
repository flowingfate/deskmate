import type { AgentMarkdownFile, AgentRecord } from '../../shared/persist/types';
import { PERSIST_PATH } from '../../shared/persist/path';
import { parseAgentMarkdown } from '../../shared/persist/markdown';
import { getAppRoot } from './lib/root';
import {
  listDirs,
  move,
  readJsonOrNull,
  readTextOrNull,
  removeDirIfExists,
  removeFileIfExists,
  writeJson,
} from './lib/atomic';

const RECORD_FILENAME = '_record.json';
const RECORD_VERSION = 1 as const;

interface ArchivedAgentRecordFile {
  version: typeof RECORD_VERSION;
  archivedAt: string;
  record: AgentRecord;
}

function archivedAgentsDir(root: string, profileId: string): string {
  return `${PERSIST_PATH.archiveDir(root, profileId)}/agents`;
}

function archivedAgentDir(root: string, profileId: string, archivedId: string): string {
  return `${archivedAgentsDir(root, profileId)}/${archivedId}`;
}

/**
 * archive/ 目录的统一入口。当前实现 agent 软删；其他归档（profile、orphan schedules）
 * 后续单独立项再补。
 */
export class Archive {
  constructor(public readonly profileId: string) {}

  /** 列出已归档的 agent。 */
  public async listArchivedAgents(): Promise<Array<AgentRecord & { archivedAt: string; archivedId: string }>> {
    const root = getAppRoot();
    const dirs = await listDirs(archivedAgentsDir(root, this.profileId));
    const out: Array<AgentRecord & { archivedAt: string; archivedId: string }> = [];
    for (const archivedId of dirs) {
      const rec = await readJsonOrNull<ArchivedAgentRecordFile>(
        `${archivedAgentDir(root, this.profileId, archivedId)}/${RECORD_FILENAME}`,
      );
      if (!rec) continue;
      out.push({ ...rec.record, archivedAt: rec.archivedAt, archivedId });
    }
    return out;
  }

  /**
   * 归档：把 agents/{a_id}/ 整目录移到 archive/agents/{a_id}_{ts}/，
   * 并写入一个 `_record.json` 保存原 AgentRecord，便于 restore。
   * 调用方（Profile.archiveAgent）负责更新 agents.json（剔除 items + 视情况清空 primaryAgentId）。
   */
  public async archiveAgentDir(agentId: string, record: AgentRecord): Promise<string> {
    const root = getAppRoot();
    const archivedAt = new Date().toISOString();
    const archivedId = `${agentId}_${archivedAt.replace(/[:.]/g, '-')}`;
    const target = archivedAgentDir(root, this.profileId, archivedId);
    await move(PERSIST_PATH.agentDir(root, this.profileId, agentId), target);
    const rec: ArchivedAgentRecordFile = { version: RECORD_VERSION, archivedAt, record };
    await writeJson(`${target}/${RECORD_FILENAME}`, rec);
    return archivedId;
  }

  /** 从 archive 恢复一个 agent 回 agents/。 */
  public async restoreAgentDir(archivedId: string): Promise<{ record: AgentRecord }> {
    const root = getAppRoot();
    const src = archivedAgentDir(root, this.profileId, archivedId);
    const recFile = `${src}/${RECORD_FILENAME}`;
    const rec = await readJsonOrNull<ArchivedAgentRecordFile>(recFile);
    if (!rec) throw new Error(`Archive.restoreAgentDir: missing ${RECORD_FILENAME} for ${archivedId}`);
    const target = PERSIST_PATH.agentDir(root, this.profileId, rec.record.id);
    await move(src, target);
    // restore 后丢弃 _record.json，目录回到普通 agent 形态
    await removeFileIfExists(`${target}/${RECORD_FILENAME}`);
    return { record: rec.record };
  }

  /** 物理删除归档项（不可恢复）。 */
  public async purge(archivedId: string): Promise<void> {
    const root = getAppRoot();
    await removeDirIfExists(archivedAgentDir(root, this.profileId, archivedId));
  }

  /**
   * 读取归档目录里的 AGENT.md（archive 是整目录 move，AGENT.md 还在原位）。
   * 用于 getArchivedAgents 等需要完整 agent 元数据的场景。归档项的 _record.json
   * 之外的字段（model / systemPrompt / mcpServers / ...）从这里取。
   */
  public async readMarkdown(archivedId: string): Promise<AgentMarkdownFile | undefined> {
    const root = getAppRoot();
    const raw = await readTextOrNull(`${archivedAgentDir(root, this.profileId, archivedId)}/AGENT.md`);
    if (raw === null) return undefined;
    return parseAgentMarkdown(raw);
  }

  /** 保留期外的清理。 */
  public async gc(retainDays: number): Promise<{ purged: string[] }> {
    const items = await this.listArchivedAgents();
    const cutoff = Date.now() - retainDays * 24 * 60 * 60 * 1000;
    const purged: string[] = [];
    for (const item of items) {
      const t = Date.parse(item.archivedAt);
      if (!Number.isFinite(t) || t > cutoff) continue;
      await this.purge(item.archivedId);
      purged.push(item.archivedId);
    }
    return { purged };
  }
}

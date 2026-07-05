/**
 * 「本地数据透明」聚合器 —— 递归统计当前 active profile 目录树的磁盘占用，
 * 供 `/settings/persist` 页面把用户的本地数据布局完全透明地呈现出来。
 *
 * 组织轴心：**agent 是一等公民**。
 *  - agent 私有数据（会话 / 定时运行 / 知识库 / 配置）按 agent 分组（`AgentStorageGroup`），
 *    每个 agent 一个卡片，内部再拆 conversations / scheduledRuns / knowledge / config 四个子项。
 *  - profile 级共享数据（skills / sub-agents / mcp / models / 搜索索引 / 归档 / 设置）保持扁平
 *    分类（`StorageCategory`）。
 *
 * 设计要点：
 *  - **只读**：纯统计，从不写盘 / 删盘。
 *  - **源真值优先**：条目计数走已有的 SQLite index（会话 / 定时运行）与内存注册表
 *    （agents / skills / sub-agents / mcp），不重复扫盘。
 *  - **字节数走真实扫盘**：`dirBytes` 递归 stat 每个文件，反映用户磁盘上的真实占用。
 *  - **无遗漏**：`profileConfig` 分类 = profile 根目录总字节 − (Σ agent 目录 + 其余共享分类)，
 *    把 settings.json / auth.json / scheduler-state.json 等散落小文件全部兜住，
 *    保证"Σ(agents 总字节 + shared 字节) == 总字节"，不隐藏任何数据。
 *  - 单个 agent 内 `config` 子项 = agent 目录总字节 − 会话 − 定时 − 知识（余下即 AGENT.md 等）。
 */

import * as path from 'node:path';
import { nowIso } from '@shared/persist/time';
import type {
  AgentStorageGroup,
  AgentStoragePart,
  StorageCategory,
  StorageOverview,
} from '../../shared/ipc/persist';
import type { AgentRecord } from '../../shared/persist/types';
import { PERSIST_PATH } from '../../shared/persist/path';
import { getAppRoot } from './lib/root';
import { dirBytes, pathExists } from './lib/atomic';
import * as fsp from 'node:fs/promises';
import type { Profile } from './profile';
import type { Profiles } from './profiles';

/** stat 单个文件字节数；不存在返回 0。 */
async function fileBytes(file: string): Promise<number> {
  try {
    const st = await fsp.stat(file);
    return st.isFile() ? st.size : 0;
  } catch {
    return 0;
  }
}

/** 统计单个 agent 目录，拆成 conversations / scheduledRuns / knowledge / config 四个子项。 */
async function computeAgentGroup(
  root: string,
  profileId: string,
  record: AgentRecord,
  conversationCount: number,
  scheduledRunCount: number,
): Promise<AgentStorageGroup> {
  const agentId = record.id;
  const agentRoot = PERSIST_PATH.agentDir(root, profileId, agentId);
  const sessionsDir = PERSIST_PATH.sessionsDir(root, profileId, agentId);
  const schedulesDir = PERSIST_PATH.schedulesDir(root, profileId, agentId);
  const knowledgeDir = PERSIST_PATH.agentKnowledge(root, profileId, agentId);

  const conversationsBytes = await dirBytes(sessionsDir);
  const scheduledRunsBytes = await dirBytes(schedulesDir);
  const knowledgeBytes = await dirBytes(knowledgeDir);
  const totalBytes = await dirBytes(agentRoot);
  // config 兜底：余下即 AGENT.md + 其它散落文件，保证子项之和守恒。
  const configBytes = Math.max(
    0,
    totalBytes - conversationsBytes - scheduledRunsBytes - knowledgeBytes,
  );

  const parts: AgentStoragePart[] = [
    {
      key: 'conversations',
      label: 'Conversations',
      bytes: conversationsBytes,
      count: conversationCount,
      path: sessionsDir,
    },
    {
      key: 'scheduledRuns',
      label: 'Scheduled Runs',
      bytes: scheduledRunsBytes,
      count: scheduledRunCount,
      path: schedulesDir,
    },
    {
      key: 'knowledge',
      label: 'Knowledge Base',
      bytes: knowledgeBytes,
      path: knowledgeDir,
    },
    {
      key: 'config',
      label: 'Agent Config',
      bytes: configBytes,
      path: agentRoot,
    },
  ];
  parts.sort((a, b) => b.bytes - a.bytes);

  const group: AgentStorageGroup = {
    agentId,
    name: record.name,
    model: record.model,
    agentRoot,
    totalBytes,
    parts,
  };
  if (record.emoji !== undefined) group.emoji = record.emoji;
  if (record.avatar !== undefined) group.avatar = record.avatar;
  if (record.locked !== undefined) group.locked = record.locked;
  return group;
}

/**
 * 汇总 active profile 的本地存储全景（agent 分组 + profile 级共享）。
 *
 * @param profile  当前 active Profile 实例（用于计数与子域路径）。
 * @param profiles Profiles 单例（用于取 profile 展示名 / 登录态）。
 */
export async function computeStorageOverview(
  profile: Profile,
  profiles: Profiles,
): Promise<StorageOverview> {
  const root = getAppRoot();
  const profileId = profile.id;
  const profileRoot = PERSIST_PATH.profileDir(root, profileId);

  // ── agent 分组（一等公民）──
  const records = profile.listAgents();
  const agents: AgentStorageGroup[] = [];
  let conversationTotal = 0;
  let scheduledRunTotal = 0;
  for (const record of records) {
    const convCount = profile.sessionIdx.countAgent(record.id);
    const runCount = profile.jobRunIdx.countAgent(record.id);
    conversationTotal += convCount;
    scheduledRunTotal += runCount;
    agents.push(await computeAgentGroup(root, profileId, record, convCount, runCount));
  }
  agents.sort((a, b) => b.totalBytes - a.totalBytes);
  const agentsTotalBytes = agents.reduce((acc, g) => acc + g.totalBytes, 0);

  // ── profile 级共享分类 ──
  const skillsBytes = await dirBytes(PERSIST_PATH.skillsDir(root, profileId));
  const subAgentsBytes = await dirBytes(PERSIST_PATH.subAgentsDir(root, profileId));
  const mcpBytes = await dirBytes(PERSIST_PATH.mcpDir(root, profileId));
  const modelsBytes = await dirBytes(PERSIST_PATH.modelsDir(root, profileId));
  const archiveBytes = await dirBytes(PERSIST_PATH.archiveDir(root, profileId));

  const dbBase = path.join(profileRoot, 'index.db');
  const searchIndexBytes =
    (await fileBytes(dbBase)) +
    (await fileBytes(`${dbBase}-wal`)) +
    (await fileBytes(`${dbBase}-shm`));

  const totalBytes = await dirBytes(profileRoot);

  // 计数（走 index / 注册表）。
  const skillCount = profile.skills.items.length;
  const subAgentCount = profile.subAgents.items.length;
  const mcpCount = profile.mcp.items.length;
  const archivedCount = (await profile.archive.listArchivedAgents()).length;

  // profileConfig 兜底 = 总字节 − (agents + 其余共享)，把散落小文件全部收口，保证守恒。
  const sharedNonProfile =
    skillsBytes + subAgentsBytes + mcpBytes + modelsBytes + searchIndexBytes + archiveBytes;
  const profileConfigBytes = Math.max(0, totalBytes - agentsTotalBytes - sharedNonProfile);

  const shared: StorageCategory[] = [
    {
      key: 'skills',
      label: 'Skills',
      description: 'Installed skill packages shared across your agents.',
      bytes: skillsBytes,
      path: PERSIST_PATH.skillsDir(root, profileId),
      count: skillCount,
    },
    {
      key: 'subAgents',
      label: 'Sub-Agents',
      description: 'Reusable sub-agent definitions shared across your agents.',
      bytes: subAgentsBytes,
      path: PERSIST_PATH.subAgentsDir(root, profileId),
      count: subAgentCount,
    },
    {
      key: 'mcp',
      label: 'MCP Servers',
      description: 'External MCP server configurations.',
      bytes: mcpBytes,
      path: PERSIST_PATH.mcpDir(root, profileId),
      count: mcpCount,
    },
    {
      key: 'models',
      label: 'Model Cache',
      description: 'Cached model lists per provider.',
      bytes: modelsBytes,
      path: PERSIST_PATH.modelsDir(root, profileId),
    },
    {
      key: 'searchIndex',
      label: 'Search Index',
      description: 'SQLite index (index.db) — a derived cache, safe to rebuild from disk.',
      bytes: searchIndexBytes,
      path: dbBase,
    },
    {
      key: 'archive',
      label: 'Archived Agents',
      description: 'Soft-deleted agents kept for restore.',
      bytes: archiveBytes,
      path: PERSIST_PATH.archiveDir(root, profileId),
      count: archivedCount,
    },
    {
      key: 'profileConfig',
      label: 'Profile & Settings',
      description: 'Settings, sign-in state, scheduler state, and other profile-level files.',
      bytes: profileConfigBytes,
      path: profileRoot,
    },
  ];
  shared.sort((a, b) => b.bytes - a.bytes);

  const entry = profiles.getEntry(profileId);
  const profileName = entry?.displayName ?? 'Guest';
  const profileKind: 'guest' | 'signed_in' = entry?.kind === 'signed_in' ? 'signed_in' : 'guest';

  return {
    profileId,
    profileName,
    profileKind,
    dataRoot: root,
    profileRoot,
    totalBytes,
    agentsTotalBytes,
    agents,
    shared,
    stats: {
      agents: records.length,
      conversations: conversationTotal,
      scheduledRuns: scheduledRunTotal,
      skills: skillCount,
      subAgents: subAgentCount,
      mcpServers: mcpCount,
      archivedAgents: archivedCount,
    },
    generatedAt: nowIso(),
  };
}

/**
 * 校验并规范化「在文件管理器中打开」的目标路径。
 * 只允许当前 profile 根目录树内 或 应用数据根本身的路径，越界返回 null（拒绝打开）。
 * 路径可以是文件（如 index.db，调用方用 showItemInFolder）或目录。
 */
export async function resolveRevealTarget(
  profileRoot: string,
  dataRoot: string,
  absPath: string,
): Promise<{ target: string; isFile: boolean } | null> {
  const resolved = path.resolve(absPath);
  const inProfile = resolved === profileRoot || resolved.startsWith(profileRoot + path.sep);
  const isDataRoot = resolved === dataRoot;
  if (!inProfile && !isDataRoot) return null;
  if (!(await pathExists(resolved))) return null;
  let isFile = false;
  try {
    isFile = (await fsp.stat(resolved)).isFile();
  } catch {
    return null;
  }
  return { target: resolved, isFile };
}

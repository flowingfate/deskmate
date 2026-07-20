/**
 * 「本地数据透明」聚合器 —— 递归统计调用方传入 Profile 目录树的磁盘占用，
 * 供 `/settings/persist` 页面把用户的本地数据布局完全透明地呈现出来。
 *
 * 组织轴心：**agent 是一等公民**。
 *  - agent 私有数据（会话 / 定时运行 / 知识库 / 配置）按 agent 分组（`AgentStorageGroup`），
 *    每个 agent 一个卡片，内部再拆 conversations / scheduledRuns / knowledge / config 四个子项。
 *  - profile 级共享数据（skills / mcp / models / 搜索索引 / 归档 / 设置）保持扁平分类（`StorageCategory`）。
 *
 * 设计要点：
 *  - **只读**：纯统计，从不写盘 / 删盘。
 *  - **源真值优先**：条目计数走已有的 SQLite index（会话 / 定时运行）与内存注册表（agents / skills / mcp），不重复扫盘。
 *  - **字节数走真实扫盘**：`dirBytes` 递归 stat 每个文件，反映用户磁盘上的真实占用。
 *  - **无遗漏**：`profileConfig` 分类 = profile 根目录总字节 − (Σ agent 目录 + 其余共享分类)，
 *    把 settings.json / auth.json / scheduler-state.json 等散落小文件全部兜住，
 *    保证"Σ(agents 总字节 + shared 字节) == 总字节"，不隐藏任何数据。
 *  - 单个 agent 内 `config` 子项 = agent 目录总字节 − 会话 − 定时 − 知识（余下即 AGENT.md 等）。
 */

import type { Dirent } from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import { nowIso } from '@shared/persist/time';
import type {
  AgentStorageGroup,
  AgentStoragePart,
  RuntimeStorageCategory,
  RuntimeStorageOverview,
  StorageCategory,
  StorageOverview,
} from '../../shared/ipc/persist';
import type { AgentRecord, ProfileIndexEntry } from '../../shared/persist/types';
import { PERSIST_PATH } from '../../shared/persist/path';
import { dirBytes, pathExists } from './lib/atomic';
import { getRuntimeEnvDir } from './lib/path';
import { getAppRoot } from './lib/root';
import type { ProfileStore } from './profileStore';
interface ProfileIndexReader {
  getEntry(id: string): ProfileIndexEntry | undefined;
}

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

type RuntimeStorageBucket = {
  bytes: number;
  fileCount: number;
  exists: boolean;
};

type RuntimeStorageBuckets = Record<RuntimeStorageCategory['key'], RuntimeStorageBucket>;

const RUNTIME_STORAGE_KEYS: RuntimeStorageCategory['key'][] = [
  'bin',
  'bun',
  'python',
  'pythonVenv',
  'uvCache',
  'uvTools',
  'runtimeBin',
  'other',
];

function createRuntimeStorageBuckets(): RuntimeStorageBuckets {
  return {
    bin: { bytes: 0, fileCount: 0, exists: false },
    bun: { bytes: 0, fileCount: 0, exists: false },
    python: { bytes: 0, fileCount: 0, exists: false },
    pythonVenv: { bytes: 0, fileCount: 0, exists: false },
    uvCache: { bytes: 0, fileCount: 0, exists: false },
    uvTools: { bytes: 0, fileCount: 0, exists: false },
    runtimeBin: { bytes: 0, fileCount: 0, exists: false },
    other: { bytes: 0, fileCount: 0, exists: false },
  };
}

function runtimeStorageKey(name: string): RuntimeStorageCategory['key'] {
  switch (name) {
    case 'bin': return 'bin';
    case 'bun': return 'bun';
    case 'python': return 'python';
    case 'python-venv': return 'pythonVenv';
    case 'uv-cache': return 'uvCache';
    case 'uv-tools': return 'uvTools';
    case 'runtime-bin': return 'runtimeBin';
    default: return 'other';
  }
}

function runtimeStorageLabel(key: RuntimeStorageCategory['key']): string {
  switch (key) {
    case 'bin': return 'Runtime Binaries & Shims';
    case 'bun': return 'Bun';
    case 'python': return 'Managed Python';
    case 'pythonVenv': return 'Python Virtual Environment';
    case 'uvCache': return 'uv Download Cache';
    case 'uvTools': return 'uv Tools';
    case 'runtimeBin': return 'Global CLI Binaries';
    case 'other': return 'Other Runtime Files';
  }
}

function runtimeStorageDescription(key: RuntimeStorageCategory['key']): string {
  switch (key) {
    case 'bin': return 'App-managed Bun and uv binaries plus command shims.';
    case 'bun': return 'Bun global packages and cache.';
    case 'python': return 'Python versions installed by uv.';
    case 'pythonVenv': return 'The app-managed shared Python virtual environment.';
    case 'uvCache': return 'Downloads cached by uv.';
    case 'uvTools': return 'Isolated environments installed by uvx.';
    case 'runtimeBin': return 'Executable entry points for globally installed tools.';
    case 'other': return 'Runtime files outside the standard managed directories.';
  }
}

function runtimeStoragePath(envRoot: string, key: RuntimeStorageCategory['key']): string {
  switch (key) {
    case 'bin': return path.join(envRoot, 'bin');
    case 'bun': return path.join(envRoot, 'bun');
    case 'python': return path.join(envRoot, 'python');
    case 'pythonVenv': return path.join(envRoot, 'python-venv');
    case 'uvCache': return path.join(envRoot, 'uv-cache');
    case 'uvTools': return path.join(envRoot, 'uv-tools');
    case 'runtimeBin': return path.join(envRoot, 'runtime-bin');
    case 'other': return envRoot;
  }
}

function isNotFoundError(error: Error): boolean {
  return 'code' in error && error.code === 'ENOENT';
}

async function scanRuntimeDirectory(
  dir: string,
  key: RuntimeStorageCategory['key'],
  buckets: RuntimeStorageBuckets,
): Promise<void> {
  let entries: Dirent[];
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    try {
      if (entry.isDirectory()) {
        await scanRuntimeDirectory(full, key, buckets);
      } else if (entry.isFile()) {
        const bucket = buckets[key];
        bucket.bytes += (await fsp.stat(full)).size;
        bucket.fileCount += 1;
      }
    } catch {
      /* 遍历途中被删 / 权限问题：跳过该项 */
    }
  }
}

/**
 * 单遍递归统计应用托管运行时目录。每个文件只 stat 一次，再按顶层目录归类，
 * 避免总目录与分类目录重复扫描大量 Bun / Python 第三方包文件。
 */
export async function computeRuntimeStorageOverview(): Promise<RuntimeStorageOverview> {
  const envRoot = getRuntimeEnvDir();
  const buckets = createRuntimeStorageBuckets();
  let entries: Dirent[];
  try {
    entries = await fsp.readdir(envRoot, { withFileTypes: true });
  } catch (error) {
    if (error instanceof Error && isNotFoundError(error)) {
      return {
        envRoot,
        exists: false,
        totalBytes: 0,
        fileCount: 0,
        categories: [],
        generatedAt: nowIso(),
      };
    }
    throw error;
  }

  for (const entry of entries) {
    const key = runtimeStorageKey(entry.name);
    const bucket = buckets[key];
    bucket.exists = true;
    const full = path.join(envRoot, entry.name);
    try {
      if (entry.isDirectory()) {
        await scanRuntimeDirectory(full, key, buckets);
      } else if (entry.isFile()) {
        bucket.bytes += (await fsp.stat(full)).size;
        bucket.fileCount += 1;
      }
    } catch {
      /* 遍历途中被删 / 权限问题：跳过该项 */
    }
  }

  const categories = RUNTIME_STORAGE_KEYS
    .filter((key) => buckets[key].exists)
    .map<RuntimeStorageCategory>((key) => {
      const bucket = buckets[key];
      return {
        key,
        label: runtimeStorageLabel(key),
        description: runtimeStorageDescription(key),
        bytes: bucket.bytes,
        fileCount: bucket.fileCount,
        path: runtimeStoragePath(envRoot, key),
      };
    })
    .sort((a, b) => b.bytes - a.bytes);

  return {
    envRoot,
    exists: true,
    totalBytes: categories.reduce((total, category) => total + category.bytes, 0),
    fileCount: categories.reduce((total, category) => total + category.fileCount, 0),
    categories,
    generatedAt: nowIso(),
  };
}

/**
 * 汇总指定 Profile 的本地存储全景（agent 分组 + profile 级共享）。
 *
 * @param store 目标 ProfileStore（用于计数与子域路径）。
 * @param profileIndex Profile index reader（用于取 profile 展示名 / 登录态）。
 */
export async function computeStorageOverview(
  store: ProfileStore,
  profileIndex: ProfileIndexReader,
): Promise<StorageOverview> {
  const root = getAppRoot();
  const profileId = store.id;
  const profileRoot = PERSIST_PATH.profileDir(root, profileId);

  // ── agent 分组（一等公民）──
  const records = store.listAgents();
  const agents: AgentStorageGroup[] = [];
  let conversationTotal = 0;
  let scheduledRunTotal = 0;
  for (const record of records) {
    const convCount = store.sessionIdx.countAgent(record.id);
    const runCount = store.jobRunIdx.countAgent(record.id);
    conversationTotal += convCount;
    scheduledRunTotal += runCount;
    agents.push(await computeAgentGroup(root, profileId, record, convCount, runCount));
  }
  agents.sort((a, b) => b.totalBytes - a.totalBytes);
  const agentsTotalBytes = agents.reduce((acc, g) => acc + g.totalBytes, 0);

  // ── profile 级共享分类 ──
  const skillsBytes = await dirBytes(PERSIST_PATH.skillsDir(root, profileId));
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
  const skillCount = store.skills.items.length;
  const mcpCount = store.mcp.items.length;
  const archivedCount = (await store.archive.listArchivedAgents()).length;

  // profileConfig 兜底 = 总字节 − (agents + 其余共享)，把散落小文件全部收口，保证守恒。
  const sharedNonProfile = skillsBytes + mcpBytes + modelsBytes + searchIndexBytes + archiveBytes;
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

  const entry = profileIndex.getEntry(profileId);
  const profileName = entry?.displayName ?? 'Guest';
  const profileKind: 'guest' | 'signed_in' = entry?.kind === 'signed_in' ? 'signed_in' : 'guest';

  return {
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
      mcpServers: mcpCount,
      archivedAgents: archivedCount,
    },
    generatedAt: nowIso(),
  };
}

/**
 * 校验并规范化「在文件管理器中打开」的目标路径。
 * 只允许当前 profile 根目录树、应用数据根本身或 app-managed runtime env 树内的路径。
 * 路径可以是文件（如 index.db，调用方用 showItemInFolder）或目录。
 */
export async function resolveRevealTarget(
  profileRoot: string,
  dataRoot: string,
  absPath: string,
): Promise<{ target: string; isFile: boolean } | null> {
  const resolved = path.resolve(absPath);
  const resolvedProfileRoot = path.resolve(profileRoot);
  const resolvedDataRoot = path.resolve(dataRoot);
  const runtimeEnvRoot = path.resolve(getRuntimeEnvDir());
  const inProfile = resolved === resolvedProfileRoot || resolved.startsWith(resolvedProfileRoot + path.sep);
  const inRuntimeEnv = resolved === runtimeEnvRoot || resolved.startsWith(runtimeEnvRoot + path.sep);
  if (!inProfile && !inRuntimeEnv && resolved !== resolvedDataRoot) return null;
  if (!(await pathExists(resolved))) return null;
  let isFile = false;
  try {
    isFile = (await fsp.stat(resolved)).isFile();
  } catch {
    return null;
  }
  return { target: resolved, isFile };
}

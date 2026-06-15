/**
 * Deskmate 路径派生的唯一来源。
 *
 * 设计原则：
 * - 业务根（app data）= ~/.deskmate/，由 `./root::getAppRoot()` 解析（支持测试覆盖）。
 * - Electron userData（Chromium 自动产物，Cache/Cookies/LocalStorage/Crashpad…）= ~/.deskmate/chromium/，
 *   仅 `getChromiumDataPath()` 需要直接读 `app.getPath('userData')`。
 * - 业务侧所有目录派生都从 `getAppDataPath()` 出发，**禁止**直接调用 `app.getPath('userData')`。
 *
 * bootstrap.ts 是唯一允许调用 `app.setPath('userData', ...)` 的位置。
 *
 * 本文件属于 `persist/` 模块——应用在系统存储上的唯一标准入口。新增/profile 内布局相关的路径
 * 派生请放在 `src/shared/persist/path.ts`（`PERSIST_PATH`）；本文件保留全局系统级目录
 * （logs / bin / assets / chromium 等）以及尚未完全淘汰的
 * 老 profile 布局接口（chat_sessions / getProfileDirectoryPath 等）。
 */

import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { extractMonthFromChatSessionIdValue } from '@shared/utils/idFormats';
import { getAppRoot } from './root';

// ============================================================
// 通用 fs 工具
// ============================================================

export function ensureDirectoryExists(dirPath: string): void {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

// ============================================================
// 根目录
// ============================================================

/**
 * 业务数据根目录：~/.deskmate/
 *
 * 直接代理到 `getAppRoot()`，保持 persist 模块内"根路径解析"唯一来源。
 */
export const getAppDataPath = getAppRoot;

/**
 * Electron userData / Chromium 自动产物目录：~/.deskmate/chromium/
 */
export function getChromiumDataPath(): string {
  return app.getPath('userData');
}

// ============================================================
// 顶层固定目录 / 文件
// ============================================================

export function getLogsDir(): string {
  return path.join(getAppDataPath(), 'logs');
}

export function getBinDir(): string {
  return path.join(getAppDataPath(), 'bin');
}

export function getPythonVenvDir(): string {
  return path.join(getAppDataPath(), 'python-venv');
}

export function getCrashesDir(): string {
  return path.join(getAppDataPath(), 'crashes');
}

export function getStateDir(): string {
  return path.join(getAppDataPath(), 'state');
}

export function getAssetsDir(): string {
  return path.join(getAppDataPath(), 'assets');
}


export function getQuickStartImageCacheDir(): string {
  return path.join(getAppDataPath(), 'cache', 'quick_start_images');
}

export function getGithubSkillReposDir(): string {
  return path.join(getAppDataPath(), 'github-skill-repos');
}

export function getClawhubSkillsDir(): string {
  return path.join(getAppDataPath(), 'clawhub-skills');
}

export function getTmpDir(): string {
  return path.join(getAppDataPath(), 'tmp');
}

export function getAppJsonPath(): string {
  return path.join(getAppDataPath(), 'app.json');
}

export function getInstallationDeviceIdPath(): string {
  return path.join(getAppDataPath(), 'device-id');
}

// ============================================================
// assets/ 子项
// ============================================================

export function getUpdaterDir(): string {
  return path.join(getAssetsDir(), 'updater');
}

export function getUpdatesCacheDir(filenamePrefix: string): string {
  return path.join(getAssetsDir(), `${filenamePrefix}-updates`);
}

export function getUpdatePreferencesPath(): string {
  return path.join(getAppDataPath(), 'update-preferences.json');
}

// ============================================================
// Profile 域（老布局，逐步迁移至 src/shared/persist/path.ts::PERSIST_PATH）
// ============================================================

export function getProfilesRootPath(): string {
  return path.join(getAppDataPath(), 'profiles');
}

export function getProfileDirectoryPath(id: string): string {
  if (!id) {
    throw new Error('Profile ID is required to resolve profile directory path.');
  }
  return path.join(getProfilesRootPath(), id);
}

export function getProfileSkillsDir(id: string): string {
  return path.join(getProfileDirectoryPath(id), 'skills');
}

// ============================================================
// chat_sessions（老布局，仅 getFilePath IPC 还在用）
// ============================================================

function getChatSessionsMonthPath(profile_id: string, agent_id: string, month: string): string {
  if (!agent_id) {
    throw new Error('Chat ID is required to resolve chat sessions path.');
  }
  if (!month || !/^\d{6}$/.test(month)) {
    throw new Error('Month must be in YYYYMM format.');
  }
  const monthPath = path.join(getProfileDirectoryPath(profile_id), 'chat_sessions', agent_id, month);
  ensureDirectoryExists(monthPath);
  return monthPath;
}

export function getChatSessionDirPath(
  profile_id: string,
  agent_id: string,
  chatSessionId: string,
): string {
  if (!chatSessionId) {
    throw new Error('ChatSession ID is required to resolve directory path.');
  }
  const month = extractMonthFromChatSessionIdValue(chatSessionId);
  if (!month) {
    throw new Error(
      `Invalid chatSessionId format: ${chatSessionId}. Expected format: chatSession_YYYYMMDDHHMMSS_<deviceid>_<random>`,
    );
  }
  return path.join(getChatSessionsMonthPath(profile_id, agent_id, month), chatSessionId);
}

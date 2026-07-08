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

/**
 * 运行时地盘基点：~/.deskmate/env/
 *
 * 自带运行时（bun/uv/Python）的一切「装机产物」——二进制、shim、venv、下载缓存、
 * 全局包、uv 装的 Python——统一收进这个命名空间。判据：「删了能整个重装出来」= 运行时
 * 产物 = 进 env/；用户账号/对话/日志 = 应用数据 = 留顶层。所有 managed dir helper 都从此派生，
 * 换基点只此一处。老 ~/.deskmate/bin、python-venv 变孤儿（不迁不删），下次 lazy install 在 env/ 重建。
 */
export function getRuntimeEnvDir(): string {
  return path.join(getAppDataPath(), 'env');
}

export function getBinDir(): string {
  return path.join(getRuntimeEnvDir(), 'bin');
}

/**
 * node 生态 shim 子目录：~/.deskmate/env/bin/node-shims/
 *
 * 存放 node/npm/npx shim（冒充系统命令名者）。刻意与 root bin 分开：shell 工具只前插 root bin
 * （python/pip shim + 真 bun/uv/uvx + uvx/bunx shim 可见，node/npm/npx 落系统），MCP 额外前插本目录
 * 拿到全套 node shim。真二进制 bun 仍在 root bin，shim 内以 `../bun` 反向引用。
 */
export function getNodeShimsDir(): string {
  return path.join(getBinDir(), 'node-shims');
}

export function getPythonVenvDir(): string {
  return path.join(getRuntimeEnvDir(), 'python-venv');
}

/** uv 下载缓存目录：~/.deskmate/env/uv-cache/（喂 UV_CACHE_DIR，收编原 ~/.cache/uv）。 */
export function getUvCacheDir(): string {
  return path.join(getRuntimeEnvDir(), 'uv-cache');
}

/** uvx CLI 工具环境目录：~/.deskmate/env/uv-tools/（喂 UV_TOOL_DIR，收编原 ~/.local/share/uv/tools）。 */
export function getUvToolDir(): string {
  return path.join(getRuntimeEnvDir(), 'uv-tools');
}

/**
 * uv 装的 Python 本体目录：~/.deskmate/env/python/（喂 UV_PYTHON_INSTALL_DIR）。
 *
 * 列表读取的单一来源：设置页 Python 版本列表直接 fs.readdir 此目录（不 spawn uv），
 * 环境变量注入与列表扫描都从这里取值，杜绝漂移。
 */
export function getUvPythonInstallDir(): string {
  return path.join(getRuntimeEnvDir(), 'python');
}

/** bun 全局包 + 下载缓存根：~/.deskmate/env/bun/（喂 BUN_INSTALL，收编原 ~/.bun/install）。 */
export function getBunInstallDir(): string {
  return path.join(getRuntimeEnvDir(), 'bun');
}

/**
 * 全局 CLI 可执行入口统一收口：~/.deskmate/env/runtime-bin/
 *
 * uvx 装的工具入口、python3.x 入口、bun 全局包入口都落这里（喂 UV_TOOL_BIN_DIR /
 * UV_PYTHON_BIN_DIR / BUN_INSTALL_BIN）。刻意与 bin/ 分开：bin/ 里住着冒充系统命令名的 shim
 * （python/node/npm），若全局装了同名 CLId 链进 bin/ 会跟 shim 撞名互相遮蔽。单开干净目录专收
 * 全局入口，且前插进路径 B 的 PATH → LLM `bun add -g foo` 后下一条 `foo` 直接命中。
 */
export function getRuntimeBinDir(): string {
  return path.join(getRuntimeEnvDir(), 'runtime-bin');
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

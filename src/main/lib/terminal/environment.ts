/**
 * 环境变量构建 —— 纯函数集合，无状态。
 *
 * 负责为子进程拼装增强后的 PATH / 各类语言版本管理器变量 / 运行时固定的
 * Python 版本，并解析 envFile。所有函数只读 `process.env` 与应用单例
 * （getBinDir / runtimeBridge），不持有任何自身状态。
 */

import * as path from 'path';
import { homedir } from 'os';
import { getTerminalRuntimeBridge } from './runtimeBridge';
import { getBinDir, getNodeShimsDir, getRuntimeBinDir } from '@main/persist/lib/path';

/**
 * 用户数据目录下的 bin 路径（存放 bun/node/npm/npx/pip/python/uv 等自带可执行文件）。
 * 应用尚未初始化时返回 null。这是唯一的 bin 路径解析入口，供 environment 内部与
 * TerminalInstance 的包装脚本共用。
 */
export function userDataBinPath(): string | null {
  try {
    return getBinDir();
  } catch {
    return null;
  }
}

/**
 * node 生态 shim 子目录（{userData}/env/bin/node-shims）。仅 MCP 前插此目录拿全套 node shim；
 * shell 工具不前插，令 node/npm/npx 落系统。应用尚未初始化时返回 null。
 */
export function userDataNodeShimsPath(): string | null {
  try {
    return getNodeShimsDir();
  } catch {
    return null;
  }
}

/**
 * 全局 CLI 可执行入口目录（{userData}/env/runtime-bin）。仅路径 B（LLM 干活：shell / MCP）
 * 前插，且排在 shim 目录之后、系统 PATH 之前 —— shim 仍压过同名全局 CLI，而 `bun add -g foo`
 * 后 `foo` 仍先于系统命中。应用尚未初始化时返回 null。
 */
export function userDataRuntimeBinPath(): string | null {
  try {
    return getRuntimeBinDir();
  } catch {
    return null;
  }
}

/**
 * 构建增强的环境变量。
 * @param pathSeparator 平台 PATH 分隔符
 * @param includeBinPath 是否加入用户数据 root bin 路径（internal 模式 true，system 模式 false）
 * @param includeNodeShims 是否额外加入 node-shims 子目录（MCP true，shell false）。
 *        仅在 includeBinPath 为 true 时有意义。
 */
export function buildEnhancedEnvironment(
  pathSeparator: string,
  includeBinPath: boolean = true,
  includeNodeShims: boolean = false,
): Record<string, string> {
  const env = { ...process.env } as Record<string, string>;

  // 移除 npm_config_prefix，避免子进程中与 nvm 冲突。Homebrew node 会设置它，
  // 但与 nvm 不兼容。仅在 internal 模式（includeBinPath=true）下清理；system 模式
  // 保留用户原始环境。
  if (includeBinPath) {
    delete env['npm_config_prefix'];
  }

  const binPath = includeBinPath ? userDataBinPath() : null;
  // node-shims 仅 MCP scope 前插；shell scope 不含 → node/npm/npx 落系统。
  const nodeShimsPath = includeBinPath && includeNodeShims ? userDataNodeShimsPath() : null;
  // 前插顺序：node-shims 先于 root（名字不相交，仅为语义清晰），null 项后续 filter 掉。
  const binDirs = [nodeShimsPath, binPath].filter((p): p is string => Boolean(p));
  // runtime-bin：全局 CLI 入口，仅路径 B 前插，排在 shim 目录之后、系统 PATH 之前。
  const runtimeBinPath = includeBinPath ? userDataRuntimeBinPath() : null;

  // Windows 处理
  if (process.platform === 'win32') {
    // 大小写不敏感地查找已有 Path 变量，避免创建重复 PATH 丢失系统条目
    const pathKey = Object.keys(env).find(k => k.toLowerCase() === 'path') || 'Path';

    // 先插 runtime-bin（排系统之前），再插 shim 目录（压过 runtime-bin），得到
    // [shim..., runtime-bin, 系统 PATH]。
    if (runtimeBinPath) {
      env[pathKey] = runtimeBinPath + pathSeparator + (env[pathKey] || '');
    }
    for (const dir of binDirs) {
      env[pathKey] = dir + pathSeparator + (env[pathKey] || '');
    }
    if (includeBinPath) {
      getTerminalRuntimeBridge()?.applyRuntimeEnv(env);
      // internal 运行时 shim 已在 PATH 上时，阻止 Windows 在 PATH 之前从 CWD 解析
      // .cmd/.exe。否则用户主目录里的旧 shim（来自之前的 bun/npm 全局安装）会遮蔽
      // 我们的 internal 运行时 shim。
      env['NoDefaultCurrentDirectoryInExePath'] = '1';
    }
    return env;
  }

  // Unix 系统：增强 PATH 与环境变量
  const home = homedir();
  const pathComponents = [
    ...binDirs,                             // 🔥 用户数据 bin（root + 可选 node-shims，仅 internal 模式）
    runtimeBinPath || '',                   // 全局 CLI 入口（仅路径 B），排 shim 之后、系统之前
    '/opt/homebrew/bin',                    // Homebrew (Apple Silicon)
    '/opt/homebrew/sbin',
    '/usr/local/bin',                       // Homebrew (Intel) / 手动安装
    '/usr/local/sbin',
    '/usr/bin',                             // 系统命令
    '/bin',                                 // 基础系统命令
    '/usr/sbin',                            // 系统管理命令
    '/sbin',                                // 基础系统管理命令
    `${home}/.local/bin`,                   // 用户本地安装
    `${home}/.cargo/bin`,                   // Rust/Cargo
    `${home}/.npm-global/bin`,              // npm 全局
    `${home}/.pyenv/shims`,                 // pyenv 管理的 Python
    `${home}/.nvm/current/bin`,             // nvm 管理的 Node.js
    '/Library/Frameworks/Python.framework/Versions/Current/bin', // Python.org 安装
    '/opt/miniconda3/bin',                  // Miniconda
    '/opt/anaconda3/bin',                   // Anaconda
    env.PATH || ''                          // 原始 PATH
  ];

  const enhancedEnv: Record<string, string> = {
    ...env,
    PATH: pathComponents.filter(p => p).join(pathSeparator),
    HOME: env.HOME || home,
    USER: env.USER || 'user',
    SHELL: env.SHELL || '/bin/bash',
    TMPDIR: env.TMPDIR || '/tmp',
    LANG: env.LANG || 'en_US.UTF-8'
  };

  applyEnvironmentManagerVars(enhancedEnv, home);

  if (includeBinPath) {
    getTerminalRuntimeBridge()?.applyRuntimeEnv(enhancedEnv);
  }

  return enhancedEnv;
}

/**
 * 补全各语言版本管理器变量（pyenv、nvm、rbenv、nodenv、Rust、Go、Homebrew）。
 * 仅在对应变量缺失时写入。
 */
function applyEnvironmentManagerVars(env: Record<string, string>, home: string): void {
  const defaults: Record<string, string> = {
    PYENV_ROOT: `${home}/.pyenv`,
    NVM_DIR: `${home}/.nvm`,
    RBENV_ROOT: `${home}/.rbenv`,
    NODENV_ROOT: `${home}/.nodenv`,
    CARGO_HOME: `${home}/.cargo`,
    RUSTUP_HOME: `${home}/.rustup`,
    GOPATH: `${home}/go`
  };

  for (const [key, value] of Object.entries(defaults)) {
    if (!env[key]) {
      env[key] = value;
    }
  }

  // Homebrew (macOS)
  if (process.platform === 'darwin') {
    if (!env.HOMEBREW_PREFIX) {
      env.HOMEBREW_PREFIX = process.arch === 'arm64' ? '/opt/homebrew' : '/usr/local';
    }
    if (!env.HOMEBREW_CELLAR) {
      env.HOMEBREW_CELLAR = `${env.HOMEBREW_PREFIX}/Cellar`;
    }
    if (!env.HOMEBREW_REPOSITORY) {
      env.HOMEBREW_REPOSITORY = `${env.HOMEBREW_PREFIX}/Homebrew`;
    }
  }
}

/**
 * 将 envFile 内容解析为键值对数组。
 */
export function parseEnvFile(content: string): Array<[string, string]> {
  const result: Array<[string, string]> = [];

  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    const equalIndex = trimmed.indexOf('=');
    if (equalIndex === -1) {
      continue;
    }

    const key = trimmed.substring(0, equalIndex).trim();
    const value = trimmed.substring(equalIndex + 1).trim();

    // 去除首尾成对引号
    result.push([key, value.replace(/^["']|["']$/g, '')]);
  }

  return result;
}

/**
 * 将波浪号路径展开为绝对路径。
 */
export function untildify(filePath: string): string {
  if (filePath.startsWith('~/')) {
    return path.join(homedir(), filePath.slice(2));
  }
  return filePath;
}

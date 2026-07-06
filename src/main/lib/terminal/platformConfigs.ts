/**
 * 各平台的 shell 配置数据表 + 无状态的 shell 解析工具。
 *
 * 纯数据（`PLATFORM_CONFIGS`）+ 一组纯函数：平台配置解析、shell profile 查找、
 * 命令可用性探测（带模块级缓存）、命令路径解析、环境变量构建。无实例状态，无单例。
 */

import * as path from 'path';
import * as fs from 'fs/promises';
import { execSync } from 'child_process';
import { ShellType, ShellProfile, PlatformConfig } from './types';
import { buildEnhancedEnvironment } from './environment';

/**
 * 平台专属的 shell 配置。
 */
export const PLATFORM_CONFIGS: Partial<Record<NodeJS.Platform, PlatformConfig>> = {
  win32: {
    shells: {
      powershell: {
        command: 'powershell.exe',
        args: ['-NoLogo', '-NoProfile', '-ExecutionPolicy', 'Bypass'],
        supportsPersistent: true
      },
      cmd: {
        command: process.env.ComSpec || 'cmd.exe',
        args: ['/d', '/s'],
        supportsPersistent: false
      },
      bash: {
        command: 'bash.exe', // WSL or Git Bash
        args: ['-l'],
        supportsPersistent: true
      },
      sh: {
        command: 'sh.exe',
        args: [],
        supportsPersistent: false
      },
      zsh: {
        command: 'zsh.exe', // WSL or Git Bash
        args: ['-l'],
        supportsPersistent: true
      }
    },
    defaultShell: 'powershell',
    pathSeparator: ';',
    executableExtensions: ['.exe', '.cmd', '.bat', '.com']
  },

  darwin: {
    shells: {
      zsh: {
        command: '/bin/zsh',
        args: ['-l', '-i'],  // interactive login shell — ensures ~/.zshrc is loaded
        supportsPersistent: true
      },
      bash: {
        command: '/bin/bash',
        args: ['-l', '-i'],  // interactive login shell — ensures ~/.bash_profile and ~/.bashrc are loaded
        supportsPersistent: true
      },
      sh: {
        command: '/bin/sh',
        args: ['-l'],  // load at least the login configuration
        supportsPersistent: false
      },
      powershell: {
        command: 'pwsh', // PowerShell Core
        args: ['-NoLogo', '-NoProfile', '-ExecutionPolicy', 'Bypass'],
        supportsPersistent: true
      },
      cmd: {
        command: '/bin/sh', // Fallback to sh
        args: ['-l', '-c'],  // run command after loading configuration
        supportsPersistent: false
      }
    },
    defaultShell: 'zsh',
    pathSeparator: ':',
    executableExtensions: ['']
  }
};

/**
 * 返回当前平台的配置，未知平台回退到 darwin。
 */
export function getPlatformConfig(): PlatformConfig {
  return PLATFORM_CONFIGS[process.platform] || PLATFORM_CONFIGS.darwin!;
}

/**
 * 当前平台的默认 shell 类型。
 */
export function getDefaultShell(): ShellType {
  return getPlatformConfig().defaultShell;
}

/**
 * 返回指定 shell 类型的 profile，未知类型回退到默认 shell。
 */
export function getShellProfile(shell?: ShellType): ShellProfile {
  const config = getPlatformConfig();
  const shellType = shell || config.defaultShell;
  return config.shells[shellType] || config.shells[config.defaultShell];
}

/**
 * 返回一个实际可运行的 shell profile：请求的 shell 不可用时回退到默认 shell，
 * 默认 shell 也不可用时原样返回并附带 fallbackReason。
 */
export async function getRunnableShellProfile(
  shell?: ShellType
): Promise<{ shellType: ShellType; profile: ShellProfile; fallbackReason?: string }> {
  const config = getPlatformConfig();
  const requestedShell = shell || config.defaultShell;
  const requestedProfile = getShellProfile(requestedShell);

  if (await isShellCommandAvailable(requestedProfile.command)) {
    return { shellType: requestedShell, profile: requestedProfile };
  }

  const defaultShell = config.defaultShell;
  const defaultProfile = getShellProfile(defaultShell);
  if (requestedShell !== defaultShell && (await isShellCommandAvailable(defaultProfile.command))) {
    return {
      shellType: defaultShell,
      profile: defaultProfile,
      fallbackReason: `Shell '${requestedShell}' is unavailable; falling back to '${defaultShell}'.`
    };
  }

  return {
    shellType: requestedShell,
    profile: requestedProfile,
    fallbackReason: `Shell '${requestedShell}' command '${requestedProfile.command}' is unavailable.`
  };
}

/** shell 命令可用性缓存，键为 `${platform}:${command}`。 */
const shellAvailabilityCache = new Map<string, boolean>();

/**
 * 判断某个 shell 命令是否可用（带缓存）。
 */
export async function isShellCommandAvailable(command: string): Promise<boolean> {
  if (!command || command.trim() === '') {
    return false;
  }

  const cacheKey = `${process.platform}:${command}`;
  const cached = shellAvailabilityCache.get(cacheKey);
  if (cached !== undefined) {
    return cached;
  }

  const available = await probeShellCommand(command);
  shellAvailabilityCache.set(cacheKey, available);
  return available;
}

async function probeShellCommand(command: string): Promise<boolean> {
  if (path.isAbsolute(command)) {
    try {
      await fs.access(command, fs.constants.F_OK | fs.constants.X_OK);
      return true;
    } catch {
      return false;
    }
  }

  const resolved = await resolveCommandPath(command);
  if (resolved !== command) {
    return true;
  }

  // Windows：内置 shell 即使未在 PATH 中解析到，也按已知位置视为可用
  if (process.platform === 'win32') {
    const normalizedCommand = command.toLowerCase();
    if (normalizedCommand === 'powershell.exe') {
      return true;
    }
    if (normalizedCommand === 'cmd.exe') {
      const systemRoot = process.env.SystemRoot || 'C:\\Windows';
      const comspec = process.env.ComSpec || path.join(systemRoot, 'System32', 'cmd.exe');
      return comspec.toLowerCase().endsWith('cmd.exe');
    }
  }

  return false;
}

/**
 * 解析命令的完整路径：用系统自带的 `where`（Windows）/ `which`（Unix）探测。
 * 未找到时原样返回命令，交由调用方判断（`resolved === command` 即视为未解析到）。
 */
export async function resolveCommandPath(command: string): Promise<string> {
  const probe = process.platform === 'win32' ? 'where' : 'which';
  try {
    const output = execSync(`${probe} "${command}"`, {
      encoding: 'utf8',
      env: getEnhancedEnvironment() as NodeJS.ProcessEnv,
      timeout: 5_000
    }).trim();

    // `where` 可能返回多行；取首个非空行
    const first = output.split(/\r?\n/).find(line => line.trim().length > 0);
    return first?.trim() || command;
  } catch {
    return command;
  }
}

/**
 * 返回增强的环境变量。
 * @param includeBinPath 是否包含用户数据 root bin 路径（internal 模式 true，system 模式 false）
 * @param includeNodeShims 是否额外前插 node-shims 子目录（MCP true，shell false）
 */
export function getEnhancedEnvironment(includeBinPath: boolean = true, includeNodeShims: boolean = false): Record<string, string> {
  return buildEnhancedEnvironment(getPlatformConfig().pathSeparator, includeBinPath, includeNodeShims);
}

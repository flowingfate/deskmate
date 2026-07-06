/**
 * 命令行构建 —— 纯函数集合，无状态。
 *
 * 把用户给的 command/args 拼装成传给具体 shell 的调用（PowerShell 用 -Command，
 * 其余用 -c），并处理带空格的可执行路径引号、interactive 登录 shell 的包装脚本、
 * cwd 缺失时的补偿前缀。所有函数不持有自身状态，shell profile / binPath 等由调用方传入。
 */

import { homedir } from 'os';

/**
 * 拆分命令字符串，把可执行文件与内联参数分开。
 * 处理带引号的可执行路径（如 `"C:\Program Files\app.exe" --flag`）
 * 以及简单命令（如 `python scripts/test.py --arg`）。
 */
export function parseCommandString(command: string): { executable: string; inlineArgs: string } {
  const trimmed = command.trim();

  // 情形 1：命令以引号开头 —— 找到匹配的闭合引号
  for (const quote of ['"', "'"] as const) {
    if (trimmed.startsWith(quote)) {
      const closingQuote = trimmed.indexOf(quote, 1);
      if (closingQuote > 0) {
        const executable = trimmed.substring(1, closingQuote);
        const inlineArgs = trimmed.substring(closingQuote + 1).trim();
        return { executable: `${quote}${executable}${quote}`, inlineArgs }; // 保留引号以支持带空格的路径
      }
    }
  }

  // 情形 2：简单命令 —— 按第一个空格拆分
  const firstSpace = trimmed.indexOf(' ');
  if (firstSpace > 0) {
    return {
      executable: trimmed.substring(0, firstSpace),
      inlineArgs: trimmed.substring(firstSpace + 1).trim()
    };
  }

  // 情形 3：无参数
  return { executable: trimmed, inlineArgs: '' };
}

/**
 * 构建 shell 调用参数。
 *
 * 始终通过 shell 执行命令，以避免命令解析错误，让 shell 处理路径解析、
 * 参数解析、管道、重定向等。
 *
 * @param command    用户命令（可能含内联参数）
 * @param args       额外参数数组
 * @param prefix     命令前缀（如 cwd 缺失补偿）
 * @param shellCommand shell 可执行文件
 * @param shellArgs  shell 参数
 * @param shellType  用于 interactive 包装脚本的 shell 类型
 * @param prependDirs 加载 shell 配置后重新前置到 PATH 的目录集（写入包装脚本），空数组时跳过
 */
export function buildShellInvocation(params: {
  command: string;
  args: string[];
  prefix: string;
  shellCommand: string;
  shellArgs: string[];
  shellType: string;
  prependDirs: string[];
}): { executable: string; args: string[]; shell: boolean } {
  const { command, args: configArgs, prefix, shellCommand, shellArgs, shellType, prependDirs } = params;
  const isPowerShell = shellCommand.includes('powershell') || shellCommand.includes('pwsh');

  // 拆分可执行文件与内联参数
  // 如 "python scripts/download.py url" -> executable: "python", inlineArgs: "scripts/download.py url"
  const { executable: cmdExecutable, inlineArgs } = parseCommandString(command);

  // Windows 路径含空格的关键修复：仅当可执行路径含空格和路径分隔符时才加引号，
  // 不要把整条命令（含参数）都引起来。
  const execHasSpaces = cmdExecutable.includes(' ');
  const execHasPathSep = cmdExecutable.includes('\\') || cmdExecutable.includes('/');
  const execIsQuoted = cmdExecutable.startsWith('"') || cmdExecutable.startsWith("'");

  const quotedExecutable = process.platform === 'win32' && execHasSpaces && execHasPathSep && !execIsQuoted
    ? `"${cmdExecutable}"`  // 仅引住形如 "C:\Program Files\App\bin.exe" 的路径
    : cmdExecutable;

  // 重建命令：引住的可执行文件 + 内联参数
  let fullCommand = prefix + (inlineArgs ? `${quotedExecutable} ${inlineArgs}` : quotedExecutable);

  if (configArgs.length > 0) {
    const quotedArgs = configArgs.map(arg =>
      arg.includes(' ') && !arg.startsWith('"') && !arg.startsWith("'") ? `"${arg}"` : arg
    );
    fullCommand += ' ' + quotedArgs.join(' ');
  }

  // PowerShell 关键修复：执行带引号的可执行路径时（如 "C:\Program Files\exe" -v），
  // PowerShell 需要调用运算符 '&'。仅当可执行文件本身被引住时才加 '&'。
  if (process.platform === 'win32' && isPowerShell && quotedExecutable.startsWith('"')) {
    fullCommand = '& ' + fullCommand;
  }

  const finalShellArgs = [...shellArgs];

  // PowerShell 用 -Command 标志执行命令字符串
  if (isPowerShell) {
    return {
      executable: shellCommand,
      args: [...finalShellArgs, '-Command', fullCommand],
      shell: false // 已显式使用 shell，无需额外 shell 包装
    };
  }

  // 含 -i 时需要特殊处理：-i 与 -c 不能直接同用。
  // 移除 -i，改用包装脚本先加载 shell 配置再执行命令，并通过 PS1 模拟 interactive 环境。
  if (finalShellArgs.includes('-i')) {
    const filteredArgs = finalShellArgs.filter(arg => arg !== '-i');
    const wrapperCommand = createShellWrapper(fullCommand, shellType, prependDirs);
    return {
      executable: shellCommand,
      args: [...filteredArgs, '-c', wrapperCommand],
      shell: false
    };
  }

  return {
    executable: shellCommand,
    args: [...finalShellArgs, '-c', fullCommand],
    shell: false
  };
}

/**
 * 构建包装脚本，确保子进程加载完整的用户环境后再执行命令。
 * @param prependDirs 加载 shell 配置后重新前置到 PATH 的目录集，空数组时跳过
 */
export function createShellWrapper(command: string, shellType: string, prependDirs: string[]): string {
  const home = homedir();

  // 加载 shell 配置后，重新把 bin 目录前置到 PATH，覆盖 pyenv/nvm 等在
  // .zshrc/.bashrc 中对 PATH 的修改。scope 由调用方决定（shell 仅 root，MCP 含 node-shims）。
  const pathOverride = prependDirs.length ? `export PATH="${prependDirs.join(':')}:$PATH"` : '';

  // 各 shell 类型加载的配置文件不同
  const configLoaders: Record<string, string> = {
    zsh: [
      `[[ -f "${home}/.zshenv" ]] && source "${home}/.zshenv"`,
      `[[ -f "${home}/.zprofile" ]] && source "${home}/.zprofile"`,
      `[[ -f "${home}/.zshrc" ]] && source "${home}/.zshrc"`
    ].join('\n'),
    bash: [
      `[[ -f "${home}/.bash_profile" ]] && source "${home}/.bash_profile"`,
      `[[ -f "${home}/.bashrc" ]] && source "${home}/.bashrc"`
    ].join('\n')
  };

  // 其它 shell 尝试加载通用配置
  const loader = configLoaders[shellType] || `[[ -f "${home}/.profile" ]] && source "${home}/.profile"`;

  return `
    # 模拟 interactive 环境
    export PS1='$ '
    # 加载 shell 配置文件
    ${loader}
    # 重新前置 bin 目录到 PATH（覆盖 pyenv/nvm 的修改，仅 internal 模式）
    ${pathOverride}
    # 执行实际命令
    ${command}
  `.replace(/^\s+/gm, '').trim();
}

/**
 * cwd 缺失时生成一个切换目录的命令前缀，回退到 home 目录执行。
 */
export function createMissingCwdPrefix(originalCwd: string, shellCommand: string): string {
  const escapedCwd = originalCwd.replace(/"/g, '""');
  const normalizedCwd = originalCwd.replace(/\\/g, '/');
  const normalizedShell = shellCommand.toLowerCase();

  if (normalizedShell.includes('powershell') || normalizedShell.includes('pwsh')) {
    return `Set-Location -LiteralPath "${escapedCwd}"; `;
  }

  if (normalizedShell.includes('cmd.exe')) {
    return `cd /d "${escapedCwd}" && `;
  }

  return `cd "${normalizedCwd.replace(/"/g, '\\"')}" && `;
}

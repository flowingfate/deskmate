import * as fs from 'fs';
import * as path from 'path';
import { log } from '@main/log';

const logger = log;

/**
 * ============================================================================
 * SHIM MANAGEMENT
 * ============================================================================
 *
 * Shims are small wrapper scripts that redirect command calls to internal tools.
 * For example, when user runs "python", the shim redirects it to "uv run python".
 *
 * This approach allows us to:
 * 1. Override system commands (python, pip, npm, node) with our managed versions
 * 2. Use uv's Python management for all Python-related commands
 * 3. Use bun as a faster alternative for Node.js/npm commands
 *
 * 落盘布局分两层，服务不同消费者（见 environment.ts 的 PATH scope 分叉）：
 * - root bin（{userData}/env/bin/）：Python shim + 真二进制 bun/uv/uvx。shell 工具只前插
 *   此层 → python/pip 走 uv、bun/uv/uvx 真名可用、node/npm/npx 落系统。
 * - node-shims 子目录（{userData}/env/bin/node-shims/）：node 生态 shim。仅 MCP 额外前插
 *   此层 → 拿到全套 node shim（维持历史行为）。
 *
 * SHIM LIST:
 * ┌─────────────┬─────────────────────────┬────────────┬──────────────┐
 * │ Shim        │ Redirects to            │ Dependency │ 落盘目录     │
 * ├─────────────┼─────────────────────────┼────────────┼──────────────┤
 * │ python      │ uv run python           │ uv         │ root bin     │
 * │ python3     │ uv run python           │ uv         │ root bin     │
 * │ pip         │ uv pip                  │ uv         │ root bin     │
 * │ pip3        │ uv pip                  │ uv         │ root bin     │
 * │ uvx         │ uv tool run             │ uv         │ root bin     │
 * │ bunx        │ bun x -y                │ bun        │ root bin     │
 * │ npm         │ ../bun                  │ bun        │ node-shims   │
 * │ npx         │ ../bun x -y             │ bun        │ node-shims   │
 * │ node        │ ../bun                  │ bun        │ node-shims   │
 * └─────────────┴─────────────────────────┴────────────┴──────────────┘
 *
 * uvx/bunx 显式调自带 runtime、不冒充系统命令 → 与真二进制同列 root。仅 node/npm/npx
 * 冒充系统命令名（高风险静默替换）落 node-shims 子目录，以 `../bun` 反向引用 root 真二进制。
 *
 * On Windows, shims are .cmd batch files. On Unix/macOS, shims are shell scripts.
 *
 * @param binPath - Absolute path to {userData}/env/bin/ (root)；node-shims 子目录由本函数派生。
 * @param forceRecreate - If true, recreate all shims even if they exist.
 *                        Set to true when:
 *                        - App starts in internal mode (ensure shims are up-to-date)
 *                        - After installing a new tool (create shims for the new tool)
 * @param forTool - If set, only (re)create shims for this tool ('uv' | 'bun'), leaving the
 *              other tool's shims untouched. Used right after installing a single tool.
 */
export function ensureShims(binPath: string, forceRecreate: boolean = false, forTool?: 'uv' | 'bun'): void {
  try {
    if (!fs.existsSync(binPath)) {
      return;
    }

    const isWin = process.platform === 'win32';
    const nodeShimsDir = path.join(binPath, 'node-shims');
    const createdShims: string[] = [];
    const skippedShims: string[] = [];

    /**
     * 创建单个 shim 文件。
     * @param dir - 落盘目录（Python shim → root binPath；node shim → nodeShimsDir）。
     * @param name - shim 文件名（如 'python.cmd' / 'python'）。
     * @param content - 脚本内容。
     * @param dependency - 该 shim 依赖的工具（真二进制恒在 root binPath）。
     */
    const createShim = (dir: string, name: string, content: string, dependency: 'uv' | 'bun') => {
      // Filter to a single tool when `forTool` is set (e.g. right after installing that tool).
      if (forTool && forTool !== dependency) return;
      // Skip creating shim if its dependency tool is not installed (always in root binPath).
      const depPath = path.join(binPath, isWin ? `${dependency}.exe` : dependency);
      if (!fs.existsSync(depPath)) {
        skippedShims.push(`${name} (missing ${dependency})`);
        return;
      }

      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      const shimPath = path.join(dir, name);
      // Recreate if forceRecreate is true or if shim doesn't exist
      if (forceRecreate || !fs.existsSync(shimPath)) {
        fs.writeFileSync(shimPath, content, { encoding: 'utf-8', mode: 0o755 });
        createdShims.push(name);
      }
    };

    if (isWin) {
      // ========== Windows .cmd Shims ==========
      // Format: @echo off + call to actual executable with %* for all arguments
      // %~dp0 expands to the directory containing the .cmd file.

      // UV-dependent shims (Python ecosystem) → root bin，引用同目录 uv.exe。
      createShim(binPath, 'python.cmd', '@echo off\r\n"%~dp0uv.exe" run python %*', 'uv');
      createShim(binPath, 'python3.cmd', '@echo off\r\n"%~dp0uv.exe" run python %*', 'uv');
      createShim(binPath, 'pip.cmd', '@echo off\r\n"%~dp0uv.exe" pip %*', 'uv');
      createShim(binPath, 'pip3.cmd', '@echo off\r\n"%~dp0uv.exe" pip %*', 'uv');
      createShim(binPath, 'uvx.cmd', '@echo off\r\n"%~dp0uv.exe" tool run %*', 'uv');
      // bunx 同 uvx：显式调自带 runtime 的 x 命令，不冒充系统命令 → 放 root，引用同目录 bun.exe。
      createShim(binPath, 'bunx.cmd', '@echo off\r\n"%~dp0bun.exe" x -y %*', 'bun');

      // Node.js shims：冒充系统命令名（高风险静默替换）→ node-shims 子目录，引用上级 bun.exe。
      createShim(nodeShimsDir, 'npm.cmd', '@echo off\r\n"%~dp0..\\bun.exe" %*', 'bun');
      createShim(nodeShimsDir, 'npx.cmd', '@echo off\r\n"%~dp0..\\bun.exe" x -y %*', 'bun');
      createShim(nodeShimsDir, 'node.cmd', '@echo off\r\n"%~dp0..\\bun.exe" %*', 'bun');

    } else {
      // ========== Unix/macOS Shell Shims ==========
      // Format: #!/bin/sh script that execs the actual command. $DIR = shim 所在目录，
      // 故 Python shim 引用 "$DIR/uv"，node shim（在子目录）引用 "$DIR/../bun"。

      const createShellShim = (dir: string, name: string, commandRel: string, args: string, dependency: 'uv' | 'bun') => {
        const content = `#!/bin/sh\nDIR="$(dirname "$0")"\nexec "$DIR/${commandRel}" ${args} "$@"\n`;
        createShim(dir, name, content, dependency);
      };

      // UV-dependent shims (Python ecosystem) → root bin。
      createShellShim(binPath, 'python', 'uv', 'run python', 'uv');
      createShellShim(binPath, 'python3', 'uv', 'run python', 'uv');
      createShellShim(binPath, 'pip', 'uv', 'pip', 'uv');
      createShellShim(binPath, 'pip3', 'uv', 'pip', 'uv');
      createShellShim(binPath, 'uvx', 'uv', 'tool run', 'uv');
      // bunx 同 uvx：显式调自带 runtime 的 x 命令，不冒充系统命令 → 放 root，引用同目录 bun。
      createShellShim(binPath, 'bunx', 'bun', 'x -y', 'bun');

      // Node.js shims：冒充系统命令名（高风险静默替换）→ node-shims 子目录，引用上级 bun。
      createShellShim(nodeShimsDir, 'npm', '../bun', '', 'bun');
      createShellShim(nodeShimsDir, 'npx', '../bun', 'x -y', 'bun');
      createShellShim(nodeShimsDir, 'node', '../bun', '', 'bun');
    }
    if (createdShims.length > 0) {
      logger.info({ msg: `Shims created/updated: ${createdShims.join(', ')}`, mod: 'RuntimeManager' });
    }
    if (skippedShims.length > 0) {
      logger.debug({ msg: `Shims skipped (dependency not installed): ${skippedShims.join(', ')}`, mod: 'RuntimeManager' });
    }
    logger.debug({ msg: 'Shims check completed', mod: 'RuntimeManager' });
  } catch (e) {
    logger.error({ msg: 'Failed to ensure shims', mod: 'RuntimeManager', err: e });
  }
}

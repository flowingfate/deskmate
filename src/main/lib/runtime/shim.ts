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
 * SHIM LIST:
 * ┌─────────────┬─────────────────────────┬────────────┐
 * │ Shim        │ Redirects to            │ Dependency │
 * ├─────────────┼─────────────────────────┼────────────┤
 * │ python      │ uv run python           │ uv         │
 * │ python3     │ uv run python           │ uv         │
 * │ pip         │ uv pip                  │ uv         │
 * │ pip3        │ uv pip                  │ uv         │
 * │ uvx         │ uv tool run             │ uv         │
 * │ npm         │ bun                     │ bun        │
 * │ npx         │ bun x -y                │ bun        │
 * │ node        │ bun                     │ bun        │
 * └─────────────┴─────────────────────────┴────────────┘
 *
 * On Windows, shims are .cmd batch files.
 * On Unix/macOS, shims are shell scripts.
 *
 * @param binPath - Absolute path to {userData}/bin/, the directory the shims live in.
 * @param forceRecreate - If true, recreate all shims even if they exist.
 *                        Set to true when:
 *                        - App starts in internal mode (ensure shims are up-to-date)
 *                        - After installing a new tool (create shims for the new tool)
 */
export function ensureShims(binPath: string, forceRecreate: boolean = false): void {
  try {
    if (!fs.existsSync(binPath)) {
      return;
    }

    const isWin = process.platform === 'win32';
    const createdShims: string[] = [];
    const skippedShims: string[] = [];

    /**
     * Creates a single shim file.
     * @param name - Filename of the shim (e.g., 'python.cmd' or 'python')
     * @param content - The script content to write
     * @param dependency - Optional: the tool that must be installed for this shim to work
     */
    const createShim = (name: string, content: string, dependency?: 'uv' | 'bun') => {
       // Skip creating shim if its dependency tool is not installed
       if (dependency) {
         const depPath = path.join(binPath, isWin ? `${dependency}.exe` : dependency);
         if (!fs.existsSync(depPath)) {
           skippedShims.push(`${name} (missing ${dependency})`);
           return;
         }
       }

       const shimPath = path.join(binPath, name);
       // Recreate if forceRecreate is true or if shim doesn't exist
       if (forceRecreate || !fs.existsSync(shimPath)) {
           fs.writeFileSync(shimPath, content, { encoding: 'utf-8', mode: 0o755 });
           createdShims.push(name);
       }
    };

    if (isWin) {
       // ========== Windows .cmd Shims ==========
       // Format: @echo off + call to actual executable with %* for all arguments
       // %~dp0 expands to the directory containing the .cmd file (our bin folder)

       // UV-dependent shims (Python ecosystem)
       createShim('python.cmd', '@echo off\r\n"%~dp0uv.exe" run python %*', 'uv');
       createShim('python3.cmd', '@echo off\r\n"%~dp0uv.exe" run python %*', 'uv');
       createShim('pip.cmd', '@echo off\r\n"%~dp0uv.exe" pip %*', 'uv');
       createShim('pip3.cmd', '@echo off\r\n"%~dp0uv.exe" pip %*', 'uv');
       createShim('uvx.cmd', '@echo off\r\n"%~dp0uv.exe" tool run %*', 'uv');

       // Bun-dependent shims (Node.js ecosystem)
       createShim('npm.cmd', '@echo off\r\n"%~dp0bun.exe" %*', 'bun');
       createShim('npx.cmd', '@echo off\r\n"%~dp0bun.exe" x -y %*', 'bun');
       createShim('node.cmd', '@echo off\r\n"%~dp0bun.exe" %*', 'bun');

    } else {
       // ========== Unix/macOS Shell Shims ==========
       // Format: #!/bin/sh script that execs the actual command
       // $DIR resolves to the directory containing the shim script

       const createShellShim = (name: string, command: string, args: string = '', dependency?: 'uv' | 'bun') => {
           const content = `#!/bin/sh\nDIR="$(dirname "$0")"\nexec "$DIR/${command}" ${args} "$@"\n`;
           createShim(name, content, dependency);
       };

       // UV-dependent shims (Python ecosystem)
       createShellShim('python', 'uv', 'run python', 'uv');
       createShellShim('python3', 'uv', 'run python', 'uv');
       createShellShim('pip', 'uv', 'pip', 'uv');
       createShellShim('pip3', 'uv', 'pip', 'uv');
       createShellShim('uvx', 'uv', 'tool run', 'uv');

       // Bun-dependent shims (Node.js ecosystem)
       createShellShim('npm', 'bun', '', 'bun');
       createShellShim('npx', 'bun', 'x -y', 'bun');
       createShellShim('node', 'bun', '', 'bun');
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

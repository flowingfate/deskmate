/**
 * MCP 持久传输终端实例。
 *
 * 输出解释：stdout 按 `\n` 分帧成 JSON-RPC 消息（`message` 事件），stderr 分帧成日志。
 * 通过 `send()` 写入。始终 `persistent`，故必然装 `TerminalStateHandler` 做优雅关闭。
 *
 * 两个 MCP 专属 hook 在此覆盖基类默认：
 * - `ensureRuntimeInstalled`：首次 spawn 时按命令 lazy-install 运行时（JS→bun / Python→uv），
 *   把成本从 FRE 启动移到首次连接。
 * - `shouldBypassInternalNodeShims`：Windows-ARM 上 node/npm/npx 类命令绕过内置 shim。
 */

import * as path from 'path';
import { BaseTerminalInstance } from './BaseTerminalInstance';
import { StreamSplitter } from './processControl';
import { getTerminalRuntimeBridge } from './runtimeBridge';
import { log } from '@main/log';

export class McpTransportInstance extends BaseTerminalInstance {
  public send(message: string): void {
    if (this._state !== 'running') {
      throw new Error(`Terminal instance is not running (state: ${this._state})`);
    }
    if (!this.stateHandler) {
      throw new Error('State handler not available');
    }
    if (this.stateHandler.stopped) {
      throw new Error('Process has been stopped');
    }

    this.stateHandler.write(message);
    this.lastActivity = Date.now();
  }

  protected async ensureRuntimeInstalled(): Promise<void> {
    try {
      await getTerminalRuntimeBridge()?.ensureRuntimeForCommand(this.config.command, this.config.args);
    } catch (err) {
      log.warn({ msg: 'Lazy runtime install failed; spawning anyway', mod: 'McpTransportInstance', err });
    }
  }

  /**
   * Windows ARM 上，部分通过 Bun 内置 node/npm/npx shim 启动的 npm 包在 MCP server
   * 启动时会因可选原生依赖被解析到错误的运行时而失败（例如 `figma-developer-mcp`
   * 在内置 npx shim 下报 `sharp` win32-arm64 加载错误，而系统 Node.js 下正常）。
   * 此时让 MCP stdio 传输绕过内置 shim、改用系统 PATH，使真正的 node 二进制正确解析。
   */
  protected shouldBypassInternalNodeShims(): boolean {
    if (process.platform !== 'win32' || process.arch !== 'arm64') {
      return false;
    }

    const isNodeCommand = (value: string | undefined): boolean => {
      if (!value) {
        return false;
      }
      const normalized = path.basename(value).trim().replace(/^['"]|['"]$/g, '').toLowerCase();
      return ['node', 'node.exe', 'node.cmd', 'npm', 'npm.cmd', 'npx', 'npx.cmd'].includes(normalized);
    };

    if (isNodeCommand(this.config.command)) {
      return true;
    }

    // `cmd /c node ...` 形式也算
    const args = this.config.args.map(arg => arg.trim().toLowerCase());
    const cmdLower = this.config.command.toLowerCase();
    if ((cmdLower === 'cmd' || cmdLower === 'cmd.exe') && args.length >= 2 && args[0] === '/c' && isNodeCommand(args[1])) {
      return true;
    }

    return false;
  }

  protected setupOutputHandlers(): void {
    if (!this._process) return;

    const stdoutSplitter = new StreamSplitter('\n');
    const stderrSplitter = new StreamSplitter('\n');

    // stdout：入站消息
    this._process.stdout?.on('data', (chunk: Buffer) => {
      stdoutSplitter.write(chunk);
      this.lastActivity = Date.now();
    });
    stdoutSplitter.on('data', (line: Buffer) => {
      const message = line.toString().trim();
      if (message) {
        this.emit('message', message);
      }
    });

    // stderr：日志消息
    this._process.stderr?.on('data', (chunk: Buffer) => stderrSplitter.write(chunk));
    stderrSplitter.on('data', (line: Buffer) => {
      const stderrMessage = line.toString().trim();
      if (stderrMessage) {
        log.warn({ msg: `[${this.id} stderr] ${stderrMessage}` });
        this.emit('stderr', stderrMessage);
      }
    });
  }
}

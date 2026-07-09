/**
 * SDK-facing stdio transport for Deskmate MCP.
 *
 * 薄适配器:让 `@modelcontextprotocol/sdk` 的 `Client` 复用我们自研的
 * `StdioTransport` —— 后者是 `terminalManager.createTransport()` 的门面,
 * 承载 PATH 注入、runtime lazy-install、pyenv、node-shim、envFile 等
 * Deskmate 独有的 stdio 运行时基建。
 *
 * SDK-facing 侧是 `JSONRPCMessage` 对象,wire-facing 侧仍是 `\n` 分帧的
 * JSON 字符串(`StdioTransport` 内部走 `McpTransportInstance` 的 stdout
 * 按行分帧)。适配器只负责边界处的 `JSON.stringify` / `JSON.parse` 与
 * EventEmitter → SDK 回调的桥接。
 */
import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { log } from '@main/log';
import { StdioTransport, type StdioTransportConfig, type ConnectionState } from './wire/StdioTransport';

export class DeskmateStdioSdkTransport implements Transport {
  onmessage?: Transport['onmessage'];
  onclose?: () => void;
  onerror?: (error: Error) => void;

  private readonly inner: StdioTransport;
  /** 已进入终止态(close 触发过 onclose):避免 stateChange / exit 重复回调 */
  private closed = false;
  /** 最近一次 transport 报出的错误消息,用于 close 时补给 SDK */
  private lastErrorMessage: string | null = null;
  private handlersAttached = false;

  constructor(private readonly serverName: string, config: StdioTransportConfig) {
    this.inner = new StdioTransport(config);
  }

  async start(): Promise<void> {
    // SDK 在 `Client.connect()` 里已经先赋值 onmessage / onclose / onerror
    // 再调 start。这里在真正 spawn 之前挂 inner 事件,首帧 stdout / exit
    // 不会丢。
    this.attachHandlers();
    try {
      await this.inner.start();
    } catch (error) {
      // start 自身抛错时(spawn 失败等)不再走 stateChange 分发,
      // 直接把当前 stateChange 上的最后一条 error 消息保存下来,并让 SDK
      // 通过 connect() reject 感知。onclose 由 SDK 的错误处理路径覆盖,
      // 这里不主动触发,避免与 SDK 内部 cleanup 竞争。
      throw error;
    }
  }

  async send(message: JSONRPCMessage): Promise<void> {
    // StdioTransport.send 是同步的、可能同步 throw。把它包成 Promise 让
    // SDK 侧统一 await。
    this.inner.send(JSON.stringify(message));
  }

  async close(): Promise<void> {
    if (this.closed) {
      return;
    }
    this.closed = true;
    try {
      await this.inner.stop();
    } finally {
      // 无论 inner.stop 是否抛错都要通知 SDK,否则 Protocol._responseHandlers
      // 里挂着的 pending request 永远不会被 reject。
      this.onclose?.();
    }
  }

  /**
   * 让 `mcpClient.ts` 的 catch 分支能够在 SDK 报 "Connection closed" /
   * "Request timeout" 的通用错误上补一段真实 stderr,便于用户诊断
   * "npx 找不到" / "python 缺 requirements" 之类的启动失败。
   */
  getStderrPreview(): string {
    return this.inner.getStderrPreview();
  }

  /** 最近一次 transport 报出的错误消息 —— close 后 SDK 只会说 "Connection closed",这里补上真实原因。 */
  getLastErrorMessage(): string | null {
    return this.lastErrorMessage;
  }

  private attachHandlers(): void {
    if (this.handlersAttached) {
      return;
    }
    this.handlersAttached = true;

    this.inner.on('message', (line: string) => {
      if (this.closed) {
        return;
      }
      let parsed: JSONRPCMessage;
      try {
        parsed = JSON.parse(line) as JSONRPCMessage;
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        log.warn({
          msg: 'DeskmateStdioSdkTransport: failed to parse stdout line as JSON-RPC',
          mod: 'DeskmateStdioSdkTransport',
          serverName: this.serverName,
          err: error,
          lineLength: line.length,
        });
        this.onerror?.(error);
        return;
      }
      this.onmessage?.(parsed);
    });

    this.inner.on('stateChange', (state: ConnectionState) => {
      if (this.closed) {
        return;
      }

      if (state.state === 'error') {
        const message = state.message || 'Transport error';
        this.lastErrorMessage = message;
        this.onerror?.(new Error(message));
        // error 状态代表 transport 不再可用 —— 触发 close 让 SDK
        // reject 所有 pending request。设 closed 前保存原因。
        this.closed = true;
        this.onclose?.();
        return;
      }

      if (state.state === 'stopped') {
        // stop() 主动调过来 close() 分支已经吃掉 closed; 这里是子进程
        // 自己退出。
        this.closed = true;
        this.onclose?.();
      }
    });

    // StdioTransport 的 'log' 事件仅走内部诊断输出,不映射到 SDK 层:
    // SDK 只需要 onmessage/onclose/onerror 三个信号。诊断日志已经落到
    // pino sqlite (见 log-analysis.md)。
  }
}

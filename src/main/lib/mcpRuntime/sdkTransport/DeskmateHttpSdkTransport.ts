/**
 * SDK-facing HTTP / SSE transport for Deskmate MCP.
 *
 * 薄适配器:让 `@modelcontextprotocol/sdk` 的 `Client` 复用我们自研的
 * `HttpTransport` —— 后者承载 Deskmate 的桌面 OAuth 编排:401/403 →
 * `WWW-Authenticate` 解析 → renderer consent 弹窗 → PKCE / DCR → 浏览器
 * 环回 → token 缓存 → forced-refresh 重试。所有这套 SDK 内置
 * `authProvider` 装不下的桌面 UX 门控,继续留在 `HttpTransport` 里跑。
 *
 * SDK-facing 侧是 `JSONRPCMessage` 对象,wire-facing 侧是 JSON 字符串
 * (`HttpTransport` 内部把 Streamable HTTP body 与 legacy SSE `data:` 帧
 * 都归一成字符串 emit)。适配器只做边界处的 `JSON.stringify` /
 * `JSON.parse` 与 EventEmitter → SDK 回调的桥接。
 */
import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { log } from '@main/log';
import { HttpTransport, type HttpTransportConfig, type ConnectionState } from './wire/HttpTransport';

export class DeskmateHttpSdkTransport implements Transport {
  onmessage?: Transport['onmessage'];
  onclose?: () => void;
  onerror?: (error: Error) => void;

  private readonly inner: HttpTransport;
  private closed = false;
  private lastErrorMessage: string | null = null;
  private handlersAttached = false;

  constructor(private readonly serverName: string, config: HttpTransportConfig) {
    this.inner = new HttpTransport(config);
  }

  async start(): Promise<void> {
    this.attachHandlers();
    await this.inner.start();
  }

  async send(message: JSONRPCMessage): Promise<void> {
    // HttpTransport.send 返回 Promise —— 内部会驱动
    // `_sendStreamableHttp` / `_sendLegacySSE`,包含 OAuth 重试。await
    // 让 SDK 的 request timeout 与 abort signal 能覆盖网络阶段。
    await this.inner.send(JSON.stringify(message));
  }

  async close(): Promise<void> {
    if (this.closed) {
      return;
    }
    this.closed = true;
    try {
      await this.inner.stop();
    } finally {
      this.onclose?.();
    }
  }

  /** HTTP transport 没有 stderr;这里返回空串,让 mcpClient 的错误增强逻辑跳过。 */
  getStderrPreview(): string {
    return '';
  }

  getLastErrorMessage(): string | null {
    return this.lastErrorMessage;
  }

  private attachHandlers(): void {
    if (this.handlersAttached) {
      return;
    }
    this.handlersAttached = true;

    this.inner.on('message', (raw: string) => {
      if (this.closed) {
        return;
      }
      let parsed: JSONRPCMessage;
      try {
        parsed = JSON.parse(raw) as JSONRPCMessage;
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        log.warn({
          msg: 'DeskmateHttpSdkTransport: failed to parse HTTP body as JSON-RPC',
          mod: 'DeskmateHttpSdkTransport',
          serverName: this.serverName,
          err: error,
          bodyLength: raw.length,
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
        // HTTP transport 的 error 状态代表连接不可恢复:reject SDK 侧
        // 的所有 pending request,避免用户在死连接上继续等。
        this.closed = true;
        this.onclose?.();
        return;
      }

      if (state.state === 'stopped') {
        this.closed = true;
        this.onclose?.();
      }
    });
  }
}

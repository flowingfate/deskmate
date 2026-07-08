/**
 * SDK-facing Deskmate MCP transports barrel.
 *
 * 让 `mcpClient.ts` 只跟一个统一的 adapter 类型打交道 —— 具体是 stdio
 * 还是 HTTP/SSE 由构造函数按 server config 决定,消费侧不再需要 switch。
 */
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';

export { DeskmateStdioSdkTransport } from './DeskmateStdioSdkTransport';
export { DeskmateHttpSdkTransport } from './DeskmateHttpSdkTransport';

/**
 * 两个 Deskmate adapter 都实现 SDK `Transport`,并额外暴露诊断入口。
 * `mcpClient.ts` 用这个共同形态在 SDK 报出通用错误后补充真实原因。
 */
export interface DeskmateSdkTransport extends Transport {
  /** stdio 返回子进程 stderr 尾部;HTTP 返回空串。 */
  getStderrPreview(): string;
  /** transport 最近一次自报的错误消息(state='error');close 后 SDK 只知道 "Connection closed",这里补真实原因。 */
  getLastErrorMessage(): string | null;
}

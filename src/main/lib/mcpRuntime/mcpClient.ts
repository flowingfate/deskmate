/**
 * Deskmate MCP client adapter.
 * 面向 profile-bound `MCPClientManager` 的稳定 seam。**内部实现**已切换到
 * `@modelcontextprotocol/sdk` 的 `Client`(1.29),协议大脑(initialize
 * 握手、request/response 关联、pending map、timeout、AbortSignal、通知分发)
 * 全部由 SDK `Protocol` 承担。
 *
 * Deskmate 只保留两个 SDK-facing transport 适配器,继续把 stdio 委托给
 * `terminalManager.createTransport()`(PATH 注入 / runtime lazy-install /
 * pyenv / envFile 全套桌面运行时基建),把 HTTP/SSE 委托给自研
 * `HttpTransport`(桌面 OAuth 编排 —— consent 弹窗 / DCR fallback /
 * proactive refresh / dedup)。
 *
 * 上层契约:
 *   - `connectToServer(signal?): Promise<void>` —— 失败 / 取消统一 throw
 *   - `getTools(): Promise<Tool[]>`
 *   - `executeTool({ toolName, toolArgs, signal }): Promise<string>`
 *   - `cleanup(): Promise<void>`
 *
 * 生命周期:**一次性**。同一个实例只允许 `connectToServer` 成功一次;
 * `cleanup` 之后不再复用 —— manager 的 reconnect 走"扔掉旧实例 + 新建"。
 *
 * `executeTool` 仍返回扁平 string,SDK `callTool` 的结构化结果由
 * `flattenCallToolResult` 折叠成与旧客户端一致的形态。
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type {
  Tool as SdkTool,
  CallToolResult,
  CompatibilityCallToolResult,
} from '@modelcontextprotocol/sdk/types.js';
import type { McpServerConfig } from '@shared/persist/types'
import { log } from '@main/log';
import {
  DeskmateHttpSdkTransport,
  DeskmateStdioSdkTransport,
  type DeskmateSdkTransport,
} from './sdkTransport';
import { Tool } from './manager/types';
import type { McpAuthService } from './auth';



/**
 * initialize / listTools / callTool 全部走这个 timeout(1h)。
 *
 * SDK `Protocol` 里 `timeout ?? DEFAULT_REQUEST_TIMEOUT_MSEC (60s)` —— `0`
 * 不是 nullish,会被当成"下 tick 立即超时",冷启动下载依赖的 stdio server
 * 会直接连不上。这里显式覆盖成 1h,对齐旧 `McpClientCore` 的"实质无超时"
 * 语义。真正的取消由调用方 `AbortSignal` 走。
 */
const REQUEST_TIMEOUT_MS = 3_600_000;

/**
 * 把 SDK `CallToolResult` 折叠成上层期望的字符串,行为对齐旧客户端:
 *   - `content` 为数组 → 每项优先 `.text`,否则 `JSON.stringify`,`\n` 拼接
 *   - 兼容 `toolResult` 形态(部分 server 走 CompatibilityCallToolResultSchema)
 *   - 其它情况整体 `JSON.stringify`
 */
function flattenCallToolResult(result: CallToolResult | CompatibilityCallToolResult): string {
  if ('content' in result && Array.isArray(result.content)) {
    return result.content
      .map((item) => ('text' in item && typeof item.text === 'string' ? item.text : JSON.stringify(item)))
      .join('\n');
  }
  if ('toolResult' in result) {
    const value = result.toolResult;
    return typeof value === 'string' ? value : JSON.stringify(value);
  }
  return JSON.stringify(result);
}

function mapSdkTool(tool: SdkTool): Tool {
  return {
    name: tool.name,
    description: tool.description ?? '',
    inputSchema: tool.inputSchema,
    annotations: tool.annotations,
  };
}

/**
 * SDK 只报 "MCP error -32000: Connection closed" 之类的通用信息;这里把
 * transport 自报的最后一条 error 消息 + stderr 尾部拼进去,让 renderer 的
 * MCP 错误面板真正能提示"npx 找不到"/"python 缺依赖"这类根因。
 */
function enrichConnectionError(error: unknown, transport: DeskmateSdkTransport | null): Error {
  const baseMessage = error instanceof Error ? error.message : String(error);
  const parts: string[] = [baseMessage];

  const lastError = transport?.getLastErrorMessage();
  if (lastError && !baseMessage.includes(lastError)) {
    parts.push(`Transport error: ${lastError}`);
  }

  const stderr = transport?.getStderrPreview()?.trim();
  if (stderr && !baseMessage.toLowerCase().includes('stderr output')) {
    parts.push(`Stderr output:\n${stderr}`);
  }

  const enriched = new Error(parts.join('\n\n'));
  if (error instanceof Error && error.stack) {
    enriched.stack = error.stack;
  }
  return enriched;
}

function buildTransport(server: McpServerConfig, authService: McpAuthService): DeskmateSdkTransport {
  const isStdio = server.transport === 'stdio';
  if (isStdio) {
    return new DeskmateStdioSdkTransport(server.name, {
      command: server.command,
      args: server.args ?? [],
      env: server.env,
    });
  }

  // 其它 transport(sse / StreamableHttp / 未知字符串)统一走
  // `HttpTransport` —— 后者内部会按首个响应自动区分 Streamable HTTP 与
  // legacy SSE(见 `HttpTransport._sendStreamableHttp` 的 fallback 路径)。
  //
  // 注意 headers 上补 `User-Agent` 默认值:旧 `TransportFactory.normalizeConfig`
  // 一直塞 `Deskmate-MCP-Client/1.0.0`,部分 MCP server 会按 UA 做遥测/阻断,
  // 迁移时必须保留。用户 headers 里同名字段优先(spread 顺序保证)。
  return new DeskmateHttpSdkTransport(server.name, {
    authService,
    serverName: server.name,
    url: server.url,
    headers: {
      'User-Agent': 'Deskmate-MCP-Client/1.0.0',
      ...server.headers,
    },
    mcpServerConfig: server,
  });
}

export class McpClient {
  private sdk: Client | null = null;
  private tools: Tool[] = [];
  private connected = false;

  constructor(
    private readonly server: McpServerConfig,
    private readonly authService: McpAuthService,
  ) {}

  /**
   * 连接 MCP server 并拉取工具列表。**一次性**:成功一次后同实例不可再连。
   *
   * `signal` 透传到 SDK `Protocol.request` —— 底层 JSON-RPC pending request
   * 收到 abort 会立刻 reject(`AbortError`),不空等 `REQUEST_TIMEOUT_MS`。
   *
   * 失败 / 取消都 throw:caller 按 `signal.aborted` 区分"取消"(不 log,
   * 不打 error 状态)与"连接失败"(已在此处 log.warn + enrich 根因)。
   */
  async connectToServer(signal?: AbortSignal): Promise<void> {
    // 一次性契约:重复 connect 直接 throw,避免 SDK 的 "Already connected
    // to a transport" 走到隐晦的运行时断言。
    if (this.sdk) {
      throw new Error('McpClient already connected; create a new instance to reconnect');
    }

    signal?.throwIfAborted?.();

    const transport = buildTransport(this.server, this.authService);

    const client = new Client({
      name: 'Deskmate-MCP-Client',
      version: '1.0.0',
    });
    this.sdk = client;

    try {
      // `Client.connect(transport, options)` 把 options 透传给 initialize
      // 请求(SDK client/index.js:289)。1h timeout 兜底冷启动 stdio server
      // 拉依赖,真取消由 `signal` 走。
      await client.connect(transport, { timeout: REQUEST_TIMEOUT_MS, signal });
      const listResult = await client.listTools(undefined, { timeout: REQUEST_TIMEOUT_MS, signal });
      this.tools = listResult.tools.map(mapSdkTool);
      this.connected = true;
    } catch (error) {
      // Abort:cleanup transport(否则 stdio 子进程/HTTP 连接泄漏),
      // 但不走 enriched 日志路径 —— caller 靠 rethrow 判断是"取消"而非
      // "连接失败"(通常检查 `signal.aborted`)。
      if (signal?.aborted) {
        await this.cleanup();
        throw error;
      }
      const enriched = enrichConnectionError(error, transport);
      log.warn({
        msg: 'MCP connect failed',
        mod: 'McpClient',
        serverName: this.server.name,
        transport: this.server.transport,
        err: enriched,
      });
      // 连接失败后必须把 SDK / transport 都清掉,否则实例状态残留会污染
      // 后续诊断;虽然一次性契约禁止复用,但 cleanup() 保持幂等仍是好习惯。
      await this.cleanup();
      throw enriched;
    }
  }

  async getTools(): Promise<Tool[]> {
    // `connectToServer()` 已经把 tools 缓存进 this.tools; owning manager
    // 只在 connect 成功后立刻调一次 `getTools()` 拿最新列表,不再触发
    // 网络往返。tools/list-changed 通知(SDK 已监听)会由未来的订阅路径
    // 单独 refresh,这里不再重复请求。
    return this.connected ? this.tools : [];
  }

  async executeTool({
    toolName,
    toolArgs,
    signal,
  }: {
    toolName: string;
    toolArgs: { [key: string]: unknown };
    signal?: AbortSignal;
  }): Promise<string> {
    const sdk = this.sdk;
    if (!this.connected || !sdk) {
      throw new Error('Client is not connected to server');
    }
    // fast-fail:已取消的调用不再发起 RPC,与 `connectToServer` 起手对称。
    signal?.throwIfAborted?.();
    const result = await sdk.callTool(
      { name: toolName, arguments: toolArgs },
      undefined,
      { signal, timeout: REQUEST_TIMEOUT_MS },
    );
    return flattenCallToolResult(result);
  }

  async cleanup(): Promise<void> {
    const sdk = this.sdk;
    this.sdk = null;
    this.tools = [];
    this.connected = false;
    if (!sdk) {
      return;
    }
    try {
      // `Client.close()` 内部 await `transport.close()`,后者会把 pending
      // request 全部 reject 并调 `onclose` —— 我们的 adapter 有 `closed`
      // 幂等保护,重复调不会二次触发。
      await sdk.close();
    } catch (error) {
      log.warn({
        msg: 'MCP client close failed',
        mod: 'McpClient',
        serverName: this.server.name,
        err: error,
      });
    }
  }
}

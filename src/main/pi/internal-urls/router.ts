/**
 * Internal URL Router —— 进程级单例,scheme → handler 注册表。
 *
 * 设计同 `pi/tools/registry.ts`(LocalTool registry)与 `appcmd/registry.ts`
 * (AppCommand registry)同纪律:
 *
 * - **重名 throw,绝不静默覆盖** —— 模块加载期就把冲突暴露在 stack。
 * - **进程单例**(`InternalUrlRouter.get()`)—— handler 注册一次,所有 read/write
 *   入口共享。
 * - **handler 无状态** —— 所有 per-session 上下文走 {@link ResolveContext}。
 *
 * 注册顺序对外部语义无影响,但保持稳定有助 prompt cache / 日志可读性。
 */
import { isInternalUrlInput, parseInternalUrl } from './parse';
import type {
  InternalResource,
  ProtocolHandler,
  ResolveContext,
  WriteContext,
} from './types';



export class InternalUrlRouter {
  private static instance: InternalUrlRouter | undefined;

  private readonly handlers = new Map<string, ProtocolHandler>();

  public static get(): InternalUrlRouter {
    return InternalUrlRouter.instance ??= new InternalUrlRouter();
  }

  /** 测试入口:重置全局单例,避免跨用例污染。 */
  public static resetForTesting(): void {
    InternalUrlRouter.instance = undefined;
  }

  public register(handler: ProtocolHandler): void {
    const scheme = handler.scheme.toLowerCase();
    if (this.handlers.has(scheme)) {
      throw new Error(
        `InternalUrlRouter: scheme "${scheme}" already registered. ` +
          'Each scheme allows exactly one handler.',
      );
    }
    this.handlers.set(scheme, handler);
  }

  public unregister(scheme: string): boolean {
    return this.handlers.delete(scheme.toLowerCase());
  }

  /** 当前已注册的所有 scheme(用于错误消息列举"supported")。 */
  public schemes(): readonly string[] {
    return Array.from(this.handlers.keys());
  }

  /** 看 input 是否被某个已注册 handler 接管(不实际解析)。 */
  public canHandle(input: string): boolean {
    if (!isInternalUrlInput(input)) return false;
    try {
      const parsed = parseInternalUrl(input);
      return this.handlers.has(parsed.scheme);
    } catch {
      return false;
    }
  }

  /**
   * 该 input 的 handler 是否实现了 {@link ProtocolHandler.resolveToPath}。
   *
   * dispatch 用它判定"URI 能否翻成真实绝对路径"(office/image/html backend
   * 与 mutable 文本流式 backend 都依赖它):
   * - `local://` / `knowledge://` / `skill://`(均实现) → 可翻绝对路径
   * - 纯 in-memory 系统资产(未实现) → 只能走 router.resolve
   *
   * 不实际调用 resolveToPath,纯能力探测。
   */
  public canResolveToPath(input: string): boolean {
    if (!isInternalUrlInput(input)) return false;
    try {
      const parsed = parseInternalUrl(input);
      const handler = this.handlers.get(parsed.scheme);
      return handler?.resolveToPath !== undefined;
    } catch {
      return false;
    }
  }

  /**
   * 该 input 的 handler 是否声明 `immutable`(curated 只读资产,如 `skill://`)。
   *
   * dispatch 用它决定文本读走哪条 backend:immutable 资产即便实现了
   * `resolveToPath`(为了执行/fs IPC),文本读仍走 `router.resolve` in-memory
   * 路径,以保留 `immutable` 标记 / `contentType` / 友好 not-found 语义;
   * mutable sandbox(`local://` / `knowledge://`)才走 filesystem 流式 backend。
   */
  public isImmutable(input: string): boolean {
    if (!isInternalUrlInput(input)) return false;
    try {
      const parsed = parseInternalUrl(input);
      return this.handlers.get(parsed.scheme)?.immutable === true;
    } catch {
      return false;
    }
  }

  /**
   * 把 internal URL 解析成 {@link InternalResource}。
   *
   * - input 不是合法 internal URL → throw(parser 抛的)
   * - scheme 未注册 → throw,error message 列出 supported schemes
   * - handler resolve throw → 透传(caller 自己包 try/catch)
   *
   * router 在返回前会把 {@link InternalResource.immutable} 从 handler 的
   * `immutable` 字段统一回填 —— handler 不必关心。
   */
  public async resolve(input: string, ctx: ResolveContext): Promise<InternalResource> {
    const parsed = parseInternalUrl(input);
    const handler = this.handlers.get(parsed.scheme);
    if (!handler) {
      const available = this.schemes()
        .map((s) => `${s}://`)
        .join(', ');
      throw new Error(
        `Unknown internal URL scheme "${parsed.scheme}://". Supported: ${available || '(none)'}.`,
      );
    }
    const resource = await handler.resolve(parsed, ctx);
    return { ...resource, immutable: resource.immutable ?? handler.immutable };
  }

  /**
   * 把 internal URL + content dispatch 给 handler.write。
   *
   * - input 不是合法 internal URL → throw(parser 抛的)
   * - scheme 未注册 → throw,error message 列出 supported schemes
   * - handler 没实现 `write?` 钩子(read-only scheme,如 `skill://`)→ throw
   *   友好错误,LLM 看到的是"this scheme is read-only"而不是 silent no-op
   * - handler.write throw → 透传(caller 自己包 try/catch)
   *
   * 调用方:`write` 工具 entry。`local://` / `knowledge://` 实现 `write?`;
   * `skill://` 显式不实现,本方法在该 scheme 上抛错。
   */
  public async write(input: string, content: string, ctx: WriteContext): Promise<void> {
    const parsed = parseInternalUrl(input);
    const handler = this.handlers.get(parsed.scheme);
    if (!handler) {
      const available = this.schemes()
        .map((s) => `${s}://`)
        .join(', ');
      throw new Error(
        `Unknown internal URL scheme "${parsed.scheme}://". Supported: ${available || '(none)'}.`,
      );
    }
    if (!handler.write) {
      throw new Error(
        `Scheme "${parsed.scheme}://" is read-only; cannot write to "${input}".`,
      );
    }
    await handler.write(parsed, content, ctx);
  }

  /**
   * 把 internal URL 翻成绝对文件系统路径(不读 I/O,可为目录)。
   *
   * Renderer 在调老 fs IPC(`fsApi.readFile` / `getWorkspaceFileTree` / 等)
   * 前先把 URI 展开 —— UI 层享受 URI 抽象,fs IPC 通道保持纯绝对路径契约。
   *
   * - input 不是合法 internal URL → throw(parser 抛的)
   * - scheme 未注册 → throw,error message 列出 supported schemes
   * - handler 没实现 `resolveToPath?` 钩子(如 `skill://` 不外泄系统资产路径)
   *   → throw 友好错误
   * - handler.resolveToPath throw(sandbox 越界 / agent / session 缺失)→ 透传
   */
  public async resolveToPath(input: string, ctx: ResolveContext): Promise<string> {
    const parsed = parseInternalUrl(input);
    const handler = this.handlers.get(parsed.scheme);
    if (!handler) {
      const available = this.schemes()
        .map((s) => `${s}://`)
        .join(', ');
      throw new Error(
        `Unknown internal URL scheme "${parsed.scheme}://". Supported: ${available || '(none)'}.`,
      );
    }
    if (!handler.resolveToPath) {
      throw new Error(
        `Scheme "${parsed.scheme}://" does not expose a filesystem path; cannot resolve "${input}".`,
      );
    }
    return handler.resolveToPath(parsed, ctx);
  }
}

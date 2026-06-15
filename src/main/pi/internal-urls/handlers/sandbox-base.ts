/**
 * 共享基类:任何"基地址 + 路径越界检查 + 文本读写"的 scheme 都长一样。
 *
 * 子类只回答一个问题:**给我 ctx,告诉我这个 scheme 的根目录在哪**(`resolveBaseDir`)。
 * 其余 stat / 1MB cap / NUL byte / utf-8 / atomic write / `..` 越界检查全在此处,
 * 子类 0 复制粘贴。
 *
 * 错误消息一律走 `${scheme}://${relPath}` 形态 —— scheme 已经表达"哪个域",
 * 不再在文案里重复 "in current session sandbox" 之类语义化描述(LLM 视角下
 * scheme 名就足够区分)。
 *
 * 边界检查仍走 `rawPathname`(parse.ts:62 注释明确为此留口),`..` / 重复 `/` /
 * `.` 都不在我们这里被规范化吃掉,handler 自己做边界检查。
 */
import * as fsp from 'node:fs/promises';
import * as nodePath from 'node:path';

import { writeText } from '@main/persist/lib/atomic';

import {
  ResourceNotFoundError,
  type InternalResource,
  type ParsedInternalUrl,
  type ProtocolHandler,
  type ResolveContext,
  type WriteContext,
} from '../types';

/** 1MB —— text resource 上限。超过抛错(InternalResource 仅承载文本)。 */
const MAX_RESOURCE_BYTES = 1 * 1024 * 1024;

export abstract class SandboxProtocolHandler implements ProtocolHandler {
  public abstract readonly scheme: string;
  public readonly immutable: boolean = false;

  /** 子类决定 sandbox 根目录(给定 ctx)。失败应抛 caller-facing 错误。 */
  protected abstract resolveBaseDir(ctx: ResolveContext): Promise<string>;

  public async resolve(
    url: ParsedInternalUrl,
    ctx: ResolveContext,
  ): Promise<InternalResource> {
    const { absPath, relPath } = await this.resolveTarget(url, ctx);

    const stat = await fsp.stat(absPath).catch((err: NodeJS.ErrnoException) => {
      if (err.code === 'ENOENT') {
        throw new ResourceNotFoundError(`${this.scheme}://${relPath} not found.`);
      }
      throw err;
    });
    if (stat.isDirectory()) {
      throw new Error(
        `${this.scheme}://${relPath} is a directory, not a file. Reading directories is not yet supported.`,
      );
    }
    if (stat.size > MAX_RESOURCE_BYTES) {
      throw new Error(
        `${this.scheme}://${relPath} exceeds ${MAX_RESOURCE_BYTES} byte limit ` +
          `(file is ${stat.size} bytes). Read smaller files via ${this.scheme}://.`,
      );
    }

    const buf = await fsp.readFile(absPath);
    if (containsNul(buf)) {
      throw new Error(
        `${this.scheme}://${relPath} appears to be binary; only text files are exposed via ${this.scheme}://.`,
      );
    }
    const content = buf.toString('utf-8');

    return {
      url: `${this.scheme}://${relPath}`,
      content,
      contentType: classifyContentType(relPath),
      size: stat.size,
      sourcePath: undefined,
      notes: undefined,
    };
  }

  public async write(
    url: ParsedInternalUrl,
    content: string,
    ctx: WriteContext,
  ): Promise<void> {
    const { absPath } = await this.resolveTarget(url, ctx);
    // writeText 内部已 ensureDir(dirname);atomic 写入 (tmp + rename)。
    await writeText(absPath, content);
  }

  /**
   * Renderer-facing 路径解析:把 URI 翻成绝对路径(可为 sandbox 根目录,
   * 不读 I/O)。空 path 允许 —— 等价于"根目录"。边界检查仍生效。
   */
  public async resolveToPath(
    url: ParsedInternalUrl,
    ctx: ResolveContext,
  ): Promise<string> {
    const { absPath } = await this.resolveTarget(url, ctx, { allowEmpty: true });
    return absPath;
  }

  /**
   * 解析 url → { absPath, relPath }。
   *
   * `allowEmpty`:`resolve` / `write` 走默认(false,空 path 抛错);
   * `resolveToPath` 传 true(允许指向 sandbox 根目录)。
   */
  private async resolveTarget(
    url: ParsedInternalUrl,
    ctx: ResolveContext,
    opts: { allowEmpty?: boolean } = {},
  ): Promise<{ absPath: string; relPath: string }> {
    const relPath = joinHostAndRawPath(url);
    if (relPath === '' && !opts.allowEmpty) {
      throw new Error(
        `${this.scheme}:// requires a path (e.g. \`${this.scheme}://notes.md\`). ` +
          `Empty paths and bare \`${this.scheme}://\` are not allowed.`,
      );
    }
    const baseDir = await this.resolveBaseDir(ctx);
    const baseAbs = nodePath.resolve(baseDir);
    const resolved = nodePath.resolve(baseAbs, relPath);
    if (resolved !== baseAbs && !resolved.startsWith(baseAbs + nodePath.sep)) {
      throw new Error(`Path "${relPath}" escapes the ${this.scheme}:// sandbox.`);
    }
    return { absPath: resolved, relPath };
  }
}

/**
 * 把 host + rawPathname 拼回相对路径,**走 rawPathname 不走规范化的 pathname**
 * —— `..` / 重复 `/` 都保留给 sandbox 边界检查兜底。
 *
 * 形态例:
 *   `local://foo.md`          → host="foo.md"  rawPath=""        → "foo.md"
 *   `local://uploads/foo.md`  → host="uploads" rawPath="/foo.md" → "uploads/foo.md"
 */
function joinHostAndRawPath(url: ParsedInternalUrl): string {
  const host = url.host.trim();
  const tail = url.rawPathname.replace(/^\/+/, '');
  if (host && tail) return `${host}/${tail}`;
  return host || tail;
}

/** 用前 8KB 检测 NUL byte —— 经典 binary 判别启发式。 */
function containsNul(buf: Buffer): boolean {
  const probeLen = Math.min(buf.length, 8 * 1024);
  for (let i = 0; i < probeLen; i++) {
    if (buf[i] === 0) return true;
  }
  return false;
}

function classifyContentType(
  relPath: string,
): 'text/markdown' | 'application/json' | 'text/plain' {
  const lower = relPath.toLowerCase();
  if (lower.endsWith('.md') || lower.endsWith('.markdown')) return 'text/markdown';
  if (lower.endsWith('.json')) return 'application/json';
  return 'text/plain';
}

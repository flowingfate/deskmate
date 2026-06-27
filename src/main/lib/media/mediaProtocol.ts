/**
 * `media://` —— renderer `<img>` / `<video>` 的「字节直供」前置层。
 *
 * 设计动机:渲染层展示 session sandbox 里的图片附件时,若走 `fsApi.readFile(uri,
 * 'base64')` 把字节读成 base64 dataURL 注入 DOM,会有三重代价 —— base64 膨胀
 * 33% 常驻 JS heap、N 次大字符串跨进程 IPC、`<img>` 解码位图无法被浏览器按视口
 * 淘汰。`media://` 注册成 privileged standard scheme,让 Chromium 自己 fetch +
 * lazy decode + 内存淘汰,主进程只 stream 字节,renderer 不再持有 base64。
 *
 * URL 文法:
 *   media://<authority>/<path…>?<query>
 *
 * - `<authority>` = 现有 internal-url scheme 名(`local` / `knowledge`),做 1:1
 *   对齐。路径解析**完全委托** {@link InternalUrlRouter.resolveToPath} —— 沙盒
 *   `..` 越界检查、agent/session 校验、`local://uploads/<name>` → 绝对路径全部
 *   复用,本模块不重复实现一遍。
 * - `<path…>` = 内层路径,renderer 每段 `encodeURIComponent`;本模块每段
 *   `decodeURIComponent` 还原后拼回 `<authority>://<path>` 交给 router。
 * - `<query>` = 解析上下文 + 传输提示:
 *     - `agent`   —— ULID,resolveToPath 的 agentId(local / knowledge 必填)
 *     - `session` —— ULID,resolveToPath 的 sessionId(local 必填;knowledge 不消费)
 *     - `mime`    —— URL-encoded,直接作为 Content-Type(必填;主进程不读字节嗅探,
 *                    renderer 持久化的 attachment 已知 mime,由它权威给出)
 *
 * profileId **不进 query** —— 主进程内部用 active profile,防跨 profile 越权;
 * 与 [internal-urls IPC](../../startup/ipc/internal-urls.ts) 同纪律。
 *
 * 扩展点(设计预留,本期未实现):
 * - `?download=1` → 回 `Content-Disposition: attachment`
 * - `Range` header → 视频分段(stream 已就位,补 206 分支即可)
 * - 新 authority → 往 {@link MEDIA_AUTHORITIES} 加一条
 */
import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import { Readable } from 'node:stream';

import { protocol } from 'electron';

import { log } from '@main/log';
import { Profiles } from '@main/persist';
import { InternalUrlRouter } from '@main/pi/internal-urls/router';
import type { ResolveContext } from '@main/pi/internal-urls/types';

const logger = log.child({ mod: 'MediaProtocol' });

/**
 * 一个可经 `media://` 字节直供的 authority。
 *
 * `authority` 对外(URL host),`innerScheme` 对内(委托给哪个 internal-url
 * handler)。当前两者同名,但拆成两个字段是契约留口 —— 将来若想用 `media://shot`
 * 这种别名映射到 `local://`,只改 `innerScheme` 不动 URL 文法。
 */
interface MediaAuthority {
  /** URL host 段,例如 `'local'`。 */
  readonly authority: string;
  /** 委托解析路径的 internal-url scheme,例如 `'local'`。 */
  readonly innerScheme: string;
  /** 除 `mime` 外必填的 query 参数(缺一个回 400)。`mime` 始终必填,单列在校验里。 */
  readonly requiredContext: readonly ('agent' | 'session')[];
  /** 从 query + active profileId 组装 router 需要的 {@link ResolveContext}。 */
  buildContext(searchParams: URLSearchParams, profileId: string): ResolveContext;
}

/**
 * authority 注册表。加新「可字节直供的内部资源域」往这里塞一条即可,
 * protocol handler 主体零改动。键即 URL host 段(authority 名)。
 */
const MEDIA_AUTHORITIES: Record<string, MediaAuthority> = {
  local: {
    authority: 'local',
    innerScheme: 'local',
    // local sandbox 是 session 级 —— agent + session 都必填。
    requiredContext: ['agent', 'session'],
    buildContext(q, profileId): ResolveContext {
      return {
        profileId,
        agentId: q.get('agent') ?? '',
        sessionId: q.get('session') ?? '',
      };
    },
  },
  knowledge: {
    authority: 'knowledge',
    innerScheme: 'knowledge',
    // knowledge 是 agent 级 —— 只需 agent;sessionId 塞空串(handler 不消费)。
    requiredContext: ['agent'],
    buildContext(q, profileId): ResolveContext {
      return {
        profileId,
        agentId: q.get('agent') ?? '',
        sessionId: '',
      };
    },
  },
};

/** 纯文本错误响应 —— 让 renderer `<img onError>` 走图标兜底。 */
function errorResponse(status: number, message: string): Response {
  return new Response(message, {
    status,
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}

/**
 * 把 `media://` URL 的 pathname 还原成内层 URI 的路径部分。
 *
 * `url.pathname` 保留 percent-encoding(WHATWG 不解码),renderer 每段都
 * `encodeURIComponent` 过,这里逐段 `decodeURIComponent` —— 不整体解码,避免
 * 文件名里被编码的 `/`(`%2F`)被误当目录分隔符。
 */
function decodeInnerPath(pathname: string): string {
  return pathname
    .replace(/^\/+/, '')
    .split('/')
    .map((seg) => decodeURIComponent(seg))
    .join('/');
}

/**
 * 解析一次 `media://` 请求 → 字节流 Response。失败回结构化错误响应。
 *
 * 入参是 raw URL 字符串(非 `Request`)—— 既匹配 `protocol.handle` 回调的
 * `request.url`,又让单测无需构造受 scheme 限制的 `Request`。
 */
export async function resolveMediaRequest(rawUrl: string): Promise<Response> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return errorResponse(400, `Malformed media URL: ${rawUrl}`);
  }

  const authority = Object.prototype.hasOwnProperty.call(MEDIA_AUTHORITIES, parsed.hostname)
    ? MEDIA_AUTHORITIES[parsed.hostname]
    : undefined;
  if (!authority) {
    return errorResponse(404, `Unknown media authority: "${parsed.hostname}"`);
  }

  // 校验必填 query:authority 声明的 context 段 + 永远必填的 mime。
  for (const key of authority.requiredContext) {
    if (!parsed.searchParams.get(key)) {
      return errorResponse(400, `media://${authority.authority} requires "${key}" query param`);
    }
  }
  const mime = parsed.searchParams.get('mime');
  if (!mime) {
    return errorResponse(400, `media://${authority.authority} requires "mime" query param`);
  }

  const innerPath = decodeInnerPath(parsed.pathname);
  if (innerPath === '') {
    return errorResponse(400, `media://${authority.authority} requires a path`);
  }
  const innerUri = `${authority.innerScheme}://${innerPath}`;

  let absPath: string;
  try {
    const profile = await Profiles.get().active();
    const ctx = authority.buildContext(parsed.searchParams, profile.id);
    // resolveToPath 复用沙盒边界检查 + agent/session 校验;越界 / 缺失会抛。
    absPath = await InternalUrlRouter.get().resolveToPath(innerUri, ctx);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.debug({ msg: 'media resolve failed', uri: innerUri, err: message });
    return errorResponse(404, message);
  }

  try {
    const stat = await fsp.stat(absPath);
    if (!stat.isFile()) {
      return errorResponse(404, `Not a file: ${innerUri}`);
    }
    const nodeStream = fs.createReadStream(absPath);
    // Node Readable → web ReadableStream;主进程不把整文件读进内存。
    const body = Readable.toWeb(nodeStream) as unknown as ReadableStream<Uint8Array>;
    return new Response(body, {
      status: 200,
      headers: {
        'Content-Type': mime,
        'Content-Length': String(stat.size),
        // session 文件可能被 LLM 覆写,留 revalidate 余地;视口内仍享浏览器解码缓存。
        'Cache-Control': 'no-cache',
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.debug({ msg: 'media stream failed', path: absPath, err: message });
    return errorResponse(404, message);
  }
}

/**
 * 注册 `media://` protocol handler。**MUST 在 app ready 后调用**(`protocol.handle`
 * 的前置条件)。scheme 本身的 privileged 声明在 `main.ts` 的
 * `registerSchemesAsPrivileged`(MUST 在 app ready 前)。
 */
export function registerMediaProtocol(): void {
  protocol.handle('media', (request) => resolveMediaRequest(request.url));
  logger.info({ msg: 'media protocol registered', authorities: Object.keys(MEDIA_AUTHORITIES) });
}

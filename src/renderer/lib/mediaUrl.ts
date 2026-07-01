/**
 * Renderer 端 `media://` URL 构建器。
 *
 * 渲染层展示 session sandbox / knowledge 里的图片(`local://uploads/<name>` /
 * `knowledge://...`)时,**不再**走 `fsApi.readFile(uri,'base64')` 把字节读成
 * dataURL 注入 DOM,而是构造一个 `media://` URL 交给 `<img src>` —— Chromium 自己
 * fetch + lazy decode + 内存淘汰,renderer 不持有 base64,无 IPC 往返。
 *
 * URL 形态与 [main/lib/media/mediaProtocol.ts](../../main/lib/media/mediaProtocol.ts)
 * 的 handler 契约一一对应:
 *   media://<authority>/<path…>?agent=&session=&mime=
 *
 * - authority = 内层 internal-url scheme 名(`local` / `knowledge`)。
 * - path 每段 `encodeURIComponent`(handler 侧逐段 `decodeURIComponent`)。
 * - agent / session / mime 经 `URLSearchParams` 编码;profileId 不进 URL
 *   (主进程用 active profile)。
 *
 * 必填上下文缺失(无 agent、local 缺 session)→ 返回 `null`,调用方据此走
 * 图标兜底,不构造半成品 URL。
 */

/** authority 是否需要 session(与 main 的 `MEDIA_AUTHORITIES.requiredContext` 对齐)。 */
const MEDIA_AUTHORITY_REQUIRES_SESSION: Record<string, boolean> = {
  local: true,
  knowledge: false,
};

export interface MediaUrlContext {
  /** 当前 agentId(== currentSession.agentId)。 */
  agentId: string | null;
  /** 当前 chatSessionId;`local://` 必需,`knowledge://` 不消费。 */
  sessionId: string | null;
}

const URI_RE = /^([a-z][a-z0-9+.-]*):\/\/(.*)$/i;

/**
 * 把内部资源 URI(`local://...` / `knowledge://...`)+ mime + ctx 构造成
 * `media://` URL。无法构造(非 servable scheme / 必填 ctx 缺失 / 空路径)→ `null`。
 */
export function toMediaUrl(uri: string, mime: string, ctx: MediaUrlContext): string | null {
  const match = URI_RE.exec(uri);
  if (!match) return null;

  const authority = match[1].toLowerCase();
  if (!Object.prototype.hasOwnProperty.call(MEDIA_AUTHORITY_REQUIRES_SESSION, authority)) {
    return null;
  }
  const requiresSession = MEDIA_AUTHORITY_REQUIRES_SESSION[authority];

  if (!ctx.agentId) return null;
  if (requiresSession && !ctx.sessionId) return null;

  const path = match[2]
    .split('/')
    .filter((seg) => seg.length > 0)
    .map((seg) => encodeURIComponent(seg))
    .join('/');
  if (path === '') return null;

  const params = new URLSearchParams();
  params.set('agent', ctx.agentId);
  if (requiresSession && ctx.sessionId) params.set('session', ctx.sessionId);
  params.set('mime', mime);

  return `media://${authority}/${path}?${params.toString()}`;
}

/** 图片扩展名 → mime。media:// 必须带 mime,而文件引用(uri/路径)只有扩展名时由此推断。 */
const IMAGE_MIME_BY_EXT: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  svg: 'image/svg+xml',
  ico: 'image/x-icon',
  tiff: 'image/tiff',
  tif: 'image/tiff',
  avif: 'image/avif',
};

/** 从路径 / URI 的扩展名推断图片 mime;非图片扩展名 → `null`。 */
export function imageMimeFromPath(pathOrUri: string): string | null {
  const noQuery = pathOrUri.split('?')[0];
  const ext = noQuery.split('.').pop()?.toLowerCase() ?? '';
  return Object.prototype.hasOwnProperty.call(IMAGE_MIME_BY_EXT, ext)
    ? IMAGE_MIME_BY_EXT[ext]
    : null;
}

/**
 * 把「文件引用」(internal uri / 绝对路径 / 远程 url)规范成一个 `<img src>` 能直接
 * 加载的字符串 —— 渲染层展示图片的统一入口:
 *   - `local://` / `knowledge://` → `media://`(同步,无预解析 IPC,保 sandbox 抽象)
 *   - 已是 `file://` / `http(s)://` / `media://` / `data:` → 原样返回
 *   - 裸绝对路径(`/...` / 盘符)→ 包成 `file://`
 *
 * media:// 构造失败(internal uri 但 ctx 缺失 / 非图片扩展名)→ 回退当原值处理
 * (例如 `local://` 缺 session 时返回原 uri,`<img onError>` 兜底)。
 */
export function toImageDisplaySrc(pathOrUri: string, ctx: MediaUrlContext): string {
  const schemeMatch = URI_RE.exec(pathOrUri);
  if (schemeMatch) {
    const scheme = schemeMatch[1].toLowerCase();
    if (Object.prototype.hasOwnProperty.call(MEDIA_AUTHORITY_REQUIRES_SESSION, scheme)) {
      const mime = imageMimeFromPath(pathOrUri);
      const media = mime ? toMediaUrl(pathOrUri, mime, ctx) : null;
      return media ?? pathOrUri;
    }
    // file:// / http(s):// / media:// / 其它已可加载的 scheme → 原样。
    return pathOrUri;
  }
  if (pathOrUri.startsWith('data:')) return pathOrUri;
  // 裸绝对路径 → file://(media:// 只服务 sandbox uri,任意 fs 路径仍走 file://)。
  return `file://${pathOrUri}`;
}

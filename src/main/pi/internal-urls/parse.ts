/**
 * Parse `scheme://host/path?query` 形态的 internal URL。
 *
 * 为什么不直接用 `new URL(input)`:
 * 1. 标准 URL parser 把 host 强制 lowercase(WHATWG spec),会把 `skill://Hello`
 *    打回 `skill://hello` —— 我们的 skill name / agent id 大小写敏感,必须保留。
 * 2. 我们要 fail-fast:不是合法 `scheme://...` 形态直接抛错,而不是让 URL parser
 *    给一个"看起来能用"的 fallback。
 */
import type { ParsedInternalUrl } from './types';

const SCHEME_RE = /^([a-z][a-z0-9+.-]*):\/\//i;

/**
 * 尝试解析一个 internal URL。失败抛 Error(消息适合直接 surface 给 LLM)。
 *
 * 必须以 `scheme://` 开头才认;否则视为"不是 internal URL",call site 应在
 * 路由前用 {@link isInternalUrlInput} 先判。
 */
export function parseInternalUrl(input: string): ParsedInternalUrl {
  const schemeMatch = SCHEME_RE.exec(input);
  if (!schemeMatch) {
    throw new Error(`Not a valid internal URL: "${input}" (expected scheme://...)`);
  }
  const scheme = schemeMatch[1].toLowerCase();
  const afterScheme = input.slice(schemeMatch[0].length);

  // 拆出 query 和 fragment。我们只关心 query;fragment 当前 handler 不消费,
  // 但解析掉避免污染 host/path。
  let rest = afterScheme;
  let queryPart = '';
  const queryIdx = rest.indexOf('?');
  if (queryIdx >= 0) {
    queryPart = rest.slice(queryIdx + 1);
    rest = rest.slice(0, queryIdx);
  }
  const fragIdx = queryPart.indexOf('#');
  if (fragIdx >= 0) queryPart = queryPart.slice(0, fragIdx);
  const restFragIdx = rest.indexOf('#');
  if (restFragIdx >= 0) rest = rest.slice(0, restFragIdx);

  // host = scheme:// 后到第一个 '/'(或字符串结尾)。
  let host: string;
  let pathname: string;
  const slashIdx = rest.indexOf('/');
  if (slashIdx < 0) {
    host = rest;
    pathname = '';
  } else {
    host = rest.slice(0, slashIdx);
    pathname = rest.slice(slashIdx);
  }

  return {
    href: input,
    scheme,
    host,
    pathname,
    // 当前 parser 不做 URL 规范化,rawPathname === pathname。字段单独存在
    // 是契约层留口 —— handler 做 path traversal 检查时 MUST 走 rawPathname,
    // 不依赖 pathname 是否被未来的规范化逻辑改写。见 types.ts 字段注释。
    rawPathname: pathname,
    searchParams: new URLSearchParams(queryPart),
  };
}

/** 仅判断"看起来像 internal URL"(scheme:// 形态)—— 不验证 scheme 是否注册。 */
export function isInternalUrlInput(input: string): boolean {
  return SCHEME_RE.test(input);
}

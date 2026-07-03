/**
 * 记录"进入 /settings 之前停留的路由"(pathA),供 Settings 侧栏的
 * "Go back to agent" 精确回跳。
 *
 * ## 为什么用 loader,而不是组件 effect
 *
 * data router 没有 referrer / previous-location 原语——`loader` 的 `request` 只是
 * 目标 URL。但 data router 有一个可利用的时序保证(已核对 react-router 7.18 源码
 * `startNavigation`):**loader 在 `history.push` 提交新 URL 之前运行**。因此 `/settings`
 * 路由的 loader 执行时,`window.location` 仍是我们正要离开的那个路由(pathA)。
 *
 * 挂在 `/settings` 父路由上,天然只在"进入 settings"时触发,无需手搓 prev 追踪:
 *   - 子页互切(tools→mcp→provider):父 `/settings` match 不变、params 不变、
 *     仅 pathname 变 → 默认 shouldRevalidate 为 false → **父 loader 不重跑**,pathA 稳定。
 *   - 唯一会重跑父 loader 的是 search 变化(如 `?selected=foo`);此时 `window.location`
 *     已是 settings 路径,下面的 `startsWith('/settings')` 守卫直接跳过,不覆盖 pathA。
 *   - 深链 / 刷新(settings 即首屏):loader 在 hydration 时跑,`window.location` 也是
 *     settings 路径,同一守卫跳过,entry 保持 null,由消费方降级到
 *     `resolveSettingsBackFallbackPath()`。
 *
 * 只存路径字符串。SPA 生命周期内模块级持有即可,消费方("Go back")点击瞬间读一次。
 */

import type { LoaderFunctionArgs } from 'react-router-dom';

let entryPath: string | null = null;

/**
 * `/settings` 父路由 loader:进入 settings 前捕获来源路径。
 *
 * 借助"loader 先于 URL 提交"的时序,读 `location` 拿到即将离开的 pathA。
 * 守卫掉 settings→settings 的 revalidation 与首屏 hydration。返回 null(loader 必须
 * 有返回值;此路由无数据需求)。
 */
export function settingsEntryLoader(_args: LoaderFunctionArgs): null {
  const current = `${location.pathname}${location.search}${location.hash}`;
  if (!location.pathname.startsWith('/settings')) {
    entryPath = current;
  }
  return null;
}

/** 读取已记录的来源路径;未记录(深链 / 刷新)时返回 null。 */
export function peekSettingsEntry(): string | null {
  return entryPath;
}

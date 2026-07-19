/**
 * 记录全局和 Agent 设置页的入口路由，供各自的返回按钮精确回跳。
 *
 * ## 为什么用 loader,而不是组件 effect
 *
 * data router 没有 referrer / previous-location 原语——`loader` 的 `request` 只是
 * 目标 URL。但 data router 有一个可利用的时序保证(已核对 react-router 7.18 源码
 * `startNavigation`):**loader 在 `history.push` 提交新 URL 之前运行**。因此 loader
 * 执行时,`window.location` 仍是我们正要离开的那个路由(pathA)。
 *
 * 两类设置入口都只存路径字符串，SPA 生命周期内模块级持有即可：
 * - `/settings`：同一父路由内子页切换不会重跑 loader；search revalidation 时由
 *   `/settings` 前缀守卫保持原始入口。
 * - `/agent/:agentId/settings/*`：同一 Agent 的 tab 切换即使导致 `*` 参数重验，当前
 *   路径中的 Agent ID 仍与目标一致，守卫不会覆盖入口；切到另一个 Agent 的设置时才
 *   把当前设置页记录为新的入口。
 *
 * 深链 / 刷新时当前路由已是设置页，入口保持 null，由消费者走其既有 fallback。
 */

import type { LoaderFunctionArgs } from 'react-router-dom';

const AGENT_SETTINGS_PATH = /^\/agent\/([^/]+)\/settings(?:\/|$)/;

let entryPath: string | null = null;
let agentSettingsEntryPath: string | null = null;

function currentPath(): string {
  return `${location.pathname}${location.search}${location.hash}`;
}

/** `/settings` 父路由 loader：进入全局设置前捕获来源路径。 */
export function settingsEntryLoader(_args: LoaderFunctionArgs): null {
  if (!location.pathname.startsWith('/settings')) {
    entryPath = currentPath();
  }
  return null;
}

/** 读取全局 Settings 的入口；未记录（深链 / 刷新）时返回 null。 */
export function peekSettingsEntry(): string | null {
  return entryPath;
}

/** `/agent/:agentId/settings/*` loader：进入某个 Agent 设置前捕获来源路径。 */
export function agentSettingsEntryLoader({ params }: LoaderFunctionArgs): null {
  const targetAgentId = params.agentId;
  if (!targetAgentId) return null;

  const currentAgentId = AGENT_SETTINGS_PATH.exec(location.pathname)?.[1];
  if (currentAgentId !== targetAgentId) {
    agentSettingsEntryPath = currentPath();
  }
  return null;
}

/** 读取 Agent Settings 的入口；未记录（深链 / 刷新）时返回 null。 */
export function peekAgentSettingsEntry(): string | null {
  return agentSettingsEntryPath;
}

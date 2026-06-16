// src/renderer/components/chat/tool/renderers/app/index.tsx
// `app` LocalTool 的顶层 ToolRenderer。
//
// 全局 registry 只看到本目录 export 的**单个** renderer。子命令(subagent /
// mcp / skill / web / schedule / ...)的特化渲染是 app 内部实现细节 ——
// 各 slot 函数 / component 内调 `pickSubRenderer` 拿到子命令 renderer,
// 命中即下放;不命中走 app 自身的兜底(chip 显示 `app:<sub>`,input 直接
// 展示 cmd 字符串,output 走朴素 result 文本)。
//
// 新增子命令域(如 `mcp` / `skill`):
//   1. `app/<sub>/` 创建子目录,export 一个 `ToolRenderer`-shape 对象 +
//      路由函数 `resolve<Sub>Renderer(tokens) → ToolRenderer | null`。
//   2. 在本文件 `pickSubRenderer` 里加一行委派。
// 全局 registry 不动。
//
// 关于 block slot 的 app-level 兜底:
// app 选择**永远接管** InputBlock / OutputExecutingBlock / OutputSuccessBlock,
// 这意味着 app 顶层要扛"任何 cmdline 都给出像样渲染"的合约,即便子命令
// 路由不命中 —— 因为一旦 ToolDetailView 看到 `renderer.InputBlock` 存在,
// 就**不会**再回到 `inputArgsText` / 默认 JSON dump。让 ToolDetailView
// 学会"组件返回 null → fallback"会把 React 元素的 truthiness 提升到 view
// 优先级判定里,API 更脏;在 app 自己内部复刻细粒度兜底链路是更克制的代价。

import React from 'react';
import type { ToolCall } from '@shared/types/message';
import type {
  ToolRenderer,
  ToolSlotProps,
  ToolOutputSuccessSlotProps,
} from '../../types';
import { extractAppCmdline, firstNonFlagTokens } from './cmdline';
import { resolveSubagentRenderer } from './subagent';

/**
 * 取 `app` cmdline 的前两个非 flag token,按子命令域分派。**纯函数**,
 * 命中失败返回 null。
 */
function pickSubRenderer(toolCall: ToolCall): ToolRenderer | null {
  const tokens = firstNonFlagTokens(extractAppCmdline(toolCall.args), 2);
  return resolveSubagentRenderer(tokens);
  // 未来:`?? resolveMcpRenderer(tokens) ?? resolveSkillRenderer(tokens)` ...
}

const FALLBACK_BLOCK_CLS =
  'm-0 px-2.5 py-2 rounded-[4px] bg-gray-50 border-1 border-black/7 ' +
  'font-mono text-[11.5px] leading-[1.55] text-gray-800 ' +
  'whitespace-pre-wrap break-words max-h-[220px] overflow-auto custom-scrollbar';

const chipLabel = (toolCall: ToolCall): string => {
  const sub = pickSubRenderer(toolCall);
  if (sub?.chipLabel) return sub.chipLabel(toolCall);
  // 兜底:展示子命令的第一个 token,如 `app:mcp` / `app:skill` / `app:web`。
  const tokens = firstNonFlagTokens(extractAppCmdline(toolCall.args), 1);
  return tokens[0] ? `app:${tokens[0]}` : 'app';
};

const InputBlock: React.FC<ToolSlotProps> = (props) => {
  const sub = pickSubRenderer(props.toolCall);
  if (sub?.InputBlock) return <sub.InputBlock {...props} />;
  // app 兜底:展示 cmd 字符串本身,而非 `{ "cmd": "..." }` JSON dump。
  const cmd = extractAppCmdline(props.toolCall.args);
  return <pre className={FALLBACK_BLOCK_CLS}>{cmd || '(no command)'}</pre>;
};

const OutputExecutingBlock: React.FC<ToolSlotProps> = (props) => {
  const sub = pickSubRenderer(props.toolCall);
  if (sub?.OutputExecutingBlock) return <sub.OutputExecutingBlock {...props} />;
  // 子命令没有特化 executing 视图 —— 给朴素 "Running…",与 ToolDetailView
  // 默认占位等价。
  return (
    <div className="flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] text-gray-400 italic">
      Running…
    </div>
  );
};

const OutputSuccessBlock: React.FC<ToolOutputSuccessSlotProps> = (props) => {
  const sub = pickSubRenderer(props.toolCall);
  if (sub?.OutputSuccessBlock) return <sub.OutputSuccessBlock {...props} />;
  // 子命令没有特化 success 视图 —— 直接展示 result 文本。
  return <pre className={FALLBACK_BLOCK_CLS}>{props.result}</pre>;
};

/**
 * App 顶层 renderer。注册到全局 registry 的就是这个对象。
 */
export const appRenderer: ToolRenderer = {
  chipLabel,
  InputBlock,
  OutputExecutingBlock,
  OutputSuccessBlock,
};

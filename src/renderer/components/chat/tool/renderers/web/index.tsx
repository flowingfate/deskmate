// src/renderer/components/chat/tool/renderers/web/index.tsx
// `web` LocalTool 的顶层 ToolRenderer。
//
// `web` 与 `app` 同级(顶层工具),args 形态同为 `{ cmd: string }`。默认 chip
// 只显示 toolName `web`,无法区分 search / research / fetch / download。本
// renderer 覆盖两个细粒度点位:
//   chipLabel     : 取 cmdline 第一个非 flag token,渲染成 `web:<sub>`
//                   (如 `web:search` / `web:fetch`)。
//   inputArgsText : 展示 cmd 字符串本身,而非默认的 `{ "cmd": "..." }` JSON
//                   dump —— 与 app tool 对齐。web 无子 renderer 需路由,故用
//                   细粒度 inputArgsText(比 app 的粗粒度 InputBlock 更克制),
//                   渲染进默认 <pre> 后视觉与 app 兜底块一致。
// output 点位不接管,走默认渲染。
//
// cmdline 解析复用 app 目录的 helper —— `extractAppCmdline` / `firstNonFlagTokens`
// 只读 `args.cmd` + 空白切分,与工具名无关,是通用逻辑。

import type { ToolCall } from '@shared/types/message';
import type { ToolRenderer } from '../../types';
import { extractAppCmdline, firstNonFlagTokens } from '../app/cmdline';

const chipLabel = (toolCall: ToolCall): string => {
  const tokens = firstNonFlagTokens(extractAppCmdline(toolCall.args), 1);
  return tokens[0] ? `web:${tokens[0]}` : 'web';
};

// 空串 → 默认渲染回落到 `(no arguments)` 占位。
const inputArgsText = (toolCall: ToolCall): string => extractAppCmdline(toolCall.args);

/**
 * Web 顶层 renderer。注册到全局 registry 的就是这个对象。
 */
export const webRenderer: ToolRenderer = {
  chipLabel,
  inputArgsText,
};

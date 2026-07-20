// src/renderer/components/chat/tool/ToolDetailView.tsx
// 工具调用 detail 区域 —— input / output 两段式骨架。
//
// 这是**唯一的** detail 容器;ToolCallsSection 永远渲染本组件,无论工具是否
// 注册了 renderer。工具的覆盖通过 props.renderer 注入,本组件按点位决定渲染
// 优先级(粗 > 细 > 默认)。
//
// 优先级表:
//   input  : InputBlock(粗) > inputArgsText(细) > JSON.stringify(args) (默认)
//   output : executing → OutputExecutingBlock(粗) > 默认 "Running…" 占位
//            success   → OutputSuccessBlock(粗) > outputResultText(细) > result text(默认)
//            interrupted / failed 一律走默认渲染,不接受覆盖。
//
// 设计:caption + mono pre。pre 块用纯灰底(无 ring),与白底外卡形成层级。

import React from 'react';
import { ArrowDownRight, ArrowUpRight, Loader2 } from 'lucide-react';
import type { ToolCall } from '@shared/persist/types'
import type { ToolCallExecutionStatus, ToolRenderer } from './types';

export interface ToolDetailViewProps {
  agentId: string;
  sessionId: string;
  toolCall: ToolCall;
  executionStatus: ToolCallExecutionStatus;
  /** 命中的 renderer(可空),非空时按点位接管对应 slot。 */
  renderer: ToolRenderer | null;
  /**
   * 默认 false:input / output 默认 pre 限高 220px + 内滚(单 detail 展开,避免占满聊天视口)。
   * true:不限高,内容自然撑开 — view-all 模式由外层 ul 统一滚动,避免嵌套滚动条。
   * 仅影响 ToolDetailView 内**默认** pre;renderer 自己提供的 *Block 覆盖不受影响。
   */
  verticallyUnbounded?: boolean;
}

const stringifyArgs = (args: Record<string, unknown>): string => {
  try {
    return JSON.stringify(args, null, 2);
  } catch {
    return String(args);
  }
};

const CAPTION_CLS =
  'flex items-center gap-1 text-[10px] font-medium tracking-[0.09em] uppercase text-gray-400';

const BODY_BASE_CLS =
  'm-0 px-2.5 py-2 rounded-[4px] bg-gray-50 border-black/7 border-1 ' +
  'font-mono text-[11.5px] leading-[1.55] text-gray-800 ' +
  'whitespace-pre-wrap break-words';
const BODY_BOUNDED_CLS = 'max-h-[220px] overflow-auto custom-scrollbar';
const bodyCls = (unbounded: boolean) =>
  unbounded ? BODY_BASE_CLS : `${BODY_BASE_CLS} ${BODY_BOUNDED_CLS}`;

const EMPTY_CLS =
  'flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] text-gray-400 italic';

/** Input slot 渲染。粗 → 整个 <pre> 块由 override 接管;细 → 替换 argsText。 */
const InputSlot: React.FC<{
  agentId: string;
  sessionId: string;
  toolCall: ToolCall;
  executionStatus: ToolCallExecutionStatus;
  renderer: ToolRenderer | null;
  verticallyUnbounded: boolean;
}> = ({ agentId, sessionId, toolCall, executionStatus, renderer, verticallyUnbounded }) => {
  if (renderer?.InputBlock) {
    const Block = renderer.InputBlock;
    return <Block agentId={agentId} sessionId={sessionId} toolCall={toolCall} executionStatus={executionStatus} />;
  }

  let argsText: string;
  if (renderer?.inputArgsText) {
    argsText = renderer.inputArgsText(toolCall);
    if (!argsText) argsText = '(no arguments)';
  } else {
    const hasArgs = toolCall.args && Object.keys(toolCall.args).length > 0;
    argsText = hasArgs ? stringifyArgs(toolCall.args!) : '(no arguments)';
  }
  return <pre className={bodyCls(verticallyUnbounded)}>{argsText}</pre>;
};

/** Output slot 渲染。executing / success 路径接受 renderer 覆盖;interrupted / failed 走默认。 */
const OutputSlot: React.FC<{
  agentId: string;
  sessionId: string;
  toolCall: ToolCall;
  executionStatus: ToolCallExecutionStatus;
  renderer: ToolRenderer | null;
  verticallyUnbounded: boolean;
}> = ({ agentId, sessionId, toolCall, executionStatus, renderer, verticallyUnbounded }) => {
  const result = toolCall.response?.result;
  const failed = toolCall.response?.status === 'fail';

  if (executionStatus === 'executing' && !result) {
    if (renderer?.OutputExecutingBlock) {
      const Block = renderer.OutputExecutingBlock;
      return <Block agentId={agentId} sessionId={sessionId} toolCall={toolCall} executionStatus={executionStatus} />;
    }
    return (
      <div className={EMPTY_CLS}>
        <Loader2 size={11} className="animate-spin" aria-hidden="true" />
        <span>Running…</span>
      </div>
    );
  }

  if (!result) {
    return (
      <div className={EMPTY_CLS}>
        {executionStatus === 'interrupted' ? '(interrupted, no output)' : '(no output)'}
      </div>
    );
  }

  if (failed) {
    return (
      <pre className={`${bodyCls(verticallyUnbounded)} bg-rose-50/70 text-rose-700`}>{result}</pre>
    );
  }

  // success path —— 允许 renderer 覆盖
  if (renderer?.OutputSuccessBlock) {
    const Block = renderer.OutputSuccessBlock;
    return <Block agentId={agentId} sessionId={sessionId} toolCall={toolCall} executionStatus={executionStatus} result={result} />;
  }
  if (renderer?.outputResultText) {
    const text = renderer.outputResultText(toolCall);
    return <pre className={bodyCls(verticallyUnbounded)}>{text || '(empty)'}</pre>;
  }
  return <pre className={bodyCls(verticallyUnbounded)}>{result}</pre>;
};

export const ToolDetailView: React.FC<ToolDetailViewProps> = ({
  agentId,
  sessionId,
  toolCall,
  executionStatus,
  renderer,
  verticallyUnbounded = false,
}) => {
  const failed = toolCall.response?.status === 'fail';
  return (
    <div className="flex flex-col gap-2">
      <section className="flex flex-col">
        <header className={CAPTION_CLS}>
          <ArrowDownRight size={10} aria-hidden="true" strokeWidth={2} className="text-neutral-600/70" />
          <span>input</span>
        </header>
        <InputSlot
          agentId={agentId}
          sessionId={sessionId}
          toolCall={toolCall}
          executionStatus={executionStatus}
          renderer={renderer}
          verticallyUnbounded={verticallyUnbounded}
        />
      </section>

      <section className="flex flex-col">
        <header className={CAPTION_CLS}>
          <ArrowUpRight
            size={10}
            aria-hidden="true"
            strokeWidth={2}
            className={failed ? 'text-rose-500/80' : 'text-emerald-600/70'}
          />
          <span>output</span>
        </header>
        <OutputSlot
          agentId={agentId}
          sessionId={sessionId}
          toolCall={toolCall}
          executionStatus={executionStatus}
          renderer={renderer}
          verticallyUnbounded={verticallyUnbounded}
        />
      </section>
    </div>
  );
};

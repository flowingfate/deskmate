// src/renderer/components/chat/ToolCallsSection.tsx
// Tool Calls Section component, renders the entire tool calls area and computes overall execution status

import React, { useState, useRef, useCallback } from 'react';
import { Loader2, CheckCircle, AlertCircle } from 'lucide-react';
import type { ToolCall } from '@shared/types/message';
import { ToolCallItem } from './ToolCallItem';
import { getToolCallsSummaryText } from './toolCallDisplayConfig';
import { ToolCallExecutionStatus } from '../toolCallViews/types';
import { ChatStatus } from '@renderer/lib/chat/agentSessionCacheManager';

/**
 * Tool Calls overall execution status
 *  - executing  : 全部还在执行(没任何 response)
 *  - partial    : 部分有 response、部分还在执行
 *  - completed  : 全部都有 response
 *  - interrupted: 没收完 response,但 chat 已 idle 或后续有新消息(被打断)
 */
export type ToolCallsSectionStatus = 'executing' | 'partial' | 'completed' | 'interrupted';

export interface ToolCallsSectionProps {
  /** Tool Calls 数组 (Domain),包含 `response`(若已完成)。 */
  toolCalls: ToolCall[];
  /** Current chat session status, used to distinguish actively executing vs. historically interrupted */
  chatStatus?: ChatStatus;
  /** Source assistant message index for this group of tool calls */
  sourceMessageIndex?: number;
  /** Section key (used for keying child items) */
  sectionKey: string;
  /** 后续是否已经有新一轮 user/assistant 文本消息(由父组件计算)。 */
  hasSubsequentConversationMessage: boolean;
}

const computeToolCallsSectionStatus = (
  toolCalls: ToolCall[],
  chatStatus: ChatStatus | undefined,
  hasSubsequentConversationMessage: boolean,
): ToolCallsSectionStatus => {
  const validToolCalls = toolCalls.filter((tc) => tc.id.trim() !== '' && tc.name.trim() !== '');
  if (validToolCalls.length === 0) return 'completed';

  const completedCount = validToolCalls.filter((tc) => Boolean(tc.response)).length;

  if (completedCount === validToolCalls.length) return 'completed';
  if (hasSubsequentConversationMessage) return 'interrupted';
  if (!chatStatus || chatStatus === 'idle') return 'interrupted';
  if (completedCount > 0) return 'partial';
  return 'executing';
};

/**
 * Render the status icon
 */
const StatusIcon: React.FC<{ status: ToolCallsSectionStatus }> = ({ status }) => {
  switch (status) {
    case 'executing':
      return (
        <span className="tool-calls-section-icon executing">
          <Loader2 size={16} className="animate-spin" style={{ display: 'block' }} />
        </span>
      );
    case 'partial':
      return (
        <span className="tool-calls-section-icon partial">
          <Loader2 size={16} className="animate-spin" style={{ display: 'block' }} />
        </span>
      );
    case 'completed':
      return (
        <span className="tool-calls-section-icon completed">
          <CheckCircle size={16} style={{ display: 'block' }} />
        </span>
      );
    case 'interrupted':
      return (
        <span className="tool-calls-section-icon interrupted">
          <AlertCircle size={16} style={{ display: 'block' }} />
        </span>
      );
  }
};

const ArrowIcon: React.FC<{ isExpanded: boolean }> = ({ isExpanded }) => (
  <svg
    className={`tool-calls-arrow ${isExpanded ? 'expanded' : ''}`}
    width="14"
    height="14"
    viewBox="0 0 14 14"
    aria-hidden="true"
  >
    <path
      d="M3.5 5L7 8.5L10.5 5"
      stroke="currentColor"
      strokeWidth="1.6"
      fill="none"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

export const ToolCallsSection: React.FC<ToolCallsSectionProps> = ({
  toolCalls,
  chatStatus,
  sectionKey,
  hasSubsequentConversationMessage,
}) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const headerRef = useRef<HTMLDivElement>(null);

  const validToolCalls = toolCalls.filter((tc) => tc.name.trim() !== '');
  if (validToolCalls.length === 0) return null;

  const sectionStatus = computeToolCallsSectionStatus(
    validToolCalls,
    chatStatus,
    hasSubsequentConversationMessage,
  );
  const summaryText = getToolCallsSummaryText(validToolCalls.length);

  /**
   * Handle expand/collapse click —— 保持点击位置稳定:展开向下,折叠向上。
   */
  const handleToggle = useCallback(() => {
    if (!headerRef.current) {
      setIsExpanded((prev) => !prev);
      return;
    }
    const headerRect = headerRef.current.getBoundingClientRect();
    const headerTopBeforeToggle = headerRect.top;
    setIsExpanded((prev) => !prev);
    requestAnimationFrame(() => {
      if (!headerRef.current) return;
      const newHeaderRect = headerRef.current.getBoundingClientRect();
      const headerTopAfterToggle = newHeaderRect.top;
      const diff = headerTopAfterToggle - headerTopBeforeToggle;
      if (Math.abs(diff) > 1) {
        const scrollContainer = headerRef.current.closest('.chat-container-reverse');
        if (scrollContainer) scrollContainer.scrollTop += diff;
      }
    });
  }, []);

  return (
    <div className="tool-calls-section-new">
      {/* Header row */}
      <div ref={headerRef} className="tool-calls-row" onClick={handleToggle}>
        <div className="tool-calls-icon-col">
          <StatusIcon status={sectionStatus} />
          {isExpanded && <div className="tool-calls-dashed-line" />}
        </div>
        <div className="tool-calls-text-col">
          <span className="tool-calls-summary-text">{summaryText}</span>
          <ArrowIcon isExpanded={isExpanded} />
        </div>
      </div>

      {/* Expanded Tool Call list */}
      {isExpanded &&
        validToolCalls.map((toolCall, index) => {
          const executionStatus: ToolCallExecutionStatus = toolCall.response
            ? 'completed'
            : sectionStatus === 'interrupted'
              ? 'interrupted'
              : 'executing';

          const itemKey = `${sectionKey}_${toolCall.id || index}`;
          return (
            <ToolCallItem
              key={itemKey}
              toolCall={toolCall}
              executionStatus={executionStatus}
              itemKey={itemKey}
              isLast={index === validToolCalls.length - 1}
            />
          );
        })}
    </div>
  );
};

export default ToolCallsSection;

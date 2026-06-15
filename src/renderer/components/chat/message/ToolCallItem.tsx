// src/renderer/components/chat/ToolCallItem.tsx
// Standalone Tool Call rendering component with expand/collapse support and custom views

import React, { useState, useRef, useCallback } from 'react';
import { Loader2, ChevronRight, AlertCircle } from 'lucide-react';
import type { ToolCall } from '@shared/types/message';
import { getToolCallDisplayText, getToolCallIcon } from './toolCallDisplayConfig';
import { getToolCallView } from '../toolCallViews';
import { ToolCallExecutionStatus } from '../toolCallViews/types';
import { adjustScrollForExpandedContent } from './toolCallExpansionScroll';

export interface ToolCallItemProps {
  /** Tool Call data (Domain) — 自带 `response`(若已执行)。 */
  toolCall: ToolCall;
  /** Execution status, computed by the parent based on chat session status */
  executionStatus: ToolCallExecutionStatus;
  /** Unique identifier, used as key */
  itemKey: string;
  /** Whether this is the last item */
  isLast?: boolean;
}

/**
 * Render the tool icon.
 * Shows a loading spinner while executing; shows the tool-type icon when done.
 */
const ToolIcon: React.FC<{ toolName: string; status: ToolCallExecutionStatus }> = ({ toolName, status }) => {
  if (status === 'executing') {
    return (
      <span className="tool-item-status-icon executing">
        <Loader2 size={16} className="animate-spin" style={{ display: 'block' }} />
      </span>
    );
  }

  if (status === 'interrupted') {
    return (
      <span className="tool-item-status-icon interrupted">
        <AlertCircle size={16} style={{ display: 'block' }} />
      </span>
    );
  }

  // Completed state: show the icon corresponding to the tool type
  const IconComponent = getToolCallIcon(toolName);
  return (
    <span className="tool-item-status-icon completed">
      <IconComponent size={16} style={{ display: 'block' }} />
    </span>
  );
};

/**
 * ToolCallItem component.
 * Renders a single Tool Call with expand/collapse support for the custom view.
 */
export const ToolCallItem: React.FC<ToolCallItemProps> = ({
  toolCall,
  executionStatus,
  isLast = false,
}) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const rowRef = useRef<HTMLDivElement>(null);

  // Domain ToolCall.response 是 `{ time, status, result }`;直接喂给 displayText resolver。
  const resultText = toolCall.response?.result;
  const displayText = getToolCallDisplayText(toolCall.name, toolCall.args, resultText);

  // `app` LocalTool 用 cmdline 决定子 view —— resolver 只看 toolName === 'app',其它工具忽略。
  const toolName = toolCall.name;
  const CustomView = getToolCallView(toolName, toolCall.args);
  const hasCustom = CustomView !== null;

  // Expandable only for tools that have a custom view
  const isExpandable = hasCustom;

  /**
   * Handle expand/collapse click.
   * Keep the click position stable: expand downward, collapse upward.
   */
  const handleToggle = useCallback(() => {
    if (!isExpandable) return;

    if (!rowRef.current || !containerRef.current) {
      setIsExpanded(!isExpanded);
      return;
    }

    // Record the row's position relative to the viewport before the click
    const rowRect = rowRef.current.getBoundingClientRect();
    const rowTopBeforeToggle = rowRect.top;

    // Toggle expand state
    setIsExpanded(prev => !prev);

    // Use requestAnimationFrame to adjust scroll after the DOM has updated
    requestAnimationFrame(() => {
      if (!rowRef.current || !containerRef.current) return;

      adjustScrollForExpandedContent({
        anchorElement: rowRef.current,
        targetElement: containerRef.current,
        anchorTopBeforeToggle: rowTopBeforeToggle,
      });
    });
  }, [isExpanded, isExpandable]);

  return (
    <div
      ref={containerRef}
      className={`tool-call-item-container ${isExpanded ? 'expanded' : ''} ${!isLast ? 'has-next' : ''}`}
    >
      {/* Main row: icon + text + arrow */}
      <div
        ref={rowRef}
        className={`tool-calls-row tool-call-item-row ${isExpandable ? 'expandable' : ''}`}
        onClick={handleToggle}
      >
        <div className="tool-calls-icon-col">
          <ToolIcon toolName={toolName} status={executionStatus} />
        </div>
        <div className="tool-calls-text-col">
          <span className="tool-call-item-text">{displayText}</span>
          {isExpandable && (
            <ChevronRight
              size={14}
              className={`tool-call-expand-arrow ${isExpanded ? 'expanded' : ''}`}
            />
          )}
        </div>
      </div>

      {/* Expanded content: custom view. Placed below the main row; when expanded, scroll compensation via reverse list pushes the main row upward. */}
      {isExpanded && CustomView && (
        <div className="tool-call-expanded-content">
          <div className="tool-call-custom-view">
            <CustomView toolCall={toolCall} executionStatus={executionStatus} />
          </div>
        </div>
      )}
    </div>
  );
};

export default ToolCallItem;

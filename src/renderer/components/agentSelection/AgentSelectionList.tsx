/**
 * AgentSelectionList
 *
 * "Apply X to Agents" dialog 共享的列表 UI：select-all 行 + agent 行（含 loading /
 * empty 状态）。配套 `useApplyToAgentsState` 使用。
 *
 * 设计上只负责"展示 + 转发交互"，不持有 state，也不渲染 dialog 框架（DialogHeader
 * / DialogFooter / Apply / Skip 按钮）。三个 dialog 在框架层有真实差异：
 *   - skill: atom 控制 open / Apply 按钮 outline + default 主按钮
 *   - sub-agent: props 控制 open / secondary skip + 默认主按钮
 *   - mcp: props 控制 open + 冲突报告分支视图
 * 把框架抽出来会陷入参数地狱，刻意不抽。
 */

import React from 'react';
import { Checkbox } from '@/shadcn/checkbox';
import type { ApplyToAgentsState } from './useApplyToAgentsState';

interface AgentSelectionListProps {
  state: ApplyToAgentsState;
  /** 列表外层最小/最大高度，用 Tailwind class（不同 dialog 的视觉规格不一）。 */
  listClassName?: string;
}

const DEFAULT_LIST_CLASS = 'py-3 min-h-[244px] max-h-[552px] overflow-y-auto';

const AgentSelectionList: React.FC<AgentSelectionListProps> = ({
  state,
  listClassName = DEFAULT_LIST_CLASS,
}) => {
  const {
    agentItems,
    detailsReady,
    selectedAgents,
    selectableAgents,
    isAllSelected,
    handleToggle,
    handleSelectAll,
  } = state;

  return (
    <>
      {selectableAgents.length > 0 && (
        <div className="mt-3">
          <div
            className="flex items-center gap-3 px-3 py-1 rounded-md cursor-pointer select-none hover:bg-gray-100"
            onClick={handleSelectAll}
          >
            <Checkbox
              checked={isAllSelected}
              tabIndex={-1}
              className="pointer-events-none"
            />
            <span className="text-sm text-gray-700">
              {isAllSelected ? 'Deselect All' : 'Select All'}
            </span>
          </div>
        </div>
      )}

      <div className={listClassName}>
        {!detailsReady ? (
          <div className="text-sm text-gray-500 text-center py-4">
            Loading agents...
          </div>
        ) : agentItems.length === 0 ? (
          <div className="text-sm text-gray-500 text-center py-4">
            No agents found.
          </div>
        ) : (
          <div className="space-y-1">
            {agentItems.map((item) => (
              <div
                key={item.agentId}
                className={`flex items-center gap-3 px-3 py-2 rounded-md cursor-pointer transition-colors select-none ${
                  item.alreadyApplied
                    ? 'opacity-60 cursor-default'
                    : 'hover:bg-gray-100'
                }`}
                onClick={() => handleToggle(item.agentId, item.alreadyApplied)}
              >
                <Checkbox
                  checked={selectedAgents.has(item.agentId)}
                  disabled={item.alreadyApplied}
                  tabIndex={-1}
                  className="pointer-events-none"
                />
                {item.avatar ? (
                  <img
                    src={item.avatar}
                    alt={item.agentName}
                    className="w-6 h-6 rounded-full object-cover"
                  />
                ) : (
                  <span className="w-6 h-6 flex items-center justify-center text-base leading-none">
                    {item.emoji}
                  </span>
                )}
                <span className="text-sm font-medium text-gray-900 flex-1">
                  {item.agentName}
                </span>
                {item.alreadyApplied && (
                  <span className="text-xs text-gray-400">Applied</span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
};

export default AgentSelectionList;

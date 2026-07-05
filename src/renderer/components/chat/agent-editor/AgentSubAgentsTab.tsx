import React, { useState, useCallback, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom';
import { Settings, Loader2 } from 'lucide-react';
import { Button } from '@/shadcn/button'
import { Checkbox } from '@/shadcn/checkbox'
import { Badge } from '@/shadcn/badge'
import { cn } from '@/lib/utilities/utils';

import { TabComponentProps } from './types';
import { useSubAgents } from '../../userData/userDataProvider';

/**
 * AgentSubAgentsTab - Agent Sub-Agents configuration tab
 *
 * Features:
 * - Displays the global Sub-Agents list
 * - Allows users to select/deselect Sub-Agents via checkboxes
 * - Selected sub-agent names are stored in agent.sub_agents: string[]
 *
 * Design reference: AgentSkillsTab.tsx
 * - Uses shared TabComponentProps interface
 * - cachedData takes priority over agentData (persists across tab switches)
 * - useMemo dirty detection notifies parent of hasChanges
 * - No readOnly restriction (Library Agents can also edit sub-agent references)
 */
const AgentSubAgentsTab: React.FC<TabComponentProps> = ({
  mode,
  agentId,
  agentData,
  onSave,
  onDataChange,
  cachedData,
  readOnly = false,
}) => {
  const { subAgents: globalSubAgents, isLoading } = useSubAgents();
  const navigate = useNavigate();

  // Store selected sub-agent names
  const [selectedSubAgents, setSelectedSubAgents] = useState<Set<string>>(new Set());

  const [isInitialized, setIsInitialized] = useState(false);

  // Initial data for comparison to detect modifications
  const [initialSubAgents, setInitialSubAgents] = useState<Set<string>>(new Set());

  // Load selected sub-agents - reload when agentData or cachedData changes
  useEffect(() => {
    if (agentData?.id) {
      const baseSubAgents = new Set<string>();

      if (agentData?.subAgents) {
        agentData.subAgents.forEach((name) => {
          baseSubAgents.add(name);
        });
      }

      // If cached data exists, prefer cached data
      let finalSubAgents = baseSubAgents;
      if (cachedData?.subAgents) {
        finalSubAgents = new Set(cachedData.subAgents);
      }

      setSelectedSubAgents(finalSubAgents);
      if (!isInitialized) {
        setInitialSubAgents(new Set(baseSubAgents)); // Initial data is always the original data
        setIsInitialized(true);
      }
    }
  }, [agentData?.id, agentData?.subAgents, cachedData?.subAgents, isInitialized]);

  // Check if data has been modified
  const hasChanges = useMemo(() => {
    if (selectedSubAgents.size !== initialSubAgents.size) return true;

    for (const name of selectedSubAgents) {
      if (!initialSubAgents.has(name)) return true;
    }
    return false;
  }, [selectedSubAgents, initialSubAgents]);

  // Notify parent component when data changes - use useRef to track last notified data
  const lastNotifiedDataRef = React.useRef<string | null>(null);

  useEffect(() => {
    if (isInitialized && onDataChange) {
      const subAgents = Array.from(selectedSubAgents);
      const dataKey = JSON.stringify(subAgents);

      // Only notify parent when data actually changes to avoid infinite loops
      if (lastNotifiedDataRef.current !== dataKey) {
        lastNotifiedDataRef.current = dataKey;
        onDataChange('sub_agents', { subAgents }, hasChanges);
      }
    }
  }, [selectedSubAgents, hasChanges, isInitialized, onDataChange]);

  // Toggle sub-agent selection state
  const handleToggle = useCallback((subAgentName: string) => {
    if (readOnly) return;

    setSelectedSubAgents((prev) => {
      const newSelections = new Set(prev);

      if (newSelections.has(subAgentName)) {
        newSelections.delete(subAgentName);
      } else {
        newSelections.add(subAgentName);
      }

      return newSelections;
    });
  }, [readOnly]);

  // Count selected sub-agents (only those that actually exist in globalSubAgents)
  const selectedCount = useMemo(() => {
    if (!globalSubAgents || globalSubAgents.length === 0) {
      return 0;
    }
    const availableSelected = Array.from(selectedSubAgents).filter(name =>
      globalSubAgents.some(sa => sa.name === name)
    );
    return availableSelected.length;
  }, [selectedSubAgents, globalSubAgents]);

  // 跳到 Settings 的 Sub-Agents 管理页。意图（是否预选某 sub-agent）由 URL query 承载：
  // `?selected=<name>` 让 SubAgentsView 自行选中，无需事件/定时器/sessionStorage。
  // 导航是 PUSH，SettingsPage 的 Back 依据 history.state.idx 判断可回退性。
  const handleManageAll = useCallback(() => {
    navigate('/settings/sub-agents');
  }, [navigate]);

  const handleManageSubAgent = useCallback(
    (subAgentName: string) => {
      navigate(`/settings/sub-agents?selected=${encodeURIComponent(subAgentName)}`);
    },
    [navigate],
  );

  return (
    <div className="agent-tab">
      {/* Tab Header */}
      <div className="flex items-center justify-between p-2 min-h-[44px] shrink-0 bg-surface-primary border-b border-black/[0.08]">
        <div className="flex items-center gap-3 shrink-0">
          <span className="font-medium text-[13px] leading-[18px] text-content-secondary">
            {selectedCount} selected from available sub-agents
          </span>
        </div>
        <div className="flex items-center shrink-0">
          <Button
            variant="outline"
            size="sm"
            onClick={handleManageAll}
            title="Manage available sub-agents"
          >
            Manage Available Sub-Agents
          </Button>
        </div>
      </div>

      {/* Tab Body */}
      <div className="flex-1 overflow-y-auto overflow-x-visible p-2 custom-scrollbar">
        {isLoading ? (
          <div className="flex flex-col items-center justify-center gap-3 px-5 py-8 text-content-secondary">
            <Loader2 className="animate-spin" size={24} />
            <span>Loading Sub-Agents...</span>
          </div>
        ) : globalSubAgents && globalSubAgents.length > 0 ? (
          <>
            {/* Sub-Agent Cards List */}
            <div className="flex flex-col gap-2">
              {globalSubAgents.map((subAgent) => {
                const isSelected = selectedSubAgents.has(subAgent.name);

                return (
                  <div
                    key={subAgent.name}
                    className={cn(
                      'w-full rounded-lg border border-transparent bg-transparent transition-[background,border-color] border-black/7',
                      !readOnly && 'hover:bg-black/2',
                      isSelected && 'bg-black/1',
                    )}
                    onClick={() => !readOnly && handleToggle(subAgent.name)}
                    style={readOnly ? { cursor: 'default' } : undefined}
                  >
                    <div className="flex items-center justify-between w-full px-3 py-2.5 bg-transparent">
                      <div className="flex items-center gap-3 flex-1 min-w-0">
                        <Checkbox

                          checked={isSelected}
                          onCheckedChange={() => {
                            if (!readOnly) {
                              handleToggle(subAgent.name);
                            }
                          }}
                          onClick={(e) => e.stopPropagation()}
                          disabled={readOnly}
                        />
                        <div className="flex flex-col gap-1.5 flex-1 min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="mr-1.5">{subAgent.emoji}</span>
                            <span className="m-0 font-medium text-sm leading-5 text-content truncate">{subAgent.display_name}</span>

                          </div>
                          <div
                            style={{
                              display: 'flex',
                              flexDirection: 'row',
                              gap: '6px',
                              alignItems: 'center',
                            }}
                          >
                            {subAgent.version && (
                              <span className="inline-flex items-center justify-center self-start px-2 py-1 gap-1 rounded-lg bg-slate-400/30 text-slate-800 text-xs font-semibold leading-4 whitespace-nowrap">
                                v{subAgent.version}
                              </span>
                            )}
                            <span className="inline-flex items-center justify-center self-start px-2 py-1 gap-1 rounded-lg bg-slate-400/30 text-slate-800 text-xs font-semibold leading-4 whitespace-nowrap">
                              {subAgent.context_access}
                            </span>
                          </div>
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center">
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleManageSubAgent(subAgent.name);
                          }}
                          title="Manage Sub-Agent"
                        >
                          <Settings size={14} />
                        </Button>
                      </div>
                    </div>
                    {subAgent.description && (
                      <div style={{
                        padding: '0 12px 8px 36px',
                        fontSize: '12px',
                        color: 'var(--text-secondary, #6b7280)',
                        lineHeight: '1.4',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}>
                        {subAgent.description}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        ) : (
          <div className="flex flex-col items-center justify-center gap-4 px-5 py-8 text-center text-content-secondary">
            <h4>No available Sub-Agents to select</h4>
            <p style={{ fontSize: '13px', color: 'var(--text-secondary, #6b7280)', margin: '8px 0 16px' }}>
              Go to Settings → Sub-Agents to create or install sub-agents.
            </p>
            <Button variant="outline" size="sm" onClick={handleManageAll}>
              Go to Manage Available Sub-Agents
            </Button>
          </div>
        )}
      </div>
    </div>
  );
};

export default AgentSubAgentsTab;

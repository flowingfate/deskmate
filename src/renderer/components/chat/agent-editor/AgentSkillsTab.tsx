import React, { useState, useCallback, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom';
import { Settings, RotateCw, Loader2 } from 'lucide-react';
import { Checkbox } from '@/shadcn/checkbox'
import { Button } from '@/shadcn/button';
import { Badge } from '@/shadcn/badge';
import { cn } from '@/lib/utilities/utils';

import { TabComponentProps } from './types';
import { useSkills } from '../../userData/userDataProvider';
import { isBuiltinSkill } from '../../../../shared/constants/builtinSkills';
import ListSearchBox from '../../ui/ListSearchBox';
import { log } from '@/log';
const logger = log.child({ mod: 'AgentSkillsTab' });

/**
 * AgentSkillsTab - Agent Skills configuration tab
 *
 * Features:
 * - Displays the global Skills list
 * - Allows users to select/deselect Skills via checkboxes
 * - Selected skill names are stored in agent.skills: string[]
 *
 * Layout and styles are kept consistent with AgentMcpServersTab
 */
const AgentSkillsTab: React.FC<TabComponentProps> = ({
  mode,
  agentId,
  agentData,
  onSave,
  onDataChange,
  cachedData,
  readOnly = false,
}) => {
  const { skills: globalSkills, isLoading } = useSkills();
  const navigate = useNavigate();

  // Store selected skill names
  const [selectedSkills, setSelectedSkills] = useState<Set<string>>(new Set());

  const [isInitialized, setIsInitialized] = useState(false);

  // 🆕 Search filter
  const [agentSkillSearchQuery, setAgentSkillSearchQuery] = useState('');

  // Initial data used to detect modifications
  const [initialSkills, setInitialSkills] = useState<Set<string>>(new Set());

  // Load selected skills - reload when agentData or cachedData changes
  useEffect(() => {
    if (agentData?.id) {
      const baseSkills = new Set<string>();

      if (agentData?.skills) {
        agentData.skills.forEach((skillName) => {
          baseSkills.add(skillName);
        });
      }

      // If cached data exists, prefer it over the base data
      let finalSkills = baseSkills;
      if (cachedData?.skills) {
        finalSkills = new Set(cachedData.skills);
      }

      setSelectedSkills(finalSkills);
      if (!isInitialized) {
        setInitialSkills(new Set(baseSkills)); // Initial data is always the original data
        setIsInitialized(true);
      }
    }
  }, [agentData?.id, agentData?.skills, cachedData?.skills, isInitialized]);

  // Check if data has been modified - use useMemo to avoid function reference changes
  const hasChanges = useMemo(() => {
    if (selectedSkills.size !== initialSkills.size) return true;

    for (const skill of selectedSkills) {
      if (!initialSkills.has(skill)) return true;
    }
    return false;
  }, [selectedSkills, initialSkills]);

  // Notify parent component when data changes - use useRef to track last notified data
  const lastNotifiedDataRef = React.useRef<string | null>(null);

  useEffect(() => {
    if (isInitialized && onDataChange) {
      const skills = Array.from(selectedSkills);
      const dataKey = JSON.stringify(skills);

      // Only notify parent when data actually changes, to avoid infinite loops
      if (lastNotifiedDataRef.current !== dataKey) {
        lastNotifiedDataRef.current = dataKey;
        onDataChange('skills', { skills }, hasChanges);
      }
    }
  }, [selectedSkills, hasChanges, isInitialized, onDataChange]);

  // Toggle skill selection state
  const handleSkillToggle = useCallback((skillName: string) => {
    if (readOnly) return; // Toggle not allowed in read-only mode

    // Built-in skills cannot be unchecked for locked agents
    if (isBuiltinSkill(skillName) && agentData?.locked === true) return;

    setSelectedSkills((prev) => {
      const newSelections = new Set(prev);

      if (newSelections.has(skillName)) {
        // Currently selected, deselect
        newSelections.delete(skillName);
      } else {
        // Currently not selected, add selection
        newSelections.add(skillName);
      }

      return newSelections;
    });
  }, [readOnly]);

  // 🆕 Refactor: count selected skills (only those that actually exist in globalSkills)
  const selectedCount = useMemo(() => {
    if (!globalSkills || globalSkills.length === 0) {
      return 0;
    }
    // Filter to skills that actually exist
    const availableSelectedSkills = Array.from(selectedSkills).filter(skillName =>
      globalSkills.some(s => s.name === skillName)
    );
    return availableSelectedSkills.length;
  }, [selectedSkills, globalSkills]);

  // Compute total skill count
  const totalCount = useMemo(() => {
    return globalSkills?.length || 0;
  }, [globalSkills]);

  // 跳到 Settings 的 Skills 管理页。意图（是否预选某技能）由 URL query 承载：
  // `?selected=<name>` 让 SkillsView 自行选中，无需事件/定时器/sessionStorage。
  // 导航是 PUSH，SettingsPage 的 Back 依据 history.state.idx 判断可回退性。
  const handleManageSkills = useCallback(() => {
    navigate('/settings/skills');
  }, [navigate]);

  const handleManageSkill = useCallback(
    (skillName: string) => {
      navigate(`/settings/skills?selected=${encodeURIComponent(skillName)}`);
    },
    [navigate],
  );



  return (
    <div className="agent-tab">
      {/* Tab Header */}
      <div className="flex items-center justify-between p-2 min-h-[44px] shrink-0 bg-surface-primary border-b border-black/[0.08]">
        <div className="flex items-center gap-3 shrink-0">
          <span className="font-medium text-[13px] leading-[18px] text-content-secondary">
            {selectedCount} selected from available skills
          </span>
        </div>
        <div className="flex items-center shrink-0">
          <Button
            variant="outline"
            size="sm"
            onClick={handleManageSkills}
            title="Manage available skills"
          >
            Manage Available Skills
          </Button>
        </div>
      </div>

      {/* Tab Body */}
      <div className="flex-1 overflow-y-auto overflow-x-visible p-2 custom-scrollbar">
        {isLoading ? (
          <div className="flex flex-col items-center justify-center gap-3 px-5 py-8 text-content-secondary">
            <Loader2 className="animate-spin" size={24} />
            <span>Loading Skills...</span>
          </div>
        ) : globalSkills && globalSkills.length > 0 ? (
          <>
            {/* Skills List */}
            <div className="flex flex-col gap-2">
              <ListSearchBox
                value={agentSkillSearchQuery}
                onChange={setAgentSkillSearchQuery}
                placeholder="Search skills..."
              />
              {[...globalSkills].sort((a, b) => {
                const aBuiltin = isBuiltinSkill(a.name);
                const bBuiltin = isBuiltinSkill(b.name);
                if (aBuiltin && !bBuiltin) return -1;
                if (!aBuiltin && bBuiltin) return 1;
                return 0;
              })
              .filter(skill => !agentSkillSearchQuery || skill.name.includes(agentSkillSearchQuery))
              .map((skill) => {
                const isSelected = selectedSkills.has(skill.name);
                const isSkillBuiltin = isBuiltinSkill(skill.name);
                const isSkillLocked = isSkillBuiltin && agentData?.locked === true;

                return (
                  <div
                    key={skill.name}
                    className={cn(
                      'w-full rounded-md border border-transparent bg-transparent transition-[background,border-color] border-black/7',
                      !readOnly && 'hover:bg-black/2',
                      isSelected && 'bg-black/1',
                    )}
                    onClick={() => !readOnly && handleSkillToggle(skill.name)}
                    style={readOnly ? { cursor: 'default', opacity: 0.75 } : undefined}
                  >
                    <div className="flex items-center justify-between w-full px-3 py-2.5 bg-transparent">
                      <div className="flex items-center gap-3 flex-1 min-w-0">
                        <Checkbox
                          checked={isSelected}
                          onCheckedChange={() => {
                            if (!readOnly && !isSkillLocked) {
                              handleSkillToggle(skill.name);
                            }
                          }}
                          onClick={(e) => e.stopPropagation()}
                          disabled={readOnly || isSkillLocked}
                        />
                        <div className="flex flex-col gap-1.5 flex-1 min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="m-0 font-medium text-sm leading-5 text-content truncate">{skill.name}</span>
                            {isSkillBuiltin && <Badge variant="secondary" className="ml-1.5 px-1.5 py-0 text-[0.6rem] font-medium rounded">Built-in</Badge>}
                          </div>
                          <div
                            style={{
                              display: 'flex',
                              flexDirection: 'row',
                              gap: '6px',
                              alignItems: 'center',
                            }}
                          >
                            {skill.version && (
                              <span className="inline-flex items-center justify-center self-start px-2 py-1 gap-1 rounded-lg bg-slate-400/30 text-slate-800 text-xs font-semibold leading-4 whitespace-nowrap">
                                v{skill.version}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center">
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleManageSkill(skill.name);
                          }}
                          title="Manage Skill"
                        >
                          <Settings size={14} />
                        </Button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        ) : (
          <div className="flex flex-col items-center justify-center gap-4 px-5 py-8 text-center text-content-secondary">
            <h4>No available Skills to select</h4>
            <Button variant="outline" size="sm" onClick={handleManageSkills}>
              Go to Manage Available Skills
            </Button>
          </div>
        )}
      </div>
    </div>
  );
};

export default AgentSkillsTab
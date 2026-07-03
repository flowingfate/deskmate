'use client'

import React, { useState, useCallback, useEffect, useRef, useMemo } from 'react'
import { useOutletContext, useNavigate, useSearchParams } from 'react-router-dom';
import { BookMarked, Plus } from 'lucide-react';
import { Badge } from '@/shadcn/badge';
import { Button } from '@/shadcn/button';
import { useSkills } from '../userData/userDataProvider';
import { useToast } from '../ui/ToastProvider';
import SettingsLayout from '../settings/SettingsLayout';
import SkillsContentView from './SkillsContentView';
import { SkillConfig } from '../../lib/userData/types';
import { AgentContextType } from '../../types/agentContextTypes';
import { ApplySkillDialogAtom } from './ApplySkillToAgentsDialog';
import { skillsApi } from '@/ipc/skill';

const SkillsView: React.FC = () => {
  const {
    onSkillsAddMenuToggle,
    onSkillMenuToggle,
  } = useOutletContext<AgentContextType>();

  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  // Use ProfileDataManager for Skills data
  const { skills, stats: skillsStats, isLoading } = useSkills();
  const { showSuccess, showError, showInfo, showToast } = useToast();

  // Local state management
  const [selectedSkill, setSelectedSkill] = useState<SkillConfig | null>(null);
  const installSkillActions = ApplySkillDialogAtom.useChange();

  const handleAddFromDevice = useCallback(async (selectionMode?: 'artifact' | 'folder') => {
    try {
      const currentlySelectedSkillName = selectedSkill?.name;

      const result = await skillsApi.addSkillFromDevice(undefined, {
        requestSource: 'settings',
        selectionMode,
      });

      if (result.success) {
        showSuccess(result.message || `Skill "${result.skillName}" added successfully`);

        if (result.skillName && currentlySelectedSkillName === result.skillName) {
          setTimeout(() => {
            window.dispatchEvent(new CustomEvent('skills:refreshFolderExplorer', {
              detail: { skillName: result.skillName }
            }));
          }, 600);
        }

        if (result.skillName && !result.isOverwrite && result.resolution === 'installed_but_not_applied') {
          installSkillActions.setSkill(result.skillName);
        }
      } else if (result.error && result.error !== 'File selection canceled' && result.error !== 'User cancelled the operation') {
        showToast(result.error, 'error', undefined, { persistent: true });
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      showError(`Failed to add skill from device: ${errorMessage}`);
    }
  }, [selectedSkill?.name, showError, showSuccess, showToast]);



  // Ref to access latest skills without adding `skills` to effect deps
  const skillsRef = useRef(skills);
  skillsRef.current = skills;

  // Stable identity for the skills list — only changes when actual skill names change, not on ref instability
  const skillsIdentity = useMemo(() => skills.map(s => s.name).join('\0'), [skills]);

  // When skills list content changes, fix up selection — but never auto-select from null
  // (initial selection and search-related selection are owned by SkillListPanel)
  useEffect(() => {
    const currentSkills = skillsRef.current;
    setSelectedSkill(prev => {
      if (!prev) return prev; // Respect intentional deselection (e.g. zero-result search)
      if (currentSkills.length === 0) return null;
      const stillExists = currentSkills.some(s => s.name === prev.name);
      return stillExists ? prev : currentSkills[0];
    });
  }, [skillsIdentity]);

  // 外部入口（AgentSkillsTab）通过 `?selected=<name>` 表达“进来并预选某技能”的意图。
  // 命中后清掉该 query（replace，不新增历史条目），避免 back/刷新重复触发、保持 URL 干净。
  // 注意 skills 首帧可能还在加载：此时不清 query，等数据到位再选中，避免意图丢失。
  useEffect(() => {
    const target = searchParams.get('selected');
    if (!target || skills.length === 0) return;
    const skill = skills.find((s) => s.name === target);
    if (skill) setSelectedSkill(skill);
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete('selected');
        return next;
      },
      { replace: true },
    );
  }, [searchParams, skills, setSearchParams]);

  // Handle skill selection
  const handleSkillSelect = useCallback((skill: SkillConfig | null) => {
    setSelectedSkill(skill);
  }, []);

  // Handle add button click
  const handleAddClick = useCallback(
    (buttonElement: HTMLElement) => {
      if (onSkillsAddMenuToggle) {
        onSkillsAddMenuToggle(buttonElement);
      }
    },
    [onSkillsAddMenuToggle],
  );

  // Listen for Skills add menu events from AgentLayout
  useEffect(() => {
    const handleAddFromDeviceArtifact = () => {
      void handleAddFromDevice('artifact');
    };

    const handleAddFromDeviceFolder = () => {
      void handleAddFromDevice('folder');
    };

    const handleAddFromDeviceLegacy = () => {
      void handleAddFromDevice();
    };

    window.addEventListener(
      'skills:addFromDeviceArtifact',
      handleAddFromDeviceArtifact as EventListener,
    );
    window.addEventListener(
      'skills:addFromDeviceFolder',
      handleAddFromDeviceFolder as EventListener,
    );
    window.addEventListener(
      'skills:addFromDevice',
      handleAddFromDeviceLegacy as EventListener,
    );

    return () => {
      window.removeEventListener(
        'skills:addFromDeviceArtifact',
        handleAddFromDeviceArtifact as EventListener,
      );
      window.removeEventListener(
        'skills:addFromDeviceFolder',
        handleAddFromDeviceFolder as EventListener,
      );
      window.removeEventListener(
        'skills:addFromDevice',
        handleAddFromDeviceLegacy as EventListener,
      );
    };
  }, [handleAddFromDevice]);

  return (
    <SettingsLayout
      icon={<BookMarked size={18} />}
      title="Skills"
      badges={
        <Badge variant="secondary" className="text-xs">available skills: {skillsStats.totalSkills}</Badge>
      }
      actions={
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={(e) => handleAddClick(e.currentTarget)}
          title="Add Skill"
        >
          <Plus size={14} />
        </Button>
      }
    >
      <SkillsContentView
        skills={skills}
        selectedSkill={selectedSkill}
        isLoading={isLoading}
        onSelectSkill={handleSkillSelect}
        onSkillMenuToggle={onSkillMenuToggle}
      />

    </SettingsLayout>
  );
};

export default SkillsView
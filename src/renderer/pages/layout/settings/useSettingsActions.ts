import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useToast } from '@/components/ui/ToastProvider';
import { mcpClientCacheManager } from '@/lib/mcp/mcpClientCacheManager';
import { mcpApi } from '@/ipc/mcp';
import { subAgentApi } from '@/ipc/subAgent';
import { skillsApi } from '@/ipc/skill';
import { getAgents } from '@/states/agents.atom';
import { persistApi } from '@/ipc/persist';

interface DeleteDialogState<T extends string = string> {
  isOpen: boolean;
  name: T | null;
  usedByAgents: string[];
}

export interface SettingsActions {
  // MCP operations
  handleMcpServerConnect: (serverName: string) => Promise<void>;
  handleMcpServerDisconnect: (serverName: string) => Promise<void>;
  handleMcpServerReconnect: (serverName: string) => Promise<void>;
  handleMcpServerDelete: (serverName: string) => void;
  handleMcpServerEdit: (serverName: string) => void;

  // Dialog states
  deleteSkillDialog: { isOpen: boolean; skillName: string | null; usedByAgents: string[] };
  setDeleteSkillDialog: React.Dispatch<React.SetStateAction<{ isOpen: boolean; skillName: string | null; usedByAgents: string[] }>>;
  handleConfirmDeleteSkill: () => Promise<void>;

  deleteMcpDialog: { isOpen: boolean; serverName: string | null };
  setDeleteMcpDialog: React.Dispatch<React.SetStateAction<{ isOpen: boolean; serverName: string | null }>>;
  handleConfirmDeleteMcp: () => Promise<void>;

  deleteSubAgentDialog: { isOpen: boolean; subAgentName: string | null; usedByAgents: string[] };
  setDeleteSubAgentDialog: React.Dispatch<React.SetStateAction<{ isOpen: boolean; subAgentName: string | null; usedByAgents: string[] }>>;
  handleConfirmDeleteSubAgent: () => Promise<void>;

  applySubAgentDialogState: { open: boolean; subAgentName: string };
  setApplySubAgentDialogState: React.Dispatch<React.SetStateAction<{ open: boolean; subAgentName: string }>>;
}

export function useSettingsActions(): SettingsActions {
  const navigate = useNavigate();
  const { showSuccess, showError } = useToast();

  const [deleteSkillDialog, setDeleteSkillDialog] = useState<{
    isOpen: boolean;
    skillName: string | null;
    usedByAgents: string[];
  }>({ isOpen: false, skillName: null, usedByAgents: [] });

  const [deleteMcpDialog, setDeleteMcpDialog] = useState<{
    isOpen: boolean;
    serverName: string | null;
  }>({ isOpen: false, serverName: null });

  const [deleteSubAgentDialog, setDeleteSubAgentDialog] = useState<{
    isOpen: boolean;
    subAgentName: string | null;
    usedByAgents: string[];
  }>({ isOpen: false, subAgentName: null, usedByAgents: [] });

  const [applySubAgentDialogState, setApplySubAgentDialogState] = useState<{
    open: boolean;
    subAgentName: string;
  }>({ open: false, subAgentName: '' });

  // MCP server operations
  const handleMcpServerConnect = useCallback(async (serverName: string) => {
    try {
      const result = await mcpApi.connectServer(serverName);
      if (result.success) {
        await mcpClientCacheManager.refresh();
      } else {
        showError(`Failed to connect server: ${result.error || 'Unknown error'}`);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      showError(`Failed to connect server: ${errorMessage}`);
    }
  }, [showError]);

  const handleMcpServerDisconnect = useCallback(async (serverName: string) => {
    try {
      const result = await mcpApi.disconnectServer(serverName);
      if (result.success) {
        showSuccess(`Server "${serverName}" disconnected successfully`);
        await mcpClientCacheManager.refresh();
      } else {
        showError(`Failed to disconnect server: ${result.error || 'Unknown error'}`);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      showError(`Failed to disconnect server: ${errorMessage}`);
    }
  }, [showError, showSuccess]);

  const handleMcpServerReconnect = useCallback(async (serverName: string) => {
    try {
      const result = await mcpApi.reconnectServer(serverName);
      if (result.success) {
        await mcpClientCacheManager.refresh();
      } else {
        showError(`Failed to reconnect server: ${result.error || 'Unknown error'}`);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      showError(`Failed to reconnect server: ${errorMessage}`);
    }
  }, [showError]);

  const handleMcpServerDelete = useCallback((serverName: string) => {
    setDeleteMcpDialog({ isOpen: true, serverName });
  }, []);

  const handleMcpServerEdit = useCallback((serverName: string) => {
    navigate(`/settings/mcp/edit/${encodeURIComponent(serverName)}`);
  }, [navigate]);

  // Confirm MCP deletion
  const handleConfirmDeleteMcp = useCallback(async () => {
    const { serverName } = deleteMcpDialog;
    if (!serverName) return;

    try {
      const result = await mcpApi.deleteServer(serverName);
      if (result.success) {
        showSuccess(`Server "${serverName}" deleted successfully`);
        await mcpClientCacheManager.refresh();
      } else {
        showError(`Failed to delete server: ${result.error || 'Unknown error'}`);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      showError(`Failed to delete server: ${errorMessage}`);
    } finally {
      setDeleteMcpDialog({ isOpen: false, serverName: null });
    }
  }, [deleteMcpDialog, showError, showSuccess]);

  // Skill deletion —— skills 是 cold 字段，需要按 agentId 拉 detail 才能扫"使用方"。
  const handleDeleteSkill = useCallback(async (skillName: string) => {
    const records = getAgents();
    const details = await Promise.all(
      records.map(async (a) => {
        const res = await persistApi.getAgentDetail(a.id);
        return res.success ? (res.data ?? null) : null;
      }),
    );
    const usedByAgents = records
      .filter((_, i) => details[i]?.skills?.includes(skillName))
      .map((agent) => agent.name || 'Unknown Agent');
    setDeleteSkillDialog({ isOpen: true, skillName, usedByAgents });
  }, []);

  const handleConfirmDeleteSkill = useCallback(async () => {
    const { skillName } = deleteSkillDialog;
    if (!skillName) return;

    try {
      if (!skillsApi?.deleteSkill) {
        showError('Skill deletion API not available');
        return;
      }
      const result = await skillsApi.deleteSkill(skillName);
      if (result.success) {
        showSuccess(`Skill "${skillName}" deleted successfully`);
        // skills.atom 订阅 persist:agent:registry:updated[kind=skills] 自动刷新
      } else {
        showError(`Failed to delete skill: ${result.error || 'Unknown error'}`);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
      showError(`Failed to delete: ${errorMessage}`);
    } finally {
      setDeleteSkillDialog({ isOpen: false, skillName: null, usedByAgents: [] });
    }
  }, [deleteSkillDialog, showSuccess, showError]);

  // Sub-agent deletion —— subAgents 同样是 cold 字段，按 agentId 拉 detail。
  const handleDeleteSubAgent = useCallback(async (subAgentName: string) => {
    const records = getAgents();
    const details = await Promise.all(
      records.map(async (a) => {
        const res = await persistApi.getAgentDetail(a.id);
        return res.success ? (res.data ?? null) : null;
      }),
    );
    const usedByAgents = records
      .filter((_, i) => details[i]?.subAgents?.includes(subAgentName))
      .map((agent) => agent.name || 'Unknown Agent');
    setDeleteSubAgentDialog({ isOpen: true, subAgentName, usedByAgents });
  }, []);

  const handleConfirmDeleteSubAgent = useCallback(async () => {
    const { subAgentName } = deleteSubAgentDialog;
    if (!subAgentName) return;

    try {
      const result = await subAgentApi.delete(subAgentName);
      if (result.success) {
        showSuccess(`Sub-agent "${subAgentName}" deleted successfully`);
        // subAgents.atom 订阅 persist:agent:registry:updated[kind=subAgents] 自动刷新
        window.dispatchEvent(new CustomEvent('subAgents:refreshList'));
      } else {
        showError(`Failed to delete sub-agent: ${result.error || 'Unknown error'}`);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
      showError(`Failed to delete: ${errorMessage}`);
    } finally {
      setDeleteSubAgentDialog({ isOpen: false, subAgentName: null, usedByAgents: [] });
    }
  }, [deleteSubAgentDialog, showSuccess, showError]);

  // Event listeners
  useEffect(() => {
    const handleApplySubAgentToAgents = (event: CustomEvent<{ subAgentName: string }>) => {
      const { subAgentName } = event.detail;
      if (subAgentName) {
        setApplySubAgentDialogState({ open: true, subAgentName });
      }
    };

    const handleDeleteSkillEvent = (event: CustomEvent) => {
      const { skillName } = event.detail;
      handleDeleteSkill(skillName);
    };

    const handleDeleteSubAgentEvent = (event: CustomEvent) => {
      const { subAgentName } = event.detail;
      handleDeleteSubAgent(subAgentName);
    };

    window.addEventListener('subAgents:applyToAgents', handleApplySubAgentToAgents as EventListener);
    window.addEventListener('skill:delete', handleDeleteSkillEvent as EventListener);
    window.addEventListener('subAgent:delete', handleDeleteSubAgentEvent as EventListener);

    return () => {
      window.removeEventListener('subAgents:applyToAgents', handleApplySubAgentToAgents as EventListener);
      window.removeEventListener('skill:delete', handleDeleteSkillEvent as EventListener);
      window.removeEventListener('subAgent:delete', handleDeleteSubAgentEvent as EventListener);
    };
  }, [handleDeleteSkill, handleDeleteSubAgent]);

  return {
    handleMcpServerConnect,
    handleMcpServerDisconnect,
    handleMcpServerReconnect,
    handleMcpServerDelete,
    handleMcpServerEdit,
    deleteSkillDialog,
    setDeleteSkillDialog,
    handleConfirmDeleteSkill,
    deleteMcpDialog,
    setDeleteMcpDialog,
    handleConfirmDeleteMcp,
    deleteSubAgentDialog,
    setDeleteSubAgentDialog,
    handleConfirmDeleteSubAgent,
    applySubAgentDialogState,
    setApplySubAgentDialogState,
  };
}

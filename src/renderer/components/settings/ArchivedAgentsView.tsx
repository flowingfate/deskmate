'use client'

import React, { useEffect, useState, useCallback } from 'react';
import { Archive, RotateCcw } from 'lucide-react';
import { Button } from '@/shadcn/button';
import { useToast } from '../ui/ToastProvider';
import SettingsLayout from './SettingsLayout';
import { log } from '@/log';
import { persistApi } from '@/ipc/persist';
const logger = log.child({ mod: 'ArchivedAgentsView' });

interface ArchivedAgent {
  archived_at: string;
  agent_id: string;
  agent?: {
    name?: string;
    description?: string;
    system_prompt?: string;
    model?: string;
    source?: string;
  };
}

const ArchivedAgentsView: React.FC = () => {
  const [archivedAgents, setArchivedAgents] = useState<ArchivedAgent[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const { showSuccess, showError } = useToast();

  const loadArchivedAgents = useCallback(async () => {
    try {
      setIsLoading(true);
      const result = await persistApi.listArchivedAgents();
      if (result.success && result.data) {
        // 反向投影成老 ArchivedAgent 形态供本视图渲染
        const mapped: ArchivedAgent[] = result.data.map((entry) => {
          const fm = entry.markdown?.frontMatter;
          return {
            archived_at: entry.archivedAt,
            agent_id: entry.record.id,
            agent: {
              name: fm?.name ?? entry.record.name,
              system_prompt: entry.markdown?.systemPrompt ?? '',
              model: fm?.model ?? '',
            },
          };
        });
        // Sort by archived_at descending (most recent first)
        mapped.sort((a, b) => new Date(b.archived_at).getTime() - new Date(a.archived_at).getTime());
        setArchivedAgents(mapped);
      } else {
        setArchivedAgents([]);
      }
    } catch (error) {
      logger.error({ msg: "Failed to load archived agents:", err: error });
      setArchivedAgents([]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadArchivedAgents();
  }, [loadArchivedAgents]);

  const handleRestore = useCallback(async (agentId: string, agentName: string) => {
    try {
      setRestoringId(agentId);
      const result = await persistApi.unarchiveAgent(agentId);
      if (result.success) {
        showSuccess(`Agent "${agentName}" restored successfully`);
        // agents.atom 订阅 persist:agent:updated 自动刷新
        // Reload archived agents list
        await loadArchivedAgents();
      } else {
        showError(`Failed to restore agent: ${result.error || 'Unknown error'}`);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      showError(`Failed to restore agent: ${errorMessage}`);
    } finally {
      setRestoringId(null);
    }
  }, [loadArchivedAgents, showSuccess, showError]);

  const formatDate = (dateString: string): string => {
    try {
      const date = new Date(dateString);
      return date.toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return dateString;
    }
  };

  return (
    <SettingsLayout icon={<Archive size={18} />} title="Archived Agents">
      {/* Content */}
      <div className="p-5 overflow-auto" data-dbg="archived-agents">
        {isLoading ? (
          <div className="flex justify-center p-10 text-gray-500">
            Loading archived agents...
          </div>
        ) : archivedAgents.length === 0 ? (
          <div className="flex flex-col items-center justify-center px-5 py-15 text-gray-500 gap-3">
            <Archive size={48} strokeWidth={1} className="opacity-40" />
            <p className="m-0 text-base font-medium">No archived agents</p>
            <p className="m-0 text-sm opacity-70">
              Archived agents will appear here. You can archive agents from the agent menu.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {archivedAgents.map((agent) => (
              <div
                key={agent.agent_id}
                className="flex items-center justify-between p-4 rounded-md border border-black/10 bg-(--color-surface,#ffffff)"
              >
                <div className="flex flex-col gap-1 flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-(--color-text-primary,#111827) overflow-hidden text-ellipsis whitespace-nowrap">
                      {agent.agent?.name || 'Unknown Agent'}
                    </span>
                  </div>
                  {agent.agent?.description && (
                    <span className="text-xs text-gray-500 overflow-hidden text-ellipsis whitespace-nowrap">
                      {agent.agent.description}
                    </span>
                  )}
                  <span className="text-[11px] text-gray-400">
                    Archived {formatDate(agent.archived_at)}
                  </span>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleRestore(agent.agent_id, agent.agent?.name || 'Unknown Agent')}
                  disabled={restoringId === agent.agent_id}
                  className="gap-1"
                  title="Restore this agent"
                >
                  <RotateCcw size={14} />
                  <span>{restoringId === agent.agent_id ? 'Restoring...' : 'Restore'}</span>
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>
    </SettingsLayout>
  );
};

export default ArchivedAgentsView;

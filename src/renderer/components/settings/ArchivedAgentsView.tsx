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
      <div className="runtime-settings-content" style={{ padding: '20px', overflow: 'auto' }}>
        {isLoading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '40px', color: '#6b7280' }}>
            Loading archived agents...
          </div>
        ) : archivedAgents.length === 0 ? (
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '60px 20px',
            color: '#6b7280',
            gap: '12px',
          }}>
            <Archive size={48} strokeWidth={1} style={{ opacity: 0.4 }} />
            <p style={{ margin: 0, fontSize: '16px', fontWeight: 500 }}>No archived agents</p>
            <p style={{ margin: 0, fontSize: '14px', opacity: 0.7 }}>
              Archived agents will appear here. You can archive agents from the agent menu.
            </p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {archivedAgents.map((agent) => (
              <div
                key={agent.agent_id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '16px',
                  borderRadius: '8px',
                  border: '1px solid rgba(0, 0, 0, 0.1)',
                  backgroundColor: 'var(--color-surface, #ffffff)',
                }}
              >
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{
                      fontSize: '14px',
                      fontWeight: 600,
                      color: 'var(--color-text-primary, #111827)',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}>
                      {agent.agent?.name || 'Unknown Agent'}
                    </span>
                  </div>
                  {agent.agent?.description && (
                    <span style={{
                      fontSize: '12px',
                      color: '#6b7280',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}>
                      {agent.agent.description}
                    </span>
                  )}
                  <span style={{ fontSize: '11px', color: '#9ca3af' }}>
                    Archived {formatDate(agent.archived_at)}
                  </span>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleRestore(agent.agent_id, agent.agent?.name || 'Unknown Agent')}
                  disabled={restoringId === agent.agent_id}
                  style={{ marginLeft: '16px' }}
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

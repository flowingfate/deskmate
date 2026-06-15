import React, { useState, useEffect, useRef } from 'react';
import { AgentEnvelope } from '@shared/types/profileTypes';
import { APP_NAME } from '@shared/constants/branding';
import { PSEUDO_AGENT_SEARCH_GOOGLE, PSEUDO_AGENT_SEARCH_BING } from '@shared/constants/pseudoAgents';
import { toolbarApi, toolbarEvents } from '@/ipc/toolbar';
import { mainWindowApi } from '@/ipc/mainWindow';
import { getAgents, listenAgents } from '@/states/agents.atom';
import { persistApi } from '@/ipc/persist';
import { AgentAvatar } from '@/components/common/AgentAvatar';
import { Button } from '@/shadcn/button';
import appIcon from '@/assets/deskmate/app.svg';

// ToolBar page component props
interface ToolBarPageProps {}

// Agent button component props
interface AgentButtonProps {
  envelope: AgentEnvelope;
  autofocus: boolean;
  onClick: (agentId: string) => void;
}

// Agent button component
const AgentButton: React.FC<AgentButtonProps> = ({
  envelope,
  onClick,
  autofocus,
}) => {
  const agent = envelope.agent;
  const btn = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (autofocus) {
      // Listen for visibilitychange events to notify the main process
      const controller = new AbortController();
      document.addEventListener(
        'visibilitychange',
        () => {
          if (document.visibilityState === 'visible') {
            btn.current?.focus();
          }
        },
        { signal: controller.signal },
      );
      return () => {
        controller.abort();
      };
    }
  }, [autofocus, envelope.agent_id]);

  if (!agent) return null;

  // Handle pseudo-agent special logic (e.g. when no role field is present)
  const title = agent.role ? `${agent.name} - ${agent.role}` : agent.name;

  const handleClick = () => {
    onClick(envelope.agent_id);
  };

  return (
    <Button
      ref={btn}
      variant="ghost"
      className="agent-button flex items-center justify-center hover:bg-slate-200/50 focus:bg-blue-100 outline-hidden transition-all duration-200"
      onClick={handleClick}
      title={title}
      autoFocus={autofocus}
    >
      <div className="agent-avatar w-10 h-10 rounded-full bg-white shadow-xs flex items-center justify-center">
        <AgentAvatar
          emoji={agent.emoji}
          avatar={agent.avatar}
          name={agent.name}
          size="md"
          version={agent.version}
        />
      </div>
    </Button>
  );
};;;

// Main ToolBar page component
export const ToolBarPage: React.FC<ToolBarPageProps> = () => {
  // State management
  const [agentConfigs, setAgentConfigs] = useState<AgentEnvelope[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isPinned, setIsPinned] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [visibleAgents, setVisibleAgents] = useState<string[]>([]);
  const [toolbarSettings, setToolbarSettings] = useState<any>(null);

  // Data loading: fetch all Agent record + detail（Record 列表 + 按 id 懒读 cold）。
  // Toolbar 这一窗口需要每 agent 的完整配置，先并行拉所有 detail 再拼成老 AgentEnvelope 形状。
  // 失败的单个 detail 退化为 null（cold 字段空），仍可显示 record 列表字段。
  const loadAgentConfigs = async () => {
    setIsLoading(true);
    try {
      const records = getAgents();
      const details = await Promise.all(
        records.map(async (r) => {
          const res = await persistApi.getAgentDetail(r.id);
          return res.success ? (res.data ?? null) : null;
        }),
      );
      const list: AgentEnvelope[] = records.map((r, i) => {
        const d = details[i];
        return {
          agent_id: r.id,
          agent: {
            role: '',
            name: r.name,
            emoji: r.emoji ?? '',
            avatar: r.avatar,
            version: r.version,
            model: r.model,
            system_prompt: d?.systemPrompt ?? '',
            mcp_servers: d?.mcpServers ?? [],
          },
        };
      });
      setAgentConfigs(list);
      setError(null);
    } catch (err) {
      setError('Error loading agent configurations');
      setAgentConfigs([]);
    } finally {
      setIsLoading(false);
    }
  };

  // Get window always-on-top status
  const loadPinStatus = async () => {
    try {
      const result = await toolbarApi.isAlwaysOnTop();
      if (result.success) {
        setIsPinned(result.data || false);
      }
    } catch (err) {}
  };

  // Load ToolBar settings
  const loadToolbarSettings = async () => {
    try {
      // Use main window's electronAPI to get toolbar settings
        const result = await toolbarApi.getSettings();
        if (result.success && result.data) {
          setToolbarSettings(result.data);
          setVisibleAgents(result.data.visibleAgents || []);
          // Update always-on-top status based on settings
          if (result.data.alwaysOnTop !== undefined) {
            setIsPinned(result.data.alwaysOnTop);
          }
        }
    } catch (err) {}
  };

  // Filter visible Agents
  const getVisibleAgents = (configs: AgentEnvelope[]): AgentEnvelope[] => {
    // const SEARCH_AGENT_ID = 'pseudo-agent-search';
    let result: AgentEnvelope[] = [];

    // If no settings or visibleAgents is an empty array, show all Agents
    if (!visibleAgents || visibleAgents.length === 0) {
      result = [...configs];
    } else {
      // Only show Agents in the visibleAgents list
      result = configs.filter((config) =>
        visibleAgents.includes(config.agent_id),
      );
    }

    // Handle Search Pseudo Agent
    if (visibleAgents?.includes(PSEUDO_AGENT_SEARCH_GOOGLE)) {
      const googleSearch: AgentEnvelope = {
        agent_id: PSEUDO_AGENT_SEARCH_GOOGLE,
        agent: {
          name: 'Google Search',
          emoji: 'G',
          role: 'Search Engine',
          model: {} as any,
          version: '1.0.0',
        } as any,
      };
      result.unshift(googleSearch);
    }
    if (visibleAgents?.includes(PSEUDO_AGENT_SEARCH_BING)) {
      const bingSearch: AgentEnvelope = {
        agent_id: PSEUDO_AGENT_SEARCH_BING,
        agent: {
          name: 'Bing Search',
          emoji: '🔎',
          role: 'Search Engine',
          model: {} as any,
          version: '1.0.0',
        } as any,
      };
      result.unshift(bingSearch);
    }

    return result;
  };;


  // Component initialization
  useEffect(() => {
    loadAgentConfigs();
    loadPinStatus();
    loadToolbarSettings();

    // Listen for Agent config changes（订阅 agents.atom）
    const unsubscribeCache = listenAgents(() => loadAgentConfigs());

    // Listen for ToolBar settings changes
    const unsubscribeSettings = toolbarEvents.settingsUpdated(
      (_event, data) => {
        setToolbarSettings(data);
        setVisibleAgents(data.visibleAgents || []);
        // Update always-on-top status based on settings
        if (data.alwaysOnTop !== undefined) {
          setIsPinned(data.alwaysOnTop);
        }
      },
    );

    // Clean up listeners
    return () => {
      unsubscribeCache();
      // unsubscribeText(); // removed
      unsubscribeSettings();
    };
  }, []);

  // Interaction: toggle always-on-top state
  const handleTogglePin = async () => {
    try {
      const newPinState = !isPinned;
      const result = await toolbarApi.setAlwaysOnTop(newPinState);

      if (result.success) {
        setIsPinned(newPinState);
      } else {
      }
    } catch (err) {}
  };

  // Interaction: hide ToolBar
  const handleClose = async () => {
    try {
      const result = await toolbarApi.hide();
      if (!result.success) {
      }
    } catch (err) {}
  };

  // Interaction: Agent click handler
  const handleAgentClick = async (agentId: string) => {
    try {
      // If autoHide is set, auto-hide after click
      const shouldAutoHide = toolbarSettings?.autoHide !== false;

      // Bring up main window and switch to specified Agent (main process handles selectedText)
      const result = await mainWindowApi.showWithAgent(agentId);

      if (result.success) {
        // Decide whether to hide ToolBar based on settings
        if (shouldAutoHide) {
          handleClose();
        }
      } else {
      }
    } catch (err) {}
  };

  // Render: loading state
  if (isLoading) {
    return (
      <div className="toolbar-container">
        <div className="toolbar-content p-4">
          <div className="text-center text-white/70 text-sm">
            Loading agents...
          </div>
        </div>
      </div>
    );
  }

  // Render: error state
  if (error) {
    return (
      <div className="toolbar-container">
        <div className="toolbar-content p-4">
          <div className="text-center text-red-400 text-sm">{error}</div>
        </div>
      </div>
    );
  }

  // Render: empty state
  const visibleAgentConfigs = getVisibleAgents(agentConfigs);
  if (visibleAgentConfigs.length === 0) {
    return (
      <div className="toolbar-container">
        <div className="toolbar-header flex items-center">
          <div className="toolbar-handle drag-region">
            <img
              src={appIcon}
              className="w-6 h-6 opacity-50 select-none pointer-events-none"
              alt={APP_NAME}
            />
          </div>
          <div className="toolbar-content flex-1 p-2">
            <div className="text-center text-white/70 text-sm">
              {agentConfigs.length === 0
                ? 'No agents available'
                : 'No visible agents configured'}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Main render
  return (
    <div className="toolbar-container">
      {/* Horizontal layout: drag handle on the left, Agent list on the right */}
      <div className="toolbar-header flex items-center">
        <div className="toolbar-handle drag-region">
          <img
            src={appIcon}
            className="w-6 h-6 opacity-50 select-none pointer-events-none"
            alt={APP_NAME}
          />
        </div>

        {/* Agent horizontal list */}
        <div className="toolbar-content flex-1">
          <div className="agent-icon-list flex overflow-x-auto custom-scrollbar">
            {visibleAgentConfigs.map((config, index) => (
              <AgentButton
                key={config.agent_id}
                autofocus={index === 0}
                envelope={config}
                onClick={handleAgentClick}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default ToolBarPage;

import { CircleAlert, RotateCw } from 'lucide-react';
import type { ReactElement } from 'react';

import { agentChatApi } from '@/ipc/agentChat';
import { log } from '@/log';
import { getAgentById, getAgents } from '@/states/agents.atom';
import { agentSessionCacheManager } from '@/lib/chat/agentSessionCacheManager';
import { RibbonItem } from './RibbonItem';

const logger = log.child({ mod: 'RibbonErrorBar' });

const CLAUDE_MODEL_PATTERNS: ReadonlyArray<string> = [
  'claude-3',
  'claude-3.5',
  'claude-3.7',
  'claude-4',
  'claude-haiku',
  'claude-sonnet',
  'claude-opus',
];

interface ErrorBarProps {
  errorMessage: string;
  chatSessionId: string;
}

function getCurrentModelForSession(chatSessionId: string): string | null {
  const cache = agentSessionCacheManager.getChatSessionCache(chatSessionId);
  const agentId = cache?.agentId ?? agentSessionCacheManager.getCurrentAgentId();
  const agent = agentId ? getAgentById(agentId) : (getAgents()[0] ?? null);
  return agent?.model ?? null;
}

function isClaudeModel(modelId: string): boolean {
  const lower = modelId.toLowerCase();
  return CLAUDE_MODEL_PATTERNS.some((id) => lower.includes(id) || id.includes(lower));
}

function getFixSuggestion(errorMessage: string, chatSessionId: string): string | null {
  const lowerMessage = errorMessage.toLowerCase();
  const currentModel = getCurrentModelForSession(chatSessionId);
  const isClaude = currentModel ? isClaudeModel(currentModel) : false;

  if (
    isClaude &&
    (lowerMessage.includes('model is not supported') ||
      lowerMessage.includes('not available') ||
      lowerMessage.includes('region') ||
      lowerMessage.includes('blocked'))
  ) {
    return 'Please check if your VPN is connected. Claude models are restricted in some regions (e.g., mainland China). You need to use a VPN to connect from a supported region.';
  }

  if (
    lowerMessage.includes('terminated') ||
    lowerMessage.includes('connection terminated') ||
    lowerMessage.includes('network connection') ||
    lowerMessage.includes('fetch failed')
  ) {
    return 'This is usually caused by network interruption during streaming. Please check your VPN/network connection and click Retry.';
  }

  if (
    lowerMessage.includes('internal error') ||
    lowerMessage.includes('server internal error') ||
    lowerMessage.includes('status: 500')
  ) {
    return 'Server encountered an internal error. This may be caused by overly long context or complex tool calls. Try starting a new conversation or simplifying your request.';
  }

  if (lowerMessage.includes('truncat') || lowerMessage.includes('incomplete json')) {
    return 'The response was truncated. Try breaking down your request into smaller, simpler tasks.';
  }

  return null;
}

export function ErrorBar({ errorMessage, chatSessionId }: ErrorBarProps): ReactElement {
  const fixSuggestion = getFixSuggestion(errorMessage, chatSessionId);
  const errorDetail = fixSuggestion ? `${errorMessage} ${fixSuggestion}` : errorMessage;

  async function retry(): Promise<void> {
    logger.debug({ msg: 'Retrying chat', chatSessionId });
    agentSessionCacheManager.clearErrorMessage(chatSessionId);

    try {
      const cache = agentSessionCacheManager.getChatSessionCache(chatSessionId);
      if (!cache?.agentId) {
        logger.error({ msg: 'Cannot retry: no agentId for session', chatSessionId });
        return;
      }

      const result = await agentChatApi.retryChat(cache.agentId, chatSessionId);
      if (!result.success) {
        logger.error({ msg: 'Retry failed', err: result.error });
        agentSessionCacheManager.setErrorMessage(chatSessionId, result.error || 'Retry failed');
      }
    } catch (error) {
      logger.error({ msg: 'Retry failed with exception', err: error });
      const retryErrorMessage = error instanceof Error ? error.message : String(error);
      agentSessionCacheManager.setErrorMessage(chatSessionId, retryErrorMessage);
    }
  }

  return (
    <div className="inline-flex h-full max-w-full min-w-0 items-center px-1 text-[11px]" role="alert">
      <CircleAlert size={13} className="shrink-0 text-red-500" aria-hidden="true" />
      <span className="ml-1 min-w-0 truncate font-medium text-red-700" title={errorDetail}>
        {errorMessage}
      </span>
      <RibbonItem
        tooltip="Retry failed request"
        aria-label="Retry failed request"
        onClick={() => void retry()}
      >
        Retry
      </RibbonItem>
    </div>
  );
}

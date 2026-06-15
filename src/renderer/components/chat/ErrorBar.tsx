import React from 'react';
import './ErrorBar.scss';
import { Button } from '@/shadcn/button';
import { getAgentById, getAgents } from '@/states/agents.atom';
import { agentSessionCacheManager } from '../../lib/chat/agentSessionCacheManager';
import { log } from '@/log';
import { agentChatApi } from '@/ipc/agentChat';

const logger = log.child({ mod: 'ErrorBar' });

/**
 * Claude family model id substring patterns. 仅用于本组件的 region 错误兜底
 * 提示文案；不影响任何业务逻辑。Step 12 之前来源于 lib/models/ghcModels，
 * 该文件已与 GHC 全量缓存一并删除。
 */
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

/**
 * Get the currently used model ID based on chatSessionId
 */
function getCurrentModelForSession(chatSessionId: string): string | null {
  const cache = agentSessionCacheManager.getChatSessionCache(chatSessionId);
  const agentId = cache?.agentId ?? agentSessionCacheManager.getCurrentAgentId();
  const agent = agentId ? getAgentById(agentId) : (getAgents()[0] ?? null);
  return agent?.model ?? null;
}

/**
 * Check whether the model is from the Claude family
 */
function isClaudeModel(modelId: string): boolean {
  const lower = modelId.toLowerCase();
  return CLAUDE_MODEL_PATTERNS.some((id) => lower.includes(id) || id.includes(lower));
}

/**
 * Generate fix suggestion based on error message and current model
 * @param errorMessage Error message text
 * @param chatSessionId Current ChatSession ID
 * @returns Fix suggestion text, or null if none
 */
function getFixSuggestion(errorMessage: string, chatSessionId: string): string | null {
  const lowerMsg = errorMessage.toLowerCase();
  const currentModel = getCurrentModelForSession(chatSessionId);
  const isClaude = currentModel ? isClaudeModel(currentModel) : false;

  if (
    isClaude &&
    (lowerMsg.includes('model is not supported') ||
      lowerMsg.includes('not available') ||
      lowerMsg.includes('region') ||
      lowerMsg.includes('blocked'))
  ) {
    return 'Please check if your VPN is connected. Claude models are restricted in some regions (e.g., mainland China). You need to use a VPN to connect from a supported region.';
  }

  // 🔥 Network interruption/connection termination errors
  if (
    lowerMsg.includes('terminated') ||
    lowerMsg.includes('connection terminated') ||
    lowerMsg.includes('network connection') ||
    lowerMsg.includes('fetch failed')
  ) {
    return 'This is usually caused by network interruption during streaming. Please check your VPN/network connection and click Retry.';
  }

  // 🔥 500 internal server error
  if (
    lowerMsg.includes('internal error') ||
    lowerMsg.includes('server internal error') ||
    lowerMsg.includes('status: 500')
  ) {
    return 'Server encountered an internal error. This may be caused by overly long context or complex tool calls. Try starting a new conversation or simplifying your request.';
  }

  // 🔥 Truncation-related errors
  if (
    lowerMsg.includes('truncat') ||
    lowerMsg.includes('incomplete json')
  ) {
    return 'The response was truncated. Try breaking down your request into smaller, simpler tasks.';
  }

  return null;
}

/**
 * ErrorBar - Error notification bar component
 *
 * Displayed above ChatInput
 * Shows error message on the left and Retry button on the right
 * Automatically shows fix suggestions when known error patterns are detected
 */
const ErrorBar: React.FC<ErrorBarProps> = ({ errorMessage, chatSessionId }) => {
  const onRetry = async (chatSessionId: string) => {
    logger.debug({ msg: '🔄 Retrying chat...', chatSessionId });

    // First clear error message to dismiss ErrorBar
    agentSessionCacheManager.clearErrorMessage(chatSessionId);

    try {
      const cache = agentSessionCacheManager.getChatSessionCache(chatSessionId);
      if (!cache?.agentId) {
        logger.error({ msg: 'Cannot retry: no agentId for session', chatSessionId });
        return;
      }
      // Call the backend to retry
      const result = await agentChatApi.retryChat(cache.agentId, chatSessionId);

      // 🔥 Check the success field of the returned result
      if (!result.success) {
        logger.error({ msg: '❌ Retry failed:', err: result.error });
        // If retry fails, restore error message
        agentSessionCacheManager.setErrorMessage(chatSessionId, result.error || 'Retry failed');
        return;
      }

      logger.debug({ msg: '✅ Retry completed successfully' });
    } catch (error) {
      logger.error({ msg: '❌ Retry failed with exception:', err: error });
      // If retry fails, restore the error message
      const retryErrorMessage = error instanceof Error ? error.message : String(error);
      agentSessionCacheManager.setErrorMessage(chatSessionId, retryErrorMessage);
    }
  }

  const handleRetry = () => {
    onRetry(chatSessionId);
  };

  const fixSuggestion = getFixSuggestion(errorMessage, chatSessionId);

  return (
    <div className="error-bar">
      <div className="error-bar-content">
        <div className="error-bar-icon">⚠️</div>
        <div className="error-bar-message">
          {errorMessage}
          {fixSuggestion && (
            <span> {fixSuggestion}</span>
          )}
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="error-bar-btn retry"
          onClick={handleRetry}
          title="Retry the failed request"
          aria-label="Retry"
        >
          Retry
        </Button>
      </div>
    </div>
  );
};

export default ErrorBar;

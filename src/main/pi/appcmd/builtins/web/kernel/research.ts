import { request as humanLoopRequest } from '@shared/ipc/human-loop';
import type {
  InteractiveSearchEngine,
  InteractiveSearchInteractionRequest,
  InteractiveSearchInteractionResponse,
  InteractiveSearchSource,
} from '@shared/types/interactiveRequestTypes';
import { buildSearchUrl, researchWindowManager } from '@main/lib/research/ResearchWindowManager';

export interface RunResearchSessionArgs {
  query: string;
  engine: InteractiveSearchEngine;
  maxSources: number;
  chatSessionId: string;
  callId: string;
  eventSender: Electron.WebContents | null;
  signal: AbortSignal;
}

export type ResearchResult =
  | { success: true; query: string; sources: InteractiveSearchSource[] }
  | { success: false; action: 'cancel' | 'unavailable' | 'error'; error: string };

export async function runResearchSession(args: RunResearchSessionArgs): Promise<ResearchResult> {
  if (!args.eventSender) {
    return {
      success: false,
      action: 'unavailable',
      error: 'web research requires an active chat window.\nThis command cannot run in scheduled/background sessions.',
    };
  }

  const requestPayload: InteractiveSearchInteractionRequest = {
    chatSessionId: args.chatSessionId,
    callId: args.callId,
    query: args.query,
    engine: args.engine,
    searchUrl: buildSearchUrl(args.query, args.engine),
    maxSources: args.maxSources,
    startedAt: Date.now(),
  };

  // 不在此处开窗：humanLoopRequest 一发出 chat 就渲染 SearchCard，
  // 真正的 research window 等用户在卡片点击「开始研究」(startRequest IPC) 才打开。
  const task = humanLoopRequest('interactive-search', requestPayload, args.callId).to(args.eventSender);
  const registerResult = researchWindowManager.registerPending(requestPayload, args.eventSender);
  if (!registerResult.success) {
    task.reject(new Error(registerResult.error || 'Failed to register interactive search.'));
    return { success: false, action: 'error', error: registerResult.error || 'Failed to register interactive search.' };
  }

  try {
    const response = await new Promise<InteractiveSearchInteractionResponse>((resolve, reject) => {
      const abortHandler = () => {
        researchWindowManager.cancelRequest(args.callId);
      };
      args.signal.addEventListener('abort', abortHandler, { once: true });

      task
        .then(resolve)
        .catch(reject)
        .finally(() => args.signal.removeEventListener('abort', abortHandler));
    });

    if (response.action === 'submit') {
      return { success: true, query: args.query, sources: response.sources };
    }

    return { success: false, action: 'cancel', error: 'Interactive search cancelled by user.' };

  } catch (error) {
    return { success: false, action: 'error', error: error instanceof Error ? error.message : String(error) };
  } finally {
    researchWindowManager.finishRequest(args.callId);
  }
}

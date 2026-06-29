import { connectMainToRender, connectRenderToMain } from './base';
import type {
  InteractiveSearchEngine,
  InteractiveSearchInteractionRequest,
  InteractiveSearchInteractionResponse,
  InteractiveSearchSource,
} from '../types/interactiveRequestTypes';

export interface ResearchPageSnapshot {
  tabId: string;
  url: string;
  title: string;
  canGoBack: boolean;
  canGoForward: boolean;
  loading: boolean;
  hasSelection: boolean;
}

export interface ResearchSessionSnapshot {
  request: InteractiveSearchInteractionRequest;
  sources: InteractiveSearchSource[];
  tabs: ResearchPageSnapshot[];
  activeTabId: string;
  page: ResearchPageSnapshot;
  status: 'active' | 'completed' | 'cancelled';
}

export interface ResearchActionResult {
  success: boolean;
  error?: string;
}

export interface ResearchSourceResult extends ResearchActionResult {
  source?: InteractiveSearchSource;
  snapshot?: ResearchSessionSnapshot;
}

export interface ResearchSnapshotResult extends ResearchActionResult {
  snapshot?: ResearchSessionSnapshot;
}

export interface ResearchActiveResult {
  success: boolean;
  activeRequestId: string | null;
}

type RenderToMain = {
  getSession: { call: [requestId: string]; return: ResearchSnapshotResult };
  getActiveRequestId: { call: []; return: ResearchActiveResult };
  startRequest: { call: [requestId: string]; return: ResearchActionResult };
  focusRequest: { call: [requestId: string]; return: ResearchActionResult };
  focusPageView: { call: [requestId: string]; return: ResearchActionResult };
  createTab: { call: [requestId: string]; return: ResearchSnapshotResult };
  activateTab: { call: [requestId: string, tabId: string]; return: ResearchSnapshotResult };
  closeTab: { call: [requestId: string, tabId: string]; return: ResearchSnapshotResult };
  navigateSearch: { call: [requestId: string, query: string, engine: InteractiveSearchEngine, openInNewTab?: boolean]; return: ResearchActionResult };
  goBack: { call: [requestId: string]; return: ResearchActionResult };
  goForward: { call: [requestId: string]; return: ResearchActionResult };
  reloadPage: { call: [requestId: string]; return: ResearchActionResult };
  addCurrentPageAsSource: { call: [requestId: string]; return: ResearchSourceResult };
  addSelectedTextAsSource: { call: [requestId: string]; return: ResearchSourceResult };
  removeSource: { call: [requestId: string, sourceId: string]; return: ResearchSnapshotResult };
  reorderSources: { call: [requestId: string, sourceIds: string[]]; return: ResearchSnapshotResult };
  confirmRequest: { call: [requestId: string]; return: ResearchActionResult };
  cancelRequest: { call: [requestId: string]; return: ResearchActionResult };
};

export type MainToRender = {
  updated: { requestId: string; snapshot: ResearchSessionSnapshot };
  completed: { requestId: string; response: InteractiveSearchInteractionResponse };
  activeChanged: { activeRequestId: string | null };
};

export const renderToMain = connectRenderToMain<RenderToMain>('research');
export const mainToRender = connectMainToRender<MainToRender>('research');

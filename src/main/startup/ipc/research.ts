import { ipcMain } from 'electron';
import { renderToMain } from '@shared/ipc/research';
import { researchWindowManager } from '@main/lib/research/ResearchWindowManager';

export default function handleResearchIPC(): void {
  const handle = renderToMain.bindMain(ipcMain);

  handle.getSession((_event, requestId) => researchWindowManager.getSession(requestId));
  handle.getActiveRequestId(() => researchWindowManager.getActiveRequestId());
  handle.startRequest((_event, requestId) => researchWindowManager.startRequest(requestId));
  handle.focusRequest((_event, requestId) => researchWindowManager.focusRequest(requestId));
  handle.focusPageView((_event, requestId) => researchWindowManager.focusPageView(requestId));
  handle.createTab((_event, requestId) => researchWindowManager.createTab(requestId));
  handle.activateTab((_event, requestId, tabId) => researchWindowManager.activateTab(requestId, tabId));
  handle.closeTab((_event, requestId, tabId) => researchWindowManager.closeTab(requestId, tabId));
  handle.navigateSearch((_event, requestId, query, engine, openInNewTab) => researchWindowManager.navigateSearch(requestId, query, engine, openInNewTab));
  handle.goBack((_event, requestId) => researchWindowManager.goBack(requestId));
  handle.goForward((_event, requestId) => researchWindowManager.goForward(requestId));
  handle.reloadPage((_event, requestId) => researchWindowManager.reloadPage(requestId));
  handle.addCurrentPageAsSource((_event, requestId) => researchWindowManager.addCurrentPageAsSource(requestId));
  handle.addSelectedTextAsSource((_event, requestId) => researchWindowManager.addSelectedTextAsSource(requestId));
  handle.removeSource((_event, requestId, sourceId) => researchWindowManager.removeSource(requestId, sourceId));
  handle.reorderSources((_event, requestId, sourceIds) => researchWindowManager.reorderSources(requestId, sourceIds));
  handle.confirmRequest((_event, requestId) => researchWindowManager.confirmRequest(requestId));
  handle.cancelRequest((_event, requestId) => researchWindowManager.cancelRequest(requestId));
}

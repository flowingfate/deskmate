import type { AppCacheManager } from '../lib/appCache';
import type { TerminalManager } from '../lib/terminalManager';

import { appCacheManager } from '../lib/appCache';
import { getTerminalManager } from '../lib/terminalManager';

let _appCacheManager: AppCacheManager | null = null;
let _terminalManager: TerminalManager | null = null;

export async function getAppCacheManager(): Promise<AppCacheManager> {
  if (!_appCacheManager) {
    _appCacheManager = appCacheManager;
    await _appCacheManager.initialize();
  }
  return _appCacheManager;
}

export async function getTerminalManagerInstance(): Promise<TerminalManager> {
  if (!_terminalManager) {
    _terminalManager = getTerminalManager();
  }
  return _terminalManager;
}

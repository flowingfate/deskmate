import { ipcMain } from 'electron';
import { renderToMain as mainWindowRenderToMain } from '@shared/ipc/mainWindow';
import { mainToRender as navigateMainToRender } from '@shared/ipc/navigate';
import { isPseudoSearchAgent } from '@shared/constants/pseudoAgents';
import type { Context } from './shared';
import { mainWindow } from '@main/startup/wins';

export default function handleMainWindowIPC(ctx: Context) {
  // Main window control (called by ToolBar)
  const handle = mainWindowRenderToMain.bindMain(ipcMain);
  handle.showWithAgent(async (_event, agentId) => {
      if (agentId && isPseudoSearchAgent(agentId)) {
        return ctx.handleWebSearch(agentId);
      }

      const win = mainWindow();
      if (win && !win.isDestroyed()) {
        // 1. Restore/show main window
        if (win.isMinimized()) {
          win.restore();
        }
        win.show();
        win.focus();

        // 2. Navigate to the chat route with selected text
        const selectedText = ctx.selectedText;
        const route = `/agent/${agentId}`;

        navigateMainToRender.bindWebContents(win.webContents).to({
          route,
          state: { selectedText },
        });

        // 3. Auto-hide ToolBar (configurable)
        if (ctx.getToolBarAutoHide()) {
          ctx.hideToolBar();
        }

        return { success: true };
      }
      return { success: false, error: 'Main window not available' };
    },
  );
}

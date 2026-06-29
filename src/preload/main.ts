import { contextBridge, ipcRenderer, webUtils } from 'electron';
import type { InvokeFn, OnOff } from '@shared/ipc/base';
import type { McpAuthClientIdRequestPayload, McpAuthClientIdResponse } from '@shared/types/mcpAuth';
import type { LogFields, LogLevel } from '@shared/log/types';
import { provideInPreload as provideHumanLoop } from '@shared/ipc/human-loop';
import invokeScreenshot from './screenshot/invoke';
import invokeScheduler from './scheduler/invoke';
import invokeDoctor from './doctor/invoke';
import invokeApp from './app/invoke';
import invokeWindow from './window/invoke';
import invokePi from './pi/invoke';
import invokeFeatureFlags from './featureFlags/invoke';
import invokePersist from './persist/invoke';
import invokeAgentChat from './agentChat/invoke';
import invokeLlm from './llm/invoke';
import invokeChatSession from './chatSession/invoke';
import invokeFs from './fs/invoke';
import invokeWorkspace from './workspace/invoke';
import { invokeMcp, invokeMcpAuth } from './mcp/invoke';
import { invokeSkills } from './skill/invoke';
import invokeTools from './tools/invoke';
import { invokeSubAgent } from './subAgent/invoke';
import invokeRuntime from './runtime/invoke';
import invokeUpdate from './update/invoke';
import invokeQuickStartImageCache from './quickStartImageCache/invoke';
import invokeAttachment from './attachment/invoke';
import invokeInternalUrls from './internalUrls/invoke';
import invokeResearch from './research/invoke';

// Define the API that will be exposed to the renderer process
export interface ElectronAPI {
  // Platform information (static, set at preload time)
  platform: string;

  // Persist APIs (新持久化层 — 取代了老 profile 通道)
  persist: {
    invoke: InvokeFn;
    on: OnOff;
    off: OnOff;
  };


  // pi 路径下的 IPC（Step 7-9：provider 认证 + model registry）
  pi: {
    invoke: InvokeFn;
    on: OnOff;
    off: OnOff;
  };

  // LLM APIs - AI assistant features
  llm: {
    invoke: InvokeFn;
  };

  // Feature Flags APIs - developer feature toggles (read-only)
  featureFlags: {
    invoke: InvokeFn;
  };

  // MCP Client Manager APIs
  mcp: {
    invoke: InvokeFn;
    on: OnOff;
    off: OnOff;
  };



  // Runtime Environment Management (typed IPC)
  runtime: {
    invoke: InvokeFn;
  };


  // Local tools (deskmate-native) APIs — Phase 1 新增,Phase 2 起 UI 全切到此
  tools: {
    invoke: InvokeFn;
  };


  // Skills APIs (typed IPC)
  skills: {
    invoke: InvokeFn;
  };

  // Sub-Agent APIs (typed IPC)
  subAgent: {
    invoke: InvokeFn;
    on: OnOff;
    off: OnOff;
  };



  // AgentChat APIs (typed IPC)
  agentChat: {
    invoke: InvokeFn;
    on: OnOff;
    off: OnOff;
  };

  // ChatSession APIs (file operations + store events)
  chatSession: {
    invoke: InvokeFn;
    on: OnOff;
    off: OnOff;
  };

  // Window management
  window: {
    invoke: InvokeFn;
    on: OnOff;
    off: OnOff;
  };

  // Logger — 渲染进程统一日志通道（单向 send，main 端不返回）
  log: {
    write: (level: LogLevel, fields: LogFields) => void;
    writeBatch: (entries: { level: LogLevel; fields: LogFields }[]) => void;
  };

  // Folder management (removed: no renderer callers)

  // Workspace management
  workspace: {
    invoke: InvokeFn;
    on: OnOff;
    off: OnOff;
  };

  // File system operations
  fs: {
    invoke: InvokeFn;
    // webUtils.getPathForFile() — synchronous, not an IPC call
    getPathForFile: (file: File) => string;
  };

  // Attachment IPC —— user attachments → session sandbox
  attachment: {
    invoke: InvokeFn;
  };

  // Internal URL resolution —— renderer URI 翻译成绝对路径
  internalUrls: {
    invoke: InvokeFn;
  };



  // Debug tools (removed: no renderer callers)

  // Update management (typed IPC)
  update: {
    invoke: InvokeFn;
    on: OnOff;
    off: OnOff;
  };




  // Quick Start Image Cache APIs (typed IPC)
  quickStartImageCache: {
    invoke: InvokeFn;
  };

  // Screenshot APIs
  screenshot: {
    invoke: InvokeFn,
  };



  // Scheduler Management
  scheduler: {
    invoke: InvokeFn;
  };





  mcpAuth: {
    invoke: InvokeFn;
    on: OnOff;
    off: OnOff;
  };

  // App (typed IPC)
  app: {
    invoke: InvokeFn;
    on: OnOff;
    off: OnOff;
  };

  // Feedback / Bug Report
  doctor: {
    invoke: InvokeFn;
    on: OnOff;
    off: OnOff;
  };

  // Research window APIs
  research: {
    invoke: InvokeFn;
    on: OnOff;
    off: OnOff;
  };

  // Navigate events (M→R only)
  navigate: {
    on: OnOff;
    off: OnOff;
  };

}

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
const ipcOn: OnOff = ipcRenderer.on.bind(ipcRenderer);
const ipcOff: OnOff = ipcRenderer.off.bind(ipcRenderer);

export const electronAPI: ElectronAPI = {
  platform: process.platform,

  persist: {
    invoke: invokePersist,
    on: ipcOn,
    off: ipcOff,
  },
  pi: {
    invoke: invokePi,
    on: ipcOn,
    off: ipcOff,
  },
  llm: {
    invoke: invokeLlm,
  },
  featureFlags: {
    invoke: invokeFeatureFlags,
  },
  mcp: {
    invoke: invokeMcp,
    on: ipcOn,
    off: ipcOff,
  },

  // Runtime Environment Management
  runtime: {
    invoke: invokeRuntime,
  },

  tools: {
    invoke: invokeTools,
  },
  skills: {
    invoke: invokeSkills,
  },
  subAgent: {
    invoke: invokeSubAgent,
    on: ipcOn,
    off: ipcOff,
  },

  agentChat: { invoke: invokeAgentChat, on: ipcOn, off: ipcOff },
  chatSession: {
    invoke: invokeChatSession,
    on: ipcOn,
    off: ipcOff,
  },
  // Window management
  window: {
    invoke: invokeWindow,
    on: ipcOn,
    off: ipcOff,
  },
  log: {
    write: (level: LogLevel, fields: LogFields) =>
      ipcRenderer.send('log:write', { level, fields }),
    writeBatch: (entries: { level: LogLevel; fields: LogFields }[]) =>
      ipcRenderer.send('log:writeBatch', entries),
  },
  fs: {
    invoke: invokeFs,
    getPathForFile: (file: File) => webUtils.getPathForFile(file),
  },
  attachment: {
    invoke: invokeAttachment,
  },
  internalUrls: {
    invoke: invokeInternalUrls,
  },
  update: {
    invoke: invokeUpdate,
    on: ipcOn,
    off: ipcOff,
  },

  workspace: {
    invoke: invokeWorkspace,
    on: ipcOn,
    off: ipcOff,
  },

  // Quick Start Image Cache management
  quickStartImageCache: {
    invoke: invokeQuickStartImageCache,
  },

  // Screenshot functionality
  screenshot: {
    invoke: invokeScreenshot,
  },



  // Scheduler Management
  scheduler: {
    invoke: invokeScheduler,
  },



  mcpAuth: {
    invoke: invokeMcpAuth,
    on: ipcOn,
    off: ipcOff,
  },

  // App (typed IPC)
  app: {
    invoke: invokeApp,
    on: ipcOn,
    off: ipcOff,
  },

  // Feedback / Bug Report
  doctor: {
    invoke: invokeDoctor,
    on: ipcOn,
    off: ipcOff,
  },

  research: {
    invoke: invokeResearch,
    on: ipcOn,
    off: ipcOff,
  },

  // Navigate events (M→R only)
  navigate: {
    on: ipcOn,
    off: ipcOff,
  },

};

// Use `contextBridge` APIs to expose Electron APIs to
// renderer only if context isolation is enabled, otherwise
// just add to the DOM global.
if ((process as any).contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electronAPI', electronAPI);
    provideHumanLoop(contextBridge, ipcRenderer);
  } catch (error) {
  }
} else {
  // Fallback for when context isolation is disabled
  (window as any).electronAPI = electronAPI;
}
